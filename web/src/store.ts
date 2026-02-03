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
import { countAbsencesByStudent } from './attendance'
import { canStartOperation, shouldWarnAboutConflict } from './sync'
import { validateStudentRow, validateSessionRow, validateLedgerRow, validateMarkRow, logValidationResults } from './validation'
import type { SpreadsheetIdentityProbe } from './google'

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
	isPickingStudents: boolean // Guard flag for pickStudents race condition
	opStatus: OperationStatusMap
}

type OperationKey = 'pickStudents' | 'saveSession' | 'exportSheets' | 'importSheets' | 'repairSheets'
interface OperationStatus {
	inProgress: boolean
	error?: string
	startedAt?: string
	finishedAt?: string
}
type OperationStatusMap = Record<OperationKey, OperationStatus>

type SyncReportOp = 'export' | 'import' | 'repair'
type SyncReportResult = 'ok' | 'blocked' | 'failed'
interface SyncReport {
	version: '1'
	op: SyncReportOp
	classId: string
	spreadsheetId?: string
	startedAt: string
	finishedAt?: string
	elapsedMs?: number
	identity?: SpreadsheetIdentityProbe
	tabs?: Record<string, { rowsRead?: number; rowsWritten?: number }>
	validation?: {
		students?: { total: number; valid: number; invalid: number; sampleErrors: string[] }
		sessions?: { total: number; valid: number; invalid: number; sampleErrors: string[] }
		marks?: { total: number; valid: number; invalid: number; sampleErrors: string[] }
		ledger?: { total: number; valid: number; invalid: number; sampleErrors: string[] }
	}
	result?: SyncReportResult
	errorMessage?: string
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
	/** Get students with class-scoped absence counts from ledger (single source of truth). */
	getStudentsWithAbsenceCounts: () => Promise<Array<StudentEntity & { absenceCount: number }>>
	/** Get detailed session info including student names for the History UI. */
	getSessionDetails: (sessionId: string) => Promise<{ session: SessionEntity; studentNames: Record<string, string> } | null>
}

type Store = UIState & Actions

const DEFAULT_N = 5
const DEFAULT_NEVER_SEEN_WEIGHT = 2.0
const DEFAULT_COOLDOWN_WEIGHT = 0.5
const DEFAULT_OP_STATUS: OperationStatusMap = {
	pickStudents: { inProgress: false },
	saveSession: { inProgress: false },
	exportSheets: { inProgress: false },
	importSheets: { inProgress: false },
	repairSheets: { inProgress: false },
}
const MAX_SYNC_ERROR_SAMPLES = 5

function updateOpStatus(
	set: (partial: Partial<Store> | ((state: Store) => Partial<Store>)) => void,
	op: OperationKey,
	patch: Partial<OperationStatus>,
) {
	set((state) => ({
		opStatus: {
			...state.opStatus,
			[op]: {
				...state.opStatus[op],
				...patch,
			},
		},
	}))
}

function beginOp(
	set: (partial: Partial<Store> | ((state: Store) => Partial<Store>)) => void,
	op: OperationKey,
) {
	updateOpStatus(set, op, {
		inProgress: true,
		error: undefined,
		startedAt: new Date().toISOString(),
		finishedAt: undefined,
	})
}

function endOp(
	set: (partial: Partial<Store> | ((state: Store) => Partial<Store>)) => void,
	op: OperationKey,
	error?: string,
) {
	updateOpStatus(set, op, {
		inProgress: false,
		error,
		finishedAt: new Date().toISOString(),
	})
}

function startSyncReport(op: SyncReportOp, classId: string): SyncReport {
	return {
		version: '1',
		op,
		classId,
		startedAt: new Date().toISOString(),
		tabs: {},
	}
}

function finalizeSyncReport(report: SyncReport, result: SyncReportResult, errorMessage?: string) {
	report.result = result
	report.errorMessage = errorMessage
	report.finishedAt = new Date().toISOString()
	report.elapsedMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt)
}

function writeSyncReport(report: SyncReport) {
	try {
		const key = `checkpoint_last_sync_report_${report.classId}`
		localStorage.setItem(key, JSON.stringify(report))
	} catch (e) {
		console.debug('[Store] Failed to write sync report', e)
	}
}

function parseCsvList(value: unknown): string[] {
	return String(value ?? '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
}

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
	isPickingStudents: false,
	opStatus: { ...DEFAULT_OP_STATUS },
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

		beginOp(set, 'pickStudents')
		set({ isPickingStudents: true })
		let opError: string | undefined
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
			opError = (e as Error).message
			return 'error'
		} finally {
			set({ isPickingStudents: false })
			endOp(set, 'pickStudents', opError)
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
		beginOp(set, 'saveSession')
		let opError: string | undefined
		const nowISO = new Date().toISOString()
		try {
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
		} catch (e) {
			opError = (e as Error).message
			throw e
		} finally {
			endOp(set, 'saveSession', opError)
		}
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

	async getStudentsWithAbsenceCounts() {
		const classId = get().selectedClassId
		if (!classId) return []
		const [students, ledger] = await Promise.all([
			db.students.where('classId').equals(classId).toArray(),
			db.ledger.where('classId').equals(classId).toArray(),
		])
		const counts = countAbsencesByStudent(ledger)
		return students.map((s) => ({
			...s,
			absenceCount: counts.get(s.id) ?? 0,
		}))
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
		beginOp(set, 'exportSheets')
		const report = startSyncReport('export', classId)
		let opError: string | undefined
		try {
			const cls = await db.classes.get(classId)
			const settings = (await db.settings.get(classId)) as any
			const preferredId = settings?.spreadsheetId as string | undefined
			const title = `CheckPoint — ${cls?.name || classId}`
			report.spreadsheetId = preferredId
			console.log('[Store]', 'Export start', { classId, title, preferredId, opts })
			const spreadsheetId = await ensureSpreadsheet(title, opts?.recreate ? undefined : preferredId)
			report.spreadsheetId = spreadsheetId
			await ensureCheckpointSheets(spreadsheetId)

			const identity = await probeCheckpointSpreadsheetIdentity(spreadsheetId)
			report.identity = identity
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
					finalizeSyncReport(report, 'blocked')
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
						finalizeSyncReport(report, 'blocked')
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
			let marksWritten = 0
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
				if (markRows.length) {
					await appendRows(spreadsheetId, 'Marks', markRows)
					marksWritten += markRows.length
				}
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
			report.tabs = {
				Classes: { rowsWritten: clsRow ? 1 : 0 },
				Students: { rowsWritten: students.length },
				Sessions: { rowsWritten: sessions.length },
				Marks: { rowsWritten: marksWritten },
				Ledger: { rowsWritten: ledger.length },
				Settings: { rowsWritten: 1 },
			}
			// Always save spreadsheetId and timestamp locally
			await db.settings.put({
				classId,
				defaultN: perClassSettings?.defaultN ?? 5,
				neverSeenWeight: perClassSettings?.neverSeenWeight ?? 2,
				cooldownWeight: perClassSettings?.cooldownWeight ?? 0.5,
				spreadsheetId,
				lastExportedAt: exportTimestamp,
			})
			finalizeSyncReport(report, 'ok')
			// eslint-disable-next-line no-alert
			alert('Sync to Google Sheets completed.')
		} catch (e) {
			opError = (e as Error).message
			finalizeSyncReport(report, 'failed', opError)
			console.error('[Store]', 'Export failed', e)
			// eslint-disable-next-line no-alert
			alert(`Sync failed: ${(e as Error).message}`)
		} finally {
			writeSyncReport(report)
			endOp(set, 'exportSheets', opError)
		}
	},

	async importCurrentClassFromSheets() {
		const classId = get().selectedClassId
		if (!classId) return
		beginOp(set, 'importSheets')
		const report = startSyncReport('import', classId)
		let opError: string | undefined
		try {
			const st = (await db.settings.get(classId)) as any
			const idRaw = st?.spreadsheetId as string | undefined
			if (!idRaw) throw new Error('No Spreadsheet ID configured for this class')
			const spreadsheetId = normalizeAndValidateSpreadsheetId(idRaw)
			report.spreadsheetId = spreadsheetId
			await ensureCheckpointSheets(spreadsheetId)
			const identity = await probeCheckpointSpreadsheetIdentity(spreadsheetId)
			report.identity = identity
			if (identity.multipleClassIds?.length) {
				throw new Error(`Spreadsheet contains multiple class IDs: ${identity.multipleClassIds.join(', ')}`)
			}
			// Check if we need to adopt data from a different class or legacy spreadsheet
			let sourceClassId = classId
			let adoptMode = false
			if (identity.isLegacy) {
				// Legacy spreadsheet - try to infer classId from Classes sheet or allow blind import
				const classesRows = await readValues(spreadsheetId, 'Classes!A2:B')
				const inferredClassId = classesRows?.[0]?.[0] ? String(classesRows[0][0]).trim() : null
				const inferredClassName = classesRows?.[0]?.[1] ? String(classesRows[0][1]).trim() : null
				const sheetLabel = inferredClassName ? `${inferredClassName} (${inferredClassId || 'unknown'})` : (inferredClassId || 'unknown class')
				const proceed = confirm(
					`This spreadsheet has legacy format (missing identity metadata).\n\n` +
					`Found data for: ${sheetLabel}\n\n` +
					`Do you want to import this data into the current class?\n\n` +
					`The data will be adopted and the spreadsheet will be updated with proper metadata.`
				)
				if (!proceed) {
					throw new Error('Import cancelled.')
				}
				if (inferredClassId) sourceClassId = inferredClassId
				adoptMode = true
			} else if (identity.classId && identity.classId !== classId) {
				const sheetLabel = identity.className ? `${identity.className} (${identity.classId})` : identity.classId
				const proceed = confirm(
					`This spreadsheet belongs to "${sheetLabel}".\n\n` +
					`Do you want to import this data into the current class?\n\n` +
					`The data will be adopted and associated with your current class.`
				)
				if (!proceed) {
					throw new Error('Import cancelled.')
				}
				sourceClassId = identity.classId
				adoptMode = true
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
			report.tabs = {
				Classes: { rowsRead: _classesRows.length },
				Students: { rowsRead: studentsBody.length },
				Sessions: { rowsRead: sessionsBody.length },
				Marks: { rowsRead: marksBody.length },
				Ledger: { rowsRead: ledgerBody.length },
				Settings: { rowsRead: settingsBody.length },
			}
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

			const sampleErrors = (list: string[], message: string) => {
				if (list.length < MAX_SYNC_ERROR_SAMPLES) list.push(message)
			}
			const findDuplicates = (values: string[]) => {
				const seen = new Set<string>()
				const dup = new Set<string>()
				for (const v of values) {
					if (!v) continue
					if (seen.has(v)) dup.add(v)
					else seen.add(v)
				}
				return Array.from(dup)
			}

			const students: StudentEntity[] = []
			const studentErrors: string[] = []
			let invalidStudents = 0
			for (const [idx, row] of studentsBody.entries()) {
				const parsed = validateStudentRow(row, sourceClassId)
				if (!parsed) {
					invalidStudents += 1
					sampleErrors(studentErrors, `Students row ${idx + 2}: invalid or mismatched classId`)
					continue
				}
				// If adopting, rewrite classId to the local class
				if (adoptMode) parsed.classId = classId
				students.push(parsed)
			}
			logValidationResults('Students', studentsBody.length, students)

			const sessions: SessionEntity[] = []
			const sessionErrors: string[] = []
			let invalidSessions = 0
			for (const [idx, row] of sessionsBody.entries()) {
				const parsed = validateSessionRow(row, sourceClassId)
				if (!parsed) {
					invalidSessions += 1
					sampleErrors(sessionErrors, `Sessions row ${idx + 2}: invalid or mismatched classId/date`)
					continue
				}
				const picks = parseCsvList(row[5])
				const carryoverIds = parseCsvList(row[7])
				// If adopting, rewrite classId to the local class
				if (adoptMode) parsed.classId = classId
				sessions.push({
					...parsed,
					picks,
					carryoverIds,
					marks: {},
				})
			}
			logValidationResults('Sessions', sessionsBody.length, sessions)

			const marks: Array<{ sessionId: string; studentId: string; mark: Mark; rowNumber: number }> = []
			const markErrors: string[] = []
			let invalidMarks = 0
			for (const [idx, row] of marksBody.entries()) {
				const parsed = validateMarkRow(row)
				if (!parsed) {
					invalidMarks += 1
					sampleErrors(markErrors, `Marks row ${idx + 2}: invalid status/sessionId/studentId/markedAt`)
					continue
				}
				marks.push({ ...parsed, rowNumber: idx + 2 })
			}

			const ledgerEntries: Array<{ item: AbsenceLedgerItem; rowNumber: number }> = []
			const ledgerErrors: string[] = []
			let invalidLedger = 0
			for (const [idx, row] of ledgerBody.entries()) {
				const parsed = validateLedgerRow(row, sourceClassId)
				if (!parsed) {
					invalidLedger += 1
					sampleErrors(ledgerErrors, `Ledger row ${idx + 2}: invalid or mismatched classId/date`)
					continue
				}
				// If adopting, rewrite classId to the local class
				if (adoptMode) parsed.classId = classId
				ledgerEntries.push({ item: parsed, rowNumber: idx + 2 })
			}
			logValidationResults('Ledger', ledgerBody.length, ledgerEntries.map((e) => e.item))

			const studentIds = new Set(students.map((s) => s.id))
			const sessionIds = new Set(sessions.map((s) => s.id))

			const markReferentialRows = new Set<number>()
			for (const entry of marks) {
				let hasIssue = false
				if (!studentIds.has(entry.studentId)) {
					hasIssue = true
					sampleErrors(markErrors, `Marks row ${entry.rowNumber}: unknown studentId ${entry.studentId}`)
				}
				if (!sessionIds.has(entry.sessionId)) {
					hasIssue = true
					sampleErrors(markErrors, `Marks row ${entry.rowNumber}: unknown sessionId ${entry.sessionId}`)
				}
				if (hasIssue) markReferentialRows.add(entry.rowNumber)
			}

			const ledgerReferentialRows = new Set<number>()
			for (const entry of ledgerEntries) {
				let hasIssue = false
				if (!studentIds.has(entry.item.studentId)) {
					hasIssue = true
					sampleErrors(ledgerErrors, `Ledger row ${entry.rowNumber}: unknown studentId ${entry.item.studentId}`)
				}
				if (entry.item.sessionId && !sessionIds.has(entry.item.sessionId)) {
					hasIssue = true
					sampleErrors(ledgerErrors, `Ledger row ${entry.rowNumber}: unknown sessionId ${entry.item.sessionId}`)
				}
				if (hasIssue) ledgerReferentialRows.add(entry.rowNumber)
			}

			const duplicateStudents = findDuplicates(students.map((s) => s.id))
			if (duplicateStudents.length) {
				sampleErrors(studentErrors, `Duplicate student IDs: ${duplicateStudents.slice(0, 3).join(', ')}`)
			}
			const duplicateSessions = findDuplicates(sessions.map((s) => s.id))
			if (duplicateSessions.length) {
				sampleErrors(sessionErrors, `Duplicate session IDs: ${duplicateSessions.slice(0, 3).join(', ')}`)
			}
			const duplicateLedger = findDuplicates(ledgerEntries.map((e) => e.item.id))
			if (duplicateLedger.length) {
				sampleErrors(ledgerErrors, `Duplicate ledger IDs: ${duplicateLedger.slice(0, 3).join(', ')}`)
			}
			const duplicateMarks = findDuplicates(marks.map((m) => `${m.sessionId}::${m.studentId}`))
			if (duplicateMarks.length) {
				sampleErrors(markErrors, `Duplicate marks for session/student: ${duplicateMarks.slice(0, 3).join(', ')}`)
			}

			const studentInvalidTotal = invalidStudents + duplicateStudents.length
			const sessionInvalidTotal = invalidSessions + duplicateSessions.length
			const markInvalidTotal = invalidMarks + markReferentialRows.size + duplicateMarks.length
			const ledgerInvalidTotal = invalidLedger + ledgerReferentialRows.size + duplicateLedger.length
			const studentValidCount = Math.max(0, students.length - duplicateStudents.length)
			const sessionValidCount = Math.max(0, sessions.length - duplicateSessions.length)
			const markValidCount = Math.max(0, marks.length - duplicateMarks.length - markReferentialRows.size)
			const ledgerValidCount = Math.max(0, ledgerEntries.length - duplicateLedger.length - ledgerReferentialRows.size)

			report.validation = {
				students: { total: studentsBody.length, valid: studentValidCount, invalid: studentInvalidTotal, sampleErrors: studentErrors },
				sessions: { total: sessionsBody.length, valid: sessionValidCount, invalid: sessionInvalidTotal, sampleErrors: sessionErrors },
				marks: { total: marksBody.length, valid: markValidCount, invalid: markInvalidTotal, sampleErrors: markErrors },
				ledger: { total: ledgerBody.length, valid: ledgerValidCount, invalid: ledgerInvalidTotal, sampleErrors: ledgerErrors },
			}

			if (studentInvalidTotal || sessionInvalidTotal || markInvalidTotal || ledgerInvalidTotal) {
				throw new Error(
					`Import validation failed. ` +
					`Students: ${studentInvalidTotal} invalid, ` +
					`Sessions: ${sessionInvalidTotal} invalid, ` +
					`Marks: ${markInvalidTotal} invalid, ` +
					`Ledger: ${ledgerInvalidTotal} invalid.`,
				)
			}

			const marksBySession = new Map<string, { [sid: string]: Mark }>()
			for (const entry of marks) {
				const obj = marksBySession.get(entry.sessionId) || {}
				obj[entry.studentId] = entry.mark
				marksBySession.set(entry.sessionId, obj)
			}
			const sessionsToAdd = sessions.map((s) => ({
				...s,
				marks: marksBySession.get(s.id) || {},
			}))
			const ledgerToAdd = ledgerEntries.map((e) => e.item)

			// Begin destructive overwrite for this class
			await db.transaction('rw', db.students, db.sessions, db.ledger, db.settings, async () => {
				// Clear current class data
				const sessionKeys = await db.sessions.where('classId').equals(classId).primaryKeys()
				if (sessionKeys.length) await db.sessions.bulkDelete(sessionKeys as string[])
				const ledgerKeys = await db.ledger.where('classId').equals(classId).primaryKeys()
				if (ledgerKeys.length) await db.ledger.bulkDelete(ledgerKeys as string[])
				const studentKeys = await db.students.where('classId').equals(classId).primaryKeys()
				if (studentKeys.length) await db.students.bulkDelete(studentKeys as string[])

				if (students.length) await db.students.bulkAdd(students)
				if (sessionsToAdd.length) await db.sessions.bulkAdd(sessionsToAdd)
				if (ledgerToAdd.length) await db.ledger.bulkAdd(ledgerToAdd)

				// Settings (only apply for this class if present)
				if (settingsBody.length) {
					const classIdIdx = settingsIndex.get('classId') ?? 0
					// In adopt mode, look for the source classId's settings row
					const lookupClassId = adoptMode ? sourceClassId : classId
					const row = settingsBody.find((r) => String(r[classIdIdx] ?? '') === lookupClassId)
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
			// If we adopted data, update the spreadsheet's identity to match the local class
			if (adoptMode) {
				try {
					const cls = await db.classes.get(classId)
					const settings = await db.settings.get(classId)
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
				} catch (err) {
					console.warn('[Store]', 'Failed to update spreadsheet identity after adopt', err)
				}
			}
			finalizeSyncReport(report, 'ok')
			// eslint-disable-next-line no-alert
			alert(adoptMode
				? 'Import completed! Data adopted and spreadsheet linked to this class.'
				: 'Import completed and local data overwritten for this class.'
			)
		} catch (e) {
			opError = (e as Error).message
			finalizeSyncReport(report, 'failed', opError)
			console.error('[Store]', 'Import failed', e)
			// eslint-disable-next-line no-alert
			alert(`Import failed: ${(e as Error).message}`)
		} finally {
			writeSyncReport(report)
			endOp(set, 'importSheets', opError)
		}
	},
	async repairCurrentClassSpreadsheetIdentity(opts) {
		const classId = get().selectedClassId
		if (!classId) return
		beginOp(set, 'repairSheets')
		const report = startSyncReport('repair', classId)
		let opError: string | undefined
		try {
			const cls = await db.classes.get(classId)
			const settings = await db.settings.get(classId)
			const idRaw = settings?.spreadsheetId
			if (!idRaw) throw new Error('No Spreadsheet ID configured for this class')
			const spreadsheetId = normalizeAndValidateSpreadsheetId(idRaw)
			report.spreadsheetId = spreadsheetId
			await ensureCheckpointSheets(spreadsheetId)
			const identity = await probeCheckpointSpreadsheetIdentity(spreadsheetId)
			report.identity = identity
			if (identity.multipleClassIds?.length) {
				throw new Error(`Spreadsheet contains multiple class IDs: ${identity.multipleClassIds.join(', ')}`)
			}
			if (identity.classId && identity.classId !== classId) {
				const sheetLabel = identity.className ? `${identity.className} (${identity.classId})` : identity.classId
				if (!opts?.silent) {
					const proceed = confirm(
						`This spreadsheet belongs to ${sheetLabel}.\n\n` +
						`Do you want to reassign it to the current class (${cls?.name || classId})?\n\n` +
						`This will overwrite the spreadsheet's class identity metadata.`
					)
					if (!proceed) {
						throw new Error('Reassignment cancelled.')
					}
				}
				// Allow reassignment - continue to overwrite Settings sheet
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
			report.tabs = { Settings: { rowsWritten: 1 } }
			finalizeSyncReport(report, 'ok')
			if (!opts?.silent) {
				alert('Spreadsheet identity metadata repaired.')
			}
		} catch (e) {
			opError = (e as Error).message
			finalizeSyncReport(report, 'failed', opError)
			console.error('[Store]', 'Repair identity failed', e)
			alert(`Repair failed: ${(e as Error).message}`)
		} finally {
			writeSyncReport(report)
			endOp(set, 'repairSheets', opError)
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


