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
	spreadsheetId: string
	parsed: ParsedImport
}

interface PickOptions {
	allowExistingSession?: boolean
	carryoverIdsOverride?: string[]
	baseSession?: SessionEntity
	resetMarks?: boolean
}

type BusyKey = 'pick' | 'save' | 'export' | 'import'

interface StoreState {
	/** True once init() has restored persisted selection; pages wait on this before redirecting. */
	ready: boolean
	classes: ClassEntity[]
	selectedClassId?: string
	selectedClass?: ClassEntity
	currentN: number
	currentSession?: SessionEntity
	busy: Record<BusyKey, boolean>

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
	const setBusy = (key: BusyKey, value: boolean) =>
		set((s) => ({ busy: { ...s.busy, [key]: value } }))

	return {
		ready: false,
		classes: [],
		currentN: DEFAULT_N,
		busy: { pick: false, save: false, export: false, import: false },

		async init() {
			try {
				await get().refreshClasses()
				const saved = localStorage.getItem(SELECTED_CLASS_KEY)
				if (saved) {
					const cls = await repo.getClass(saved)
					if (cls) await get().selectClass(saved)
					else localStorage.removeItem(SELECTED_CLASS_KEY)
				}
			} finally {
				set({ ready: true })
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
			if (!classId) {
				localStorage.removeItem(SELECTED_CLASS_KEY)
				set({ selectedClassId: undefined, selectedClass: undefined, currentSession: undefined, currentN: DEFAULT_N })
				return
			}
			const [cls, settings] = await Promise.all([repo.getClass(classId), repo.getEffectiveSettings(classId)])
			localStorage.setItem(SELECTED_CLASS_KEY, classId)
			set({
				selectedClassId: classId,
				selectedClass: cls,
				currentN: settings.defaultN ?? DEFAULT_N,
				currentSession: readDraft(classId),
			})
		},

		async deleteClass(classId) {
			try {
				await repo.deleteClassCascade(classId)
				localStorage.removeItem(draftKey(classId))
				if (get().selectedClassId === classId) await get().selectClass(undefined)
				else if (get().currentSession?.classId === classId) set({ currentSession: undefined })
				await get().refreshClasses()
				return ok(undefined)
			} catch (e) {
				return fail(e)
			}
		},

		async pickStudents(opts) {
			const classId = get().selectedClassId
			if (!classId) return 'no-class'
			if (get().busy.pick) return 'blocked'
			if (get().currentSession && !opts?.allowExistingSession) return 'blocked'

			setBusy('pick', true)
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
					carryoverIdsOverride: opts?.carryoverIdsOverride,
					baseSession: opts?.baseSession,
					resetMarks: opts?.resetMarks,
					newId: uuidv4,
				})
				set({ currentSession: session })
				return 'ok'
			} catch {
				return 'error'
			} finally {
				setBusy('pick', false)
			}
		},

		async redrawRandom(opts) {
			if (get().busy.pick) return 'blocked'
			const current = get().currentSession
			if (!current) return get().pickStudents()
			const hasMarks = Object.keys(current.marks || {}).length > 0
			if (hasMarks && !opts?.allowResetMarks) return 'needs-confirm'
			return get().pickStudents({
				allowExistingSession: true,
				carryoverIdsOverride: current.carryoverIds,
				baseSession: current,
				resetMarks: hasMarks,
			})
		},

		markStudent(studentId, mark) {
			const current = get().currentSession
			if (!current) return
			const stamped: Mark = { ...mark, markedAt: new Date().toISOString() }
			set({ currentSession: { ...current, marks: { ...current.marks, [studentId]: stamped } } })
		},

		discardDraft() {
			const classId = get().selectedClassId
			if (classId) localStorage.removeItem(draftKey(classId))
			set({ currentSession: undefined })
		},

		async saveSession() {
			const session = get().currentSession
			const classId = get().selectedClassId
			if (!session || !classId) return { ok: false, error: 'No session in progress.' }
			setBusy('save', true)
			try {
				const nowISO = new Date().toISOString()
				await repo.saveSessionWithLedger({
					...session,
					date: nowISO,
					savedAt: nowISO,
					createdAt: session.createdAt ?? session.date ?? nowISO,
				})
				localStorage.removeItem(draftKey(classId))
				set({ currentSession: undefined })
				return ok(undefined)
			} catch (e) {
				return fail(e)
			} finally {
				setBusy('save', false)
			}
		},

		async updateSettings(updates) {
			const classId = get().selectedClassId
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
			const classId = get().selectedClassId
			if (!classId) return { ok: false, error: 'No class selected.' }
			setBusy('export', true)
			try {
				await getAccessToken(SHEETS_AND_DRIVE_SCOPES)
				const { cls, students, sessions, ledger, settings } = await repo.getClassDataset(classId)
				if (!cls) return { ok: false, error: 'Class not found.' }
				const summary = await exportClassToSheet({ cls, students, sessions, ledger, settings }, settings?.spreadsheetId)
				await repo.updateSettings(classId, { spreadsheetId: summary.spreadsheetId, lastExportedAt: summary.exportedAt })
				return ok(summary)
			} catch (e) {
				return fail(e)
			} finally {
				setBusy('export', false)
			}
		},

		async previewImport() {
			const classId = get().selectedClassId
			if (!classId) return { ok: false, error: 'No class selected.' }
			setBusy('import', true)
			try {
				const settings = await repo.getSettings(classId)
				if (!settings?.spreadsheetId) return { ok: false, error: 'No spreadsheet linked to this class yet.' }
				await getAccessToken(SHEETS_AND_DRIVE_SCOPES)
				const tabs = await fetchClassTabs(settings.spreadsheetId)
				const parsed = parseSheetExport(tabs, classId)
				if (!parsed.ok) return { ok: false, error: parsed.error }
				return ok({ spreadsheetId: settings.spreadsheetId, parsed: parsed.data })
			} catch (e) {
				return fail(e)
			} finally {
				setBusy('import', false)
			}
		},

		async applyImport(preview) {
			const classId = get().selectedClassId
			if (!classId) return { ok: false, error: 'No class selected.' }
			setBusy('import', true)
			try {
				await repo.replaceClassData(classId, {
					students: preview.parsed.students,
					sessions: preview.parsed.sessions,
					ledger: preview.parsed.ledger,
					settings: preview.parsed.settings,
					spreadsheetId: preview.spreadsheetId,
				})
				// Any in-progress draft may reference students that no longer exist.
				localStorage.removeItem(draftKey(classId))
				set({ currentSession: undefined })
				const settings = await repo.getEffectiveSettings(classId)
				set({ currentN: settings.defaultN ?? DEFAULT_N })
				return ok(undefined)
			} catch (e) {
				return fail(e)
			} finally {
				setBusy('import', false)
			}
		},
	}
})

// Draft autosave: persist the in-progress session so a refresh doesn't lose marks.
useStore.subscribe((state) => {
	if (state.currentSession && state.selectedClassId) {
		localStorage.setItem(draftKey(state.selectedClassId), JSON.stringify(state.currentSession))
	}
})
