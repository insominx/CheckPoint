import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { db } from './db'
import {
	appendRows,
	ensureCheckpointSheets,
	ensureCheckpointSettingsHeader,
	ensureSpreadsheet,
	clearSheetData,
	readValues,
	normalizeAndValidateSpreadsheetId,
	probeCheckpointSpreadsheetIdentity,
	CHECKPOINT_SETTINGS_SCHEMA_VERSION,
} from './google'
import type { AbsenceLedgerItem, ClassEntity, Mark, PerClassSettings, SessionEntity, StudentEntity } from './types'
import { weightedSampleWithoutReplacement } from './sampling'
import { canStartOperation, shouldWarnAboutConflict } from './sync'
import { validateStudentRow, logValidationResults } from './validation'

export interface SamplingStateByStudent {
	studentId: string
	timesSampled: number
	lastSampledDate?: string
	lastPresentDate?: string
	lastTwoSessionsFlags: [boolean, boolean]
}

interface UIState {
	selectedClassId?: string
	currentN: number
	currentSession?: SessionEntity
	isLoading: boolean
	isPickingStudents: boolean // Guard flag for pickStudents race condition
	error?: string
}

type PickStudentsStatus = 'ok' | 'blocked' | 'no-class' | 'error'
type RedrawStatus = PickStudentsStatus | 'needs-confirm'

interface PickStudentsOptions {
	allowExistingSession?: boolean
	carryoverIdsOverride?: string[]
	baseSession?: SessionEntity
	resetMarks?: boolean
}

interface RedrawRandomOptions {
	allowResetMarks?: boolean
}

interface Actions {
	loadClasses: () => Promise<ClassEntity[]>
	createClass: (name: string) => Promise<ClassEntity>
	selectClass: (classId: string) => Promise<void>
	/** Restore a draft session from local storage if one exists for the selected class. */
	restoreDraftSession: () => void
	getStudents: () => Promise<StudentEntity[]>
	getSessions: () => Promise<SessionEntity[]>
	getClassSettings: () => Promise<{ cls: ClassEntity; settings: PerClassSettings } | null>
	updateClassSettings: (updates: { defaultN?: number; neverSeenWeight?: number; cooldownWeight?: number; spreadsheetId?: string }) => Promise<void>
	pickStudents: (opts?: PickStudentsOptions) => Promise<PickStudentsStatus>
	redrawRandom: (opts?: RedrawRandomOptions) => Promise<RedrawStatus>
	markStudent: (studentId: string, mark: Mark) => void
	saveSession: () => Promise<void>
	deleteSession: (sessionId: string) => Promise<void>
	clearHistoryForClass: () => Promise<void>
	deleteClass: (classId: string) => Promise<void>
	exportCurrentClassToSheets: (opts?: { recreate?: boolean }) => Promise<void>
	importCurrentClassFromSheets: () => Promise<void>
	repairCurrentClassSpreadsheetIdentity: (opts?: { silent?: boolean }) => Promise<void>
	/** Correct a mark on a past session. Updates session and ledger atomically. */
	correctMark: (sessionId: string, studentId: string, newStatus: 'present' | 'absent', reason?: 'excused' | 'unexcused') => Promise<void>
	/** Get absence count for a student from ledger (single source of truth). */
	getAbsenceCount: (studentId: string) => Promise<number>
	/** Get detailed session info including student names for the History UI. */
	getSessionDetails: (sessionId: string) => Promise<{ session: SessionEntity; studentNames: Record<string, string> } | null>
}

type Store = UIState & Actions

const DEFAULT_N = 5
const DEFAULT_NEVER_SEEN_WEIGHT = 2.0
const DEFAULT_COOLDOWN_WEIGHT = 0.5

async function buildDraftSession({
	classId,
	currentN,
	carryoverIdsOverride,
	baseSession,
	resetMarks,
}: {
	classId: string
	currentN: number
	carryoverIdsOverride?: string[]
	baseSession?: SessionEntity
	resetMarks?: boolean
}): Promise<SessionEntity> {
	const [students, sessionsRaw, ledger, settings] = await Promise.all([
		db.students.where('classId').equals(classId).toArray(),
		db.sessions.where('classId').equals(classId).toArray(),
		db.ledger.where('classId').equals(classId).toArray(),
		db.settings.get(classId),
	])

	// Sort sessions by date descending (most recent first)
	const sessions = sessionsRaw.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))

	// Compute carryovers: students absent most recently and not yet present
	const lastAbsentDateByStudent = new Map<string, string>()
	for (const item of ledger) {
		const prev = lastAbsentDateByStudent.get(item.studentId)
		if (!prev || Date.parse(item.date) > Date.parse(prev)) {
			lastAbsentDateByStudent.set(item.studentId, item.date)
		}
	}

	const lastPresentDateByStudent = new Map<string, string>()
	for (const s of sessions) {
		for (const [sid, mark] of Object.entries(s.marks)) {
			if (mark.status === 'present') {
				const prev = lastPresentDateByStudent.get(sid)
				if (!prev || Date.parse(s.date) > Date.parse(prev)) {
					lastPresentDateByStudent.set(sid, s.date)
				}
			}
		}
	}

	const carryovers = students.filter((st) => {
		const lastAbsent = lastAbsentDateByStudent.get(st.id)
		if (!lastAbsent) return false
		const lastPresent = lastPresentDateByStudent.get(st.id)
		if (!lastPresent) return true
		return Date.parse(lastPresent) < Date.parse(lastAbsent)
	})

	const studentIds = new Set(students.map((s) => s.id))
	const carryoverIdsInput = carryoverIdsOverride !== undefined ? carryoverIdsOverride : carryovers.map((s) => s.id)
	const carryoverIds = Array.from(new Set(carryoverIdsInput.filter((id) => studentIds.has(id))))
	const carryoverSet = new Set(carryoverIds)

	// Eligible: never marked absent
	const absentSet = new Set(Array.from(lastAbsentDateByStudent.keys()))
	const eligible = students.filter((st) => !absentSet.has(st.id) && !carryoverSet.has(st.id))

	// Determine weights
	// never-seen boost: no marks in any session
	const allMarkedIds = new Set<string>()
	for (const s of sessions) {
		for (const sid of Object.keys(s.marks)) allMarkedIds.add(sid)
	}

	// cooldown: if sampled or marked in each of last two sessions
	const lastTwoSessions = sessions.slice(0, 2)
	const involvedInLastTwo = new Set<string>()
	if (lastTwoSessions.length === 2) {
		const [s1, s2] = lastTwoSessions
		const s1Set = new Set<string>([...s1.picks])
		const s2Set = new Set<string>([...s2.picks])
		for (const st of eligible) {
			if (s1Set.has(st.id) && s2Set.has(st.id)) involvedInLastTwo.add(st.id)
		}
	}

	const neverWeightRaw = settings?.neverSeenWeight
	const cooldownWeightRaw = settings?.cooldownWeight
	const neverWeight = Number.isFinite(neverWeightRaw) ? neverWeightRaw : DEFAULT_NEVER_SEEN_WEIGHT
	const cooldownWeight = Number.isFinite(cooldownWeightRaw) ? cooldownWeightRaw : DEFAULT_COOLDOWN_WEIGHT
	const weighted = eligible.map((st) => {
		let w = allMarkedIds.has(st.id) ? 1.0 : neverWeight
		if (involvedInLastTwo.has(st.id)) w *= cooldownWeight
		return { item: st.id, weight: w }
	})

	const safeN = Number.isFinite(currentN) && currentN > 0 ? Math.floor(currentN) : DEFAULT_N
	const randomIds = weightedSampleWithoutReplacement(weighted, safeN)
	const picks = Array.from(new Set<string>([...carryoverIds, ...randomIds]))

	const session: SessionEntity = {
		id: baseSession?.id ?? uuidv4(),
		classId,
		date: baseSession?.date ?? new Date().toISOString(),
		picks,
		carryoverIds,
		marks: resetMarks ? {} : baseSession?.marks ?? {},
	}
	if (baseSession?.createdAt) session.createdAt = baseSession.createdAt
	if (baseSession?.savedAt) session.savedAt = baseSession.savedAt

	return session
}

export const useStore = create<Store>((set, get) => ({
	isLoading: false,
	isPickingStudents: false,
	currentN: DEFAULT_N,
	async loadClasses() {
		const classes = await db.classes.toArray()
		return classes
	},
	async createClass(name: string) {
		const newClass: ClassEntity = { id: uuidv4(), name, defaultN: DEFAULT_N }
		await db.classes.add(newClass)
		return newClass
	},
	async selectClass(classId: string) {
		set({ selectedClassId: classId })
		const cls = await db.classes.get(classId)
		set({ currentN: cls?.defaultN ?? DEFAULT_N })
		get().restoreDraftSession()
	},
	restoreDraftSession() {
		const classId = get().selectedClassId
		if (!classId) return
		const draftJson = localStorage.getItem(`checkpoint_draft_session_${classId}`)
		if (draftJson) {
			try {
				const draft = JSON.parse(draftJson)
				// Basic validation to ensure it's for this class
				if (draft && draft.classId === classId) {
					console.debug('[Store] Restored draft session')
					set({ currentSession: draft })
				}
			} catch (e) {
				console.warn('[Store] Failed to parse draft session', e)
			}
		}
	},
	async getStudents() {
		const classId = get().selectedClassId
		if (!classId) return []
		return db.students.where('classId').equals(classId).toArray()
	},
	async getSessions() {
		const classId = get().selectedClassId
		if (!classId) return []
		const sessions = await db.sessions.where('classId').equals(classId).toArray()
		return sessions.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
	},
	async getClassSettings() {
		const classId = get().selectedClassId
		if (!classId) return null
		const cls = await db.classes.get(classId)
		if (!cls) return null
		const settings = await db.settings.get(classId)
		const fullSettings: PerClassSettings = {
			classId,
			defaultN: settings?.defaultN ?? cls.defaultN ?? DEFAULT_N,
			neverSeenWeight: settings?.neverSeenWeight ?? DEFAULT_NEVER_SEEN_WEIGHT,
			cooldownWeight: settings?.cooldownWeight ?? DEFAULT_COOLDOWN_WEIGHT,
			spreadsheetId: settings?.spreadsheetId,
			lastExportedAt: settings?.lastExportedAt,
		}
		return { cls, settings: fullSettings }
	},
	async updateClassSettings(updates) {
		const classId = get().selectedClassId
		if (!classId) return
		const existing = await db.settings.get(classId)
		if (updates.spreadsheetId && updates.spreadsheetId !== existing?.spreadsheetId) {
			const allSettings = await db.settings.toArray()
			const conflict = allSettings.find((s) => s.spreadsheetId === updates.spreadsheetId && s.classId !== classId)
			if (conflict) {
				throw new Error(`Spreadsheet ID already linked to another class (${conflict.classId}).`)
			}
		}
		await db.settings.put({
			classId,
			defaultN: updates.defaultN ?? existing?.defaultN ?? DEFAULT_N,
			neverSeenWeight: updates.neverSeenWeight ?? existing?.neverSeenWeight ?? DEFAULT_NEVER_SEEN_WEIGHT,
			cooldownWeight: updates.cooldownWeight ?? existing?.cooldownWeight ?? DEFAULT_COOLDOWN_WEIGHT,
			spreadsheetId: updates.spreadsheetId ?? existing?.spreadsheetId,
			lastExportedAt: existing?.lastExportedAt,
		})
		// Also update class.defaultN if changed
		if (updates.defaultN !== undefined) {
			const cls = await db.classes.get(classId)
			if (cls) await db.classes.put({ ...cls, defaultN: updates.defaultN })
			set({ currentN: updates.defaultN })
		}
	},
	async pickStudents(opts) {
		const classId = get().selectedClassId
		if (!classId) return 'no-class'

		// Guard against concurrent calls (race condition prevention)
		const allowExistingSession = opts?.allowExistingSession ?? false
		const hasExistingResult = !!get().currentSession && !allowExistingSession
		if (!canStartOperation(get().isPickingStudents, hasExistingResult)) return 'blocked'

		set({ isPickingStudents: true, isLoading: true, error: undefined })
		try {
			const session = await buildDraftSession({
				classId,
				currentN: get().currentN,
				carryoverIdsOverride: opts?.carryoverIdsOverride,
				baseSession: opts?.baseSession,
				resetMarks: opts?.resetMarks,
			})
			set({ currentSession: session })
			return 'ok'
		} catch (e) {
			set({ error: (e as Error).message })
			return 'error'
		} finally {
			set({ isLoading: false, isPickingStudents: false })
		}
	},
	async redrawRandom(opts) {
		if (get().isPickingStudents) return 'blocked'
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
		const updated: SessionEntity = { ...current, marks: { ...current.marks, [studentId]: stamped } }
		set({ currentSession: updated })
	},
	async saveSession() {
		const session = get().currentSession
		const classId = get().selectedClassId
		if (!session || !classId) return
		const nowISO = new Date().toISOString()
		const sessionToSave: SessionEntity = { ...session, date: nowISO, savedAt: nowISO, createdAt: session.createdAt ?? session.date ?? nowISO }
		await db.transaction('rw', db.sessions, db.ledger, async () => {
			await db.sessions.add(sessionToSave)
			const absentEntries: AbsenceLedgerItem[] = []
			for (const [sid, mark] of Object.entries(sessionToSave.marks)) {
				if (mark.status === 'absent') {
					absentEntries.push({
						id: uuidv4(),
						classId,
						studentId: sid,
						date: sessionToSave.date,
						sessionId: sessionToSave.id,
						reason: mark.reason,
					})
				}
			}
			if (absentEntries.length) await db.ledger.bulkAdd(absentEntries)
			// absenceCount is now derived from ledger — no caching
		})

		// Attempt CSV append via File System Access API if configured
		try {
			const settings = await db.settings.get(classId)
			if (settings?.csvFileHandle) {
				const handle: any = settings.csvFileHandle as any
				const writable = await handle.createWritable()
				const classStudents = await db.students.where('classId').equals(classId).toArray()
				const nameById = new Map<string, string>(classStudents.map((s) => [s.id, s.displayName]))
				const absentRows = Object.entries(sessionToSave.marks)
					.filter(([, m]) => m.status === 'absent')
					.map(([sid, m]) => {
						const name = nameById.get(sid) ?? ''
						return `${sessionToSave.date},${sid},${name},ABSENT,${m.reason ?? ''}\n`
					})
				await writable.write(absentRows.join(''))
				await writable.close()
			}
		} catch (e) {
			console.debug('[Store] CSV file handle write failed:', e)
		}
		if (classId) {
			localStorage.removeItem(`checkpoint_draft_session_${classId}`)
		}
		set({ currentSession: undefined })
	},

	async deleteSession(sessionId) {
		const classId = get().selectedClassId
		if (!classId) return
		await db.transaction('rw', db.sessions, db.ledger, async () => {
			const session = await db.sessions.get(sessionId)
			if (!session || session.classId !== classId) return
			await db.sessions.delete(sessionId)
			// Delete ledger entries for this session — count is derived, no caching
			const ledgerToDelete = await db.ledger.where({ classId, sessionId }).toArray()
			if (ledgerToDelete.length) {
				await db.ledger.bulkDelete(ledgerToDelete.map((l) => l.id))
			}
		})
	},

	async clearHistoryForClass() {
		const classId = get().selectedClassId
		if (!classId) return
		await db.transaction('rw', db.sessions, db.ledger, async () => {
			const sessions = await db.sessions.where('classId').equals(classId).primaryKeys()
			if (sessions.length) await db.sessions.bulkDelete(sessions as string[])
			const ledgerIds = await db.ledger.where('classId').equals(classId).primaryKeys()
			if (ledgerIds.length) await db.ledger.bulkDelete(ledgerIds as string[])
			// absenceCount is derived from ledger — clearing ledger clears counts
		})
	},

	async deleteClass(classId) {
		const selectedClassId = get().selectedClassId
		const isSelected = selectedClassId === classId
		const currentSession = get().currentSession
		await db.transaction('rw', db.classes, db.students, db.sessions, db.ledger, db.settings, async () => {
			await db.classes.delete(classId)
			const studentKeys = await db.students.where('classId').equals(classId).primaryKeys()
			if (studentKeys.length) await db.students.bulkDelete(studentKeys as string[])
			const sessionKeys = await db.sessions.where('classId').equals(classId).primaryKeys()
			if (sessionKeys.length) await db.sessions.bulkDelete(sessionKeys as string[])
			const ledgerKeys = await db.ledger.where('classId').equals(classId).primaryKeys()
			if (ledgerKeys.length) await db.ledger.bulkDelete(ledgerKeys as string[])
			await db.settings.delete(classId)
		})
		localStorage.removeItem(`checkpoint_draft_session_${classId}`)
		if (isSelected) {
			set({ selectedClassId: undefined, currentSession: undefined, currentN: DEFAULT_N })
		} else if (currentSession?.classId === classId) {
			set({ currentSession: undefined })
		}
	},

	async correctMark(sessionId, studentId, newStatus, reason) {
		const classId = get().selectedClassId
		if (!classId) return
		await db.transaction('rw', db.sessions, db.ledger, async () => {
			const session = await db.sessions.get(sessionId)
			if (!session || session.classId !== classId) return

			const oldMark = session.marks[studentId]
			const wasAbsent = oldMark?.status === 'absent'
			const willBeAbsent = newStatus === 'absent'

			// Update the session mark
			const newMark: Mark = { status: newStatus, reason: willBeAbsent ? (reason ?? 'unexcused') : undefined, markedAt: new Date().toISOString() }
			const updatedMarks = { ...session.marks, [studentId]: newMark }
			await db.sessions.update(sessionId, { marks: updatedMarks })

			// Update ledger accordingly
			if (wasAbsent && !willBeAbsent) {
				// Absent → Present: remove ledger entry for this session+student
				const toDelete = await db.ledger.where({ classId, sessionId, studentId }).toArray()
				if (toDelete.length) {
					await db.ledger.bulkDelete(toDelete.map((l) => l.id))
				}
			} else if (!wasAbsent && willBeAbsent) {
				// Present → Absent: add ledger entry
				const { v4: uuidv4 } = await import('uuid')
				await db.ledger.add({
					id: uuidv4(),
					classId,
					studentId,
					date: session.date,
					sessionId,
					reason: reason ?? 'unexcused',
				})
			} else if (wasAbsent && willBeAbsent && oldMark?.reason !== reason) {
				// Absent → Absent but reason changed: update ledger entry
				const existing = await db.ledger.where({ classId, sessionId, studentId }).first()
				if (existing) {
					await db.ledger.update(existing.id, { reason: reason ?? 'unexcused' })
				}
			}
		})
	},

	async getAbsenceCount(studentId) {
		return db.ledger.where('studentId').equals(studentId).count()
	},

	async getSessionDetails(sessionId) {
		const session = await db.sessions.get(sessionId)
		if (!session) return null
		const students = await db.students.where('classId').equals(session.classId).toArray()
		const studentNames: Record<string, string> = {}
		for (const s of students) studentNames[s.id] = s.displayName
		return { session, studentNames }
	},

	async exportCurrentClassToSheets(opts) {
		const classId = get().selectedClassId
		if (!classId) return
		set({ isLoading: true, error: undefined })
		try {
			const cls = await db.classes.get(classId)
			const settings = (await db.settings.get(classId)) as any
			const preferredId = settings?.spreadsheetId as string | undefined
			const title = `CheckPoint — ${cls?.name || classId}`
			console.log('[Store]', 'Export start', { classId, title, preferredId, opts })
			const spreadsheetId = await ensureSpreadsheet(title, opts?.recreate ? undefined : preferredId)
			await ensureCheckpointSheets(spreadsheetId)

			const identity = await probeCheckpointSpreadsheetIdentity(spreadsheetId)
			const classLabel = cls?.name ? `${cls.name} (${classId})` : classId
			if (identity.multipleClassIds?.length) {
				throw new Error(`Spreadsheet contains multiple class IDs: ${identity.multipleClassIds.join(', ')}`)
			}
			if (identity.classId && identity.classId !== classId) {
				const sheetLabel = identity.className ? `${identity.className} (${identity.classId})` : identity.classId
				throw new Error(`Spreadsheet belongs to ${sheetLabel}, not ${classLabel}.`)
			}
			if (identity.isLegacy) {
				const proceed = confirm('This spreadsheet does not declare class identity yet.\n\nExport will repair the metadata. Continue?')
				if (!proceed) {
					set({ isLoading: false })
					return
				}
			}

			// Check for timestamp conflict before overwriting
			try {
				const remoteTimestamp = identity.lastExportedAt
				const localTimestamp = settings?.lastExportedAt as string | undefined
				if (shouldWarnAboutConflict(remoteTimestamp, localTimestamp)) {
					const overwrite = confirm('⚠️ This Sheet was modified more recently than your last export.\n\nOverwrite with local data?')
					if (!overwrite) {
						set({ isLoading: false })
						return
					}
				}
			} catch (e) {
				console.debug('[Store] Could not read remote timestamp (proceeding with export):', e)
			}

			// Solution 3: Clear data rows sequentially to handle partial failures
			const sheetsToClear = ['Classes', 'Students', 'Sessions', 'Marks', 'Ledger', 'Settings']
			const clearedSheets: string[] = []
			try {
				for (const sheet of sheetsToClear) {
					await clearSheetData(spreadsheetId, sheet)
					clearedSheets.push(sheet)
				}
			} catch (clearError) {
				// Mark sheets that were cleared as failed
				for (const sheet of clearedSheets) {
					try {
						await appendRows(spreadsheetId, sheet, [['EXPORT FAILED', new Date().toISOString()]])
					} catch { /* ignore rollback errors */ }
				}
				throw clearError
			}
			// Gather data
			const [classes, students, sessions, ledger, perClassSettings] = await Promise.all([
				db.classes.toArray(),
				db.students.where('classId').equals(classId).toArray(),
				db.sessions.where('classId').equals(classId).toArray(),
				db.ledger.where('classId').equals(classId).toArray(),
				db.settings.get(classId),
			])
			const nameById = new Map<string, string>(students.map((s) => [s.id, s.displayName]))
			// Write Classes (only this class)
			const clsRow = classes.find((c) => c.id === classId)
			if (clsRow) await appendRows(spreadsheetId, 'Classes', [[clsRow.id, clsRow.name, clsRow.defaultN]])
			// Write Students (compute absenceCount from ledger)
			if (students.length) {
				// Build absence count map from ledger (single source of truth)
				const absenceCountByStudent = new Map<string, number>()
				for (const l of ledger) {
					absenceCountByStudent.set(l.studentId, (absenceCountByStudent.get(l.studentId) || 0) + 1)
				}
				await appendRows(
					spreadsheetId,
					'Students',
					students.map((s) => [
						s.id,
						s.classId,
						s.firstName ?? '',
						s.lastName ?? '',
						s.displayName,
						s.externalId ?? '',
						s.loginId ?? '',
						s.sisId ?? '',
						s.notes ?? '',
						absenceCountByStudent.get(s.id) ?? 0,
					]),
				)
			}
			// Write Sessions + Marks
			sessions.sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
			for (const s of sessions) {
				const picksCSV = s.picks.join(',')
				const picksNamesCSV = s.picks.map((id) => nameById.get(id) ?? '').join(',')
				const carryoverCSV = (s.carryoverIds || []).join(',')
				const carryoverNamesCSV = (s.carryoverIds || []).map((id) => nameById.get(id) ?? '').join(',')
				await appendRows(spreadsheetId, 'Sessions', [[s.id, s.classId, s.date, s.createdAt ?? '', s.savedAt ?? '', picksCSV, picksNamesCSV, carryoverCSV, carryoverNamesCSV]])
				const markRows: (string | null)[][] = []
				for (const [sid, mark] of Object.entries(s.marks)) {
					markRows.push([s.id, sid, nameById.get(sid) ?? '', mark.status, mark.reason ?? null, (mark as any).markedAt ?? null])
				}
				if (markRows.length) await appendRows(spreadsheetId, 'Marks', markRows)
			}
			// Write Ledger
			if (ledger.length) {
				await appendRows(
					spreadsheetId,
					'Ledger',
					ledger.map((l) => [
						l.id,
						l.classId,
						l.studentId,
						nameById.get(l.studentId) ?? '',
						l.date,
						l.sessionId ?? '',
						l.reason ?? null,
						l.notes ?? null,
					]),
				)
			}
			await ensureCheckpointSettingsHeader(spreadsheetId)
			// Write Settings row for this class (include timestamp for conflict detection)
			const exportTimestamp = new Date().toISOString()
			await appendRows(spreadsheetId, 'Settings', [[
				classId,
				cls?.name ?? '',
				perClassSettings?.defaultN ?? 5,
				perClassSettings?.neverSeenWeight ?? 2,
				perClassSettings?.cooldownWeight ?? 0.5,
				CHECKPOINT_SETTINGS_SCHEMA_VERSION,
				exportTimestamp,
			]])
			// Always save spreadsheetId and timestamp locally
			await db.settings.put({
				classId,
				defaultN: perClassSettings?.defaultN ?? 5,
				neverSeenWeight: perClassSettings?.neverSeenWeight ?? 2,
				cooldownWeight: perClassSettings?.cooldownWeight ?? 0.5,
				spreadsheetId,
				lastExportedAt: exportTimestamp,
			})
			// eslint-disable-next-line no-alert
			alert('Sync to Google Sheets completed.')
		} catch (e) {
			console.error('[Store]', 'Export failed', e)
			// eslint-disable-next-line no-alert
			alert(`Sync failed: ${(e as Error).message}`)
		} finally {
			set({ isLoading: false })
		}
	},

	async importCurrentClassFromSheets() {
		const classId = get().selectedClassId
		if (!classId) return
		set({ isLoading: true, error: undefined })
		try {
			const st = (await db.settings.get(classId)) as any
			const idRaw = st?.spreadsheetId as string | undefined
			if (!idRaw) throw new Error('No Spreadsheet ID configured for this class')
			const spreadsheetId = normalizeAndValidateSpreadsheetId(idRaw)
			await ensureCheckpointSheets(spreadsheetId)
			const identity = await probeCheckpointSpreadsheetIdentity(spreadsheetId)
			if (identity.multipleClassIds?.length) {
				throw new Error(`Spreadsheet contains multiple class IDs: ${identity.multipleClassIds.join(', ')}`)
			}
			if (identity.isLegacy) {
				throw new Error('Spreadsheet is missing class identity metadata. Run Sync/Export to repair before importing.')
			}
			if (!identity.classId || identity.classId !== classId) {
				const sheetLabel = identity.className ? `${identity.className} (${identity.classId})` : (identity.classId || 'Unknown')
				throw new Error(`Spreadsheet belongs to ${sheetLabel}, not the selected class.`)
			}
			// Read headers to verify schema, then read bodies
			const [_classesRows, studentRows, sessionsRows, marksRows, ledgerRows, settingsRows] = await Promise.all([
				readValues(spreadsheetId, 'Classes!A1:Z'),
				readValues(spreadsheetId, 'Students!A1:Z'),
				readValues(spreadsheetId, 'Sessions!A1:Z'),
				readValues(spreadsheetId, 'Marks!A1:Z'),
				readValues(spreadsheetId, 'Ledger!A1:Z'),
				readValues(spreadsheetId, 'Settings!A1:Z'),
			])
			const getBody = (rows: (string | null)[][]) => rows.slice(1)
			const studentsBody = getBody(studentRows)
			const sessionsBody = getBody(sessionsRows)
			const marksBody = getBody(marksRows)
			const ledgerBody = getBody(ledgerRows)
			const settingsBody = getBody(settingsRows)
			const settingsHeader = (settingsRows?.[0] || []).map((h) => String(h ?? '').trim())
			const settingsIndex = new Map<string, number>()
			settingsHeader.forEach((key, idx) => {
				if (key) settingsIndex.set(key, idx)
			})
			const getSettingValue = (row: (string | null)[], key: string, fallbackIdx?: number) => {
				const idx = settingsIndex.get(key)
				const finalIdx = idx !== undefined ? idx : fallbackIdx
				if (finalIdx === undefined) return undefined
				return row?.[finalIdx]
			}

			// Begin destructive overwrite for this class
			await db.transaction('rw', db.students, db.sessions, db.ledger, db.settings, async () => {
				// Clear current class data
				const sessionKeys = await db.sessions.where('classId').equals(classId).primaryKeys()
				if (sessionKeys.length) await db.sessions.bulkDelete(sessionKeys as string[])
				const ledgerKeys = await db.ledger.where('classId').equals(classId).primaryKeys()
				if (ledgerKeys.length) await db.ledger.bulkDelete(ledgerKeys as string[])
				const studentKeys = await db.students.where('classId').equals(classId).primaryKeys()
				if (studentKeys.length) await db.students.bulkDelete(studentKeys as string[])

				// Students
				if (studentsBody.length) {
					const validStudents = studentsBody
						.map((r) => validateStudentRow(r, classId))
						.filter((s): s is StudentEntity => s !== null)

					logValidationResults('Students', studentsBody.length, validStudents)

					if (validStudents.length) {
						await db.students.bulkAdd(validStudents)
					}
				}

				// Sessions and Marks
				const marksBySession = new Map<string, { [sid: string]: Mark }>()
				for (const r of marksBody) {
					const sessionId = String(r[0] ?? '')
					const studentId = String(r[1] ?? '')
					const status = String(r[3] ?? 'present') as 'present' | 'absent'
					const reason = (r[4] as any) || undefined
					const markedAt = (r[5] as any) || undefined
					const entry: Mark = { status, reason, markedAt }
					const obj = marksBySession.get(sessionId) || {}
					obj[studentId] = entry
					marksBySession.set(sessionId, obj)
				}

				if (sessionsBody.length) {
					await db.sessions.bulkAdd(
						sessionsBody.map((r) => ({
							id: String(r[0] ?? ''),
							classId: String(r[1] ?? ''),
							date: String(r[2] ?? ''),
							createdAt: (r[3] as any) || undefined,
							savedAt: (r[4] as any) || undefined,
							picks: String(r[5] ?? '').split(',').filter(Boolean),
							carryoverIds: String(r[7] ?? '').split(',').filter(Boolean),
							marks: marksBySession.get(String(r[0] ?? '')) || {},
						} as SessionEntity)),
					)
				}

				// Ledger
				if (ledgerBody.length) {
					await db.ledger.bulkAdd(
						ledgerBody.map((r) => ({
							id: String(r[0] ?? ''),
							classId: String(r[1] ?? ''),
							studentId: String(r[2] ?? ''),
							date: String(r[4] ?? ''),
							sessionId: (r[5] as any) || undefined,
							reason: (r[6] as any) || undefined,
							notes: (r[7] as any) || undefined,
						})),
					)
				}

				// Settings (only apply for this class if present)
				if (settingsBody.length) {
					const classIdIdx = settingsIndex.get('classId') ?? 0
					const row = settingsBody.find((r) => String(r[classIdIdx] ?? '') === classId)
					if (row) {
						await db.settings.put({
							classId,
							defaultN: Number(getSettingValue(row, 'defaultN', 2) ?? 5),
							neverSeenWeight: Number(getSettingValue(row, 'neverSeenWeight', 3) ?? 2),
							cooldownWeight: Number(getSettingValue(row, 'cooldownWeight', 4) ?? 0.5),
							spreadsheetId: spreadsheetId,
							lastExportedAt: (getSettingValue(row, 'lastExportedAt') as string | undefined) || undefined,
						})
					}
				}
			})
			// eslint-disable-next-line no-alert
			alert('Import completed and local data overwritten for this class.')
		} catch (e) {
			console.error('[Store]', 'Import failed', e)
			// eslint-disable-next-line no-alert
			alert(`Import failed: ${(e as Error).message}`)
		} finally {
			set({ isLoading: false })
		}
	},
	async repairCurrentClassSpreadsheetIdentity(opts) {
		const classId = get().selectedClassId
		if (!classId) return
		set({ isLoading: true, error: undefined })
		try {
			const cls = await db.classes.get(classId)
			const settings = await db.settings.get(classId)
			const idRaw = settings?.spreadsheetId
			if (!idRaw) throw new Error('No Spreadsheet ID configured for this class')
			const spreadsheetId = normalizeAndValidateSpreadsheetId(idRaw)
			await ensureCheckpointSheets(spreadsheetId)
			const identity = await probeCheckpointSpreadsheetIdentity(spreadsheetId)
			if (identity.multipleClassIds?.length) {
				throw new Error(`Spreadsheet contains multiple class IDs: ${identity.multipleClassIds.join(', ')}`)
			}
			if (identity.classId && identity.classId !== classId) {
				const sheetLabel = identity.className ? `${identity.className} (${identity.classId})` : identity.classId
				throw new Error(`Spreadsheet belongs to ${sheetLabel}, not the selected class.`)
			}
			await ensureCheckpointSettingsHeader(spreadsheetId)
			await clearSheetData(spreadsheetId, 'Settings')
			await appendRows(spreadsheetId, 'Settings', [[
				classId,
				cls?.name ?? '',
				settings?.defaultN ?? cls?.defaultN ?? DEFAULT_N,
				settings?.neverSeenWeight ?? DEFAULT_NEVER_SEEN_WEIGHT,
				settings?.cooldownWeight ?? DEFAULT_COOLDOWN_WEIGHT,
				CHECKPOINT_SETTINGS_SCHEMA_VERSION,
				'',
			]])
			if (!opts?.silent) {
				alert('Spreadsheet identity metadata repaired.')
			}
		} catch (e) {
			console.error('[Store]', 'Repair identity failed', e)
			alert(`Repair failed: ${(e as Error).message}`)
		} finally {
			set({ isLoading: false })
		}
	},
}))

// Autosave subscription
useStore.subscribe((state) => {
	if (state.currentSession && state.selectedClassId) {
		const key = `checkpoint_draft_session_${state.selectedClassId}`
		// Debounce could be added here if performance becomes an issue,
		// but standard localStorage writes are fast enough for this data size.
		localStorage.setItem(key, JSON.stringify(state.currentSession))
	}
})


