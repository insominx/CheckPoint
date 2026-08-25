/**
 * UI state + orchestration. All persistence goes through data/repository.ts,
 * all Google I/O through services/. Actions return typed results; presenting
 * errors/confirmations is the pages' job — no alert()/confirm() below the UI.
 */

import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import * as repo from './data/repository'
import { buildDraftSession, DEFAULT_N } from './domain/sessionDraft'
import { parseSheetExport, type ParsedImport } from './domain/sheetImport'
import { exportClassToSheet, fetchClassTabs, type ExportSummary } from './services/sheetsSync'
import { getAccessToken, normalizeAndValidateSpreadsheetId, SHEETS_AND_DRIVE_SCOPES } from './services/sheetsClient'
import type { ClassEntity, Mark, SessionEntity } from './types'

export type ActionResult<T = void> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T,>(value: T): ActionResult<T> => ({ ok: true, value })
const fail = (e: unknown): ActionResult<never> => ({ ok: false, error: e instanceof Error ? e.message : String(e) })

export type PickStatus = 'ok' | 'blocked' | 'no-class' | 'error'
export type RedrawStatus = PickStatus | 'needs-confirm'

export interface ImportPreview {
	classId: string
	spreadsheetId: string
	parsed: ParsedImport
}

interface PickOptions {
	allowExistingSession?: boolean
	redrawFrom?: SessionEntity
}

export type BusyKey = 'pick' | 'save' | 'export' | 'import'

interface StoreState {
	/** True once init() has restored persisted selection; pages wait on this before redirecting. */
	ready: boolean
	classes: ClassEntity[]
	selectedClass?: ClassEntity
	currentN: number
	currentSession?: SessionEntity
	inFlight: BusyKey | null

	/** Restores the last selected class (and any draft session) on app start. */
	init: () => Promise<void>
	refreshClasses: () => Promise<void>
	createClass: (name: string) => Promise<ActionResult<ClassEntity>>
	selectClass: (classId: string | undefined) => Promise<void>
	deleteClass: (classId: string) => Promise<ActionResult>

	pickStudents: (opts?: PickOptions) => Promise<PickStatus>
	redrawRandom: (opts?: { allowResetMarks?: boolean }) => Promise<RedrawStatus>
	markStudent: (studentId: string, mark: Mark) => void
	discardDraft: () => void
	saveSession: () => Promise<ActionResult>

	updateSettings: (updates: { defaultN?: number; neverSeenWeight?: number; cooldownWeight?: number; spreadsheetId?: string }) => Promise<ActionResult>

	exportToSheets: () => Promise<ActionResult<ExportSummary>>
	previewImport: () => Promise<ActionResult<ImportPreview>>
	applyImport: (preview: ImportPreview) => Promise<ActionResult>
}

const SELECTED_CLASS_KEY = 'checkpoint_selected_class'
const draftKey = (classId: string) => `checkpoint_draft_session_${classId}`

function readDraft(classId: string): SessionEntity | undefined {
	try {
		const json = localStorage.getItem(draftKey(classId))
		if (!json) return undefined
		const draft = JSON.parse(json) as SessionEntity
		return draft && draft.classId === classId ? draft : undefined
	} catch {
		return undefined
	}
}

export const useStore = create<StoreState>((set, get) => {
	let initGeneration = 0
	let selectionGeneration = 0
	const acquire = (key: BusyKey) => {
		if (get().inFlight !== null) return false
		set({ inFlight: key })
		return true
	}
	const release = (key: BusyKey) => {
		if (get().inFlight === key) set({ inFlight: null })
	}

	return {
		ready: false,
		classes: [],
		currentN: DEFAULT_N,
		inFlight: null,

		async init() {
			const generation = ++initGeneration
			const isCurrentInit = () => generation === initGeneration
			set({ ready: false })
			try {
				await get().refreshClasses()
				if (!isCurrentInit()) return
				const saved = localStorage.getItem(SELECTED_CLASS_KEY)
				if (saved) await get().selectClass(saved)
			} finally {
				if (isCurrentInit()) set({ ready: true })
			}
		},

		async refreshClasses() {
			set({ classes: await repo.listClasses() })
		},

		async createClass(name) {
			try {
				const cls = await repo.createClass(name)
				await get().refreshClasses()
				return ok(cls)
			} catch (e) {
				return fail(e)
			}
		},

		async selectClass(classId) {
			if (get().inFlight !== null) return
			const generation = ++selectionGeneration
			const isCurrentSelection = () => generation === selectionGeneration
			if (!classId) {
				if (!isCurrentSelection()) return
				localStorage.removeItem(SELECTED_CLASS_KEY)
				set({ selectedClass: undefined, currentSession: undefined, currentN: DEFAULT_N })
				return
			}
			const cls = await repo.getClass(classId)
			if (!isCurrentSelection()) return
			if (!cls) {
				localStorage.removeItem(SELECTED_CLASS_KEY)
				set({ selectedClass: undefined, currentSession: undefined, currentN: DEFAULT_N })
				return
			}
			const settings = await repo.getEffectiveSettings(classId)
			if (!isCurrentSelection()) return
			localStorage.setItem(SELECTED_CLASS_KEY, classId)
			set({
				selectedClass: cls,
				currentN: settings.defaultN ?? DEFAULT_N,
				currentSession: readDraft(classId),
			})
		},

		async deleteClass(classId) {
			if (get().inFlight !== null) return { ok: false, error: 'Another operation is already in progress.' }
			try {
				await repo.deleteClassCascade(classId)
				localStorage.removeItem(draftKey(classId))
				if (get().selectedClass?.id === classId) await get().selectClass(undefined)
				else if (get().currentSession?.classId === classId) set({ currentSession: undefined })
				await get().refreshClasses()
				return ok(undefined)
			} catch (e) {
				return fail(e)
			}
		},

		async pickStudents(opts) {
			const classId = get().selectedClass?.id
			if (!classId) return 'no-class'
			if (get().currentSession && !opts?.allowExistingSession) return 'blocked'
			if (!acquire('pick')) return 'blocked'

			try {
				const { students, sessions, ledger, settings } = await repo.getClassDataset(classId)
				const session = buildDraftSession({
					classId,
					students,
					sessions,
					ledger,
					n: get().currentN,
					neverSeenWeight: settings?.neverSeenWeight,
					cooldownWeight: settings?.cooldownWeight,
					redrawFrom: opts?.redrawFrom,
					newId: uuidv4,
				})
				if (get().selectedClass?.id !== classId) return 'blocked'
				set({ currentSession: session })
				return 'ok'
			} catch {
				return 'error'
			} finally {
				release('pick')
			}
		},

		async redrawRandom(opts) {
			const current = get().currentSession
			if (!current) return get().pickStudents()
			const hasMarks = Object.keys(current.marks || {}).length > 0
			if (hasMarks && !opts?.allowResetMarks) return 'needs-confirm'
			return get().pickStudents({
				allowExistingSession: true,
				redrawFrom: current,
			})
		},

		markStudent(studentId, mark) {
			const current = get().currentSession
			if (!current) return
			const stamped: Mark = { ...mark, markedAt: new Date().toISOString() }
			set({ currentSession: { ...current, marks: { ...current.marks, [studentId]: stamped } } })
		},

		discardDraft() {
			const classId = get().currentSession?.classId
			if (classId) localStorage.removeItem(draftKey(classId))
			set({ currentSession: undefined })
		},

		async saveSession() {
			const session = get().currentSession
			const classId = get().selectedClass?.id
			if (!session || !classId || session.classId !== classId) return { ok: false, error: 'No session in progress.' }
			if (!acquire('save')) return { ok: false, error: 'Another operation is already in progress.' }
			try {
				const nowISO = new Date().toISOString()
				await repo.saveSessionWithLedger({
					...session,
					date: nowISO,
					savedAt: nowISO,
					createdAt: session.createdAt ?? session.date ?? nowISO,
				})
				if (get().currentSession === session) {
					localStorage.removeItem(draftKey(classId))
					set({ currentSession: undefined })
				}
				return ok(undefined)
			} catch (e) {
				return fail(e)
			} finally {
				release('save')
			}
		},

		async updateSettings(updates) {
			const classId = get().selectedClass?.id
			if (!classId) return { ok: false, error: 'No class selected.' }
			try {
				const normalized = { ...updates }
				if (normalized.spreadsheetId) {
					normalized.spreadsheetId = normalizeAndValidateSpreadsheetId(normalized.spreadsheetId)
				}
				await repo.updateSettings(classId, normalized)
				if (updates.defaultN !== undefined) set({ currentN: updates.defaultN })
				return ok(undefined)
			} catch (e) {
				return fail(e)
			}
		},

		async exportToSheets() {
			const classId = get().selectedClass?.id
			if (!classId) return { ok: false, error: 'No class selected.' }
			if (!acquire('export')) return { ok: false, error: 'Another operation is already in progress.' }
			try {
				await getAccessToken(SHEETS_AND_DRIVE_SCOPES)
				const { cls, students, sessions, ledger, settings } = await repo.getClassDataset(classId)
				if (!cls) return { ok: false, error: 'Class not found.' }
				const summary = await exportClassToSheet({ cls, students, sessions, ledger, settings }, settings?.spreadsheetId)
				if (get().selectedClass?.id !== classId) return { ok: false, error: 'Selected class changed during export.' }
				await repo.updateSettings(classId, { spreadsheetId: summary.spreadsheetId, lastExportedAt: summary.exportedAt })
				return ok(summary)
			} catch (e) {
				return fail(e)
			} finally {
				release('export')
			}
		},

		async previewImport() {
			const classId = get().selectedClass?.id
			if (!classId) return { ok: false, error: 'No class selected.' }
			if (!acquire('import')) return { ok: false, error: 'Another operation is already in progress.' }
			try {
				const settings = await repo.getSettings(classId)
				if (!settings?.spreadsheetId) return { ok: false, error: 'No spreadsheet linked to this class yet.' }
				await getAccessToken(SHEETS_AND_DRIVE_SCOPES)
				const tabs = await fetchClassTabs(settings.spreadsheetId)
				const parsed = parseSheetExport(tabs, classId)
				if (!parsed.ok) return { ok: false, error: parsed.error }
				if (get().selectedClass?.id !== classId) return { ok: false, error: 'Selected class changed during import preview.' }
				return ok({ classId, spreadsheetId: settings.spreadsheetId, parsed: parsed.data })
			} catch (e) {
				return fail(e)
			} finally {
				release('import')
			}
		},

		async applyImport(preview) {
			const classId = get().selectedClass?.id
			if (!classId) return { ok: false, error: 'No class selected.' }
			if (preview.classId !== classId) return { ok: false, error: 'Import preview belongs to another class.' }
			if (!acquire('import')) return { ok: false, error: 'Another operation is already in progress.' }
			try {
				await repo.replaceClassData(classId, {
					students: preview.parsed.students,
					sessions: preview.parsed.sessions,
					ledger: preview.parsed.ledger,
					settings: preview.parsed.settings,
					spreadsheetId: preview.spreadsheetId,
				})
				// Any in-progress draft may reference students that no longer exist.
				if (get().selectedClass?.id !== classId) return { ok: false, error: 'Selected class changed during import.' }
				localStorage.removeItem(draftKey(classId))
				if (get().currentSession?.classId === classId) set({ currentSession: undefined })
				const settings = await repo.getEffectiveSettings(classId)
				set({ currentN: settings.defaultN ?? DEFAULT_N })
				return ok(undefined)
			} catch (e) {
				return fail(e)
			} finally {
				release('import')
			}
		},
	}
})

// Draft autosave: persist the in-progress session so a refresh doesn't lose marks.
useStore.subscribe((state) => {
	if (state.currentSession && state.currentSession.classId === state.selectedClass?.id) {
		localStorage.setItem(draftKey(state.currentSession.classId), JSON.stringify(state.currentSession))
	}
})
