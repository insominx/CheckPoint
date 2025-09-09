import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { db } from './db'
import { appendRows, normalizeAndValidateSpreadsheetId, ensureCheckpointSheets, spreadsheetExists } from './google'
import type { AbsenceLedgerItem, ClassEntity, Mark, SessionEntity, StudentEntity } from './types'
import { weightedSampleWithoutReplacement } from './sampling'

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
	error?: string
}

interface Actions {
	loadClasses: () => Promise<ClassEntity[]>
	createClass: (name: string) => Promise<ClassEntity>
	selectClass: (classId: string) => Promise<void>
	getStudents: () => Promise<StudentEntity[]>
	pickStudents: () => Promise<void>
	redrawRandom: () => Promise<void>
	markStudent: (studentId: string, mark: Mark) => void
	saveSession: () => Promise<void>
	deleteSession: (sessionId: string) => Promise<void>
	clearHistoryForClass: () => Promise<void>
}

type Store = UIState & Actions

const DEFAULT_N = 5
const DEFAULT_NEVER_SEEN_WEIGHT = 2.0
const DEFAULT_COOLDOWN_WEIGHT = 0.5

export const useStore = create<Store>((set, get) => ({
	isLoading: false,
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
	},
	async getStudents() {
		const classId = get().selectedClassId
		if (!classId) return []
		return db.students.where('classId').equals(classId).toArray()
	},
	async pickStudents() {
		const classId = get().selectedClassId
		if (!classId) return
		set({ isLoading: true, error: undefined })
		try {
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

			// Eligible: never marked absent
			const absentSet = new Set(Array.from(lastAbsentDateByStudent.keys()))
			const eligible = students.filter((st) => !absentSet.has(st.id))

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

			const neverWeight = settings?.neverSeenWeight ?? DEFAULT_NEVER_SEEN_WEIGHT
			const cooldownWeight = settings?.cooldownWeight ?? DEFAULT_COOLDOWN_WEIGHT
			const weighted = eligible.map((st) => {
				let w = allMarkedIds.has(st.id) ? 1.0 : neverWeight
				if (involvedInLastTwo.has(st.id)) w *= cooldownWeight
				return { item: st.id, weight: w }
			})

			const n = get().currentN
			const randomIds = weightedSampleWithoutReplacement(weighted, n)
			const carryoverIds = carryovers.map((s) => s.id)
			const picks = Array.from(new Set<string>([...carryoverIds, ...randomIds]))

			const session: SessionEntity = {
				id: uuidv4(),
				classId,
				date: new Date().toISOString(),
				picks,
				carryoverIds,
				marks: {},
			}
			set({ currentSession: session })
		} catch (e) {
			set({ error: (e as Error).message })
		} finally {
			set({ isLoading: false })
		}
	},
	async redrawRandom() {
		const s = get().currentSession
		if (!s) return get().pickStudents()
		// Re-run pickStudents logic but keep carryovers
		await get().pickStudents()
	},
	markStudent(studentId, mark) {
		const current = get().currentSession
		if (!current) return
		const updated: SessionEntity = { ...current, marks: { ...current.marks, [studentId]: mark } }
		set({ currentSession: updated })
	},
	async saveSession() {
		const session = get().currentSession
		const classId = get().selectedClassId
		if (!session || !classId) return
		// Require a valid, existing Google Sheet before saving attendance
		{
			const s = await db.settings.get(classId)
			const idRaw = (s as any)?.spreadsheetId as string | undefined
			console.log('[Store]', 'Pre-save sheet check', { classId, idRaw })
			if (!idRaw) {
				console.warn('[Store]', 'No spreadsheetId configured for class; blocking save')
				// eslint-disable-next-line no-alert
				alert('Google Sheets is not configured for this class. Open Settings and create or save a Spreadsheet ID first.')
				throw new Error('SHEETS_NOT_CONFIGURED')
			}
			const id = normalizeAndValidateSpreadsheetId(idRaw)
			const exists = await spreadsheetExists(id)
			console.log('[Store]', 'Spreadsheet existence result', { id, exists })
			if (!exists) {
				console.warn('[Store]', 'Spreadsheet missing or inaccessible; blocking save')
				// eslint-disable-next-line no-alert
				alert('The configured Spreadsheet ID does not exist or you no longer have access. Open Settings to create a new sheet or save a different ID.')
				throw new Error('SHEETS_NOT_FOUND')
			}
		}
		const nowISO = new Date().toISOString()
		const sessionToSave: SessionEntity = { ...session, date: nowISO }
		await db.transaction('rw', db.sessions, db.ledger, db.students, async () => {
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
			// Increment absenceCount for absent students
			if (absentEntries.length) {
				const ids = absentEntries.map((a) => a.studentId)
				const toUpdate = await db.students.bulkGet(ids)
				const updates = toUpdate
					.filter((s): s is StudentEntity => !!s)
					.map((s) => ({ ...s, absenceCount: (s.absenceCount || 0) + 1 }))
				await db.students.bulkPut(updates)
			}
		})

		// Dual-write to Google Sheets if configured
		try {
			const settings = await db.settings.get(classId)
			const spreadsheetIdRaw = (settings as any)?.spreadsheetId as string | undefined
			const spreadsheetId = spreadsheetIdRaw ? normalizeAndValidateSpreadsheetId(spreadsheetIdRaw) : undefined
			if (spreadsheetId) {
				console.log('[Store]', 'Saving to Google Sheets', { spreadsheetId, sessionId: sessionToSave.id })
				await ensureCheckpointSheets(spreadsheetId)
				const classStudents = await db.students.where('classId').equals(classId).toArray()
				const nameById = new Map<string, string>(classStudents.map((s) => [s.id, s.displayName]))
				const picksCSV = sessionToSave.picks.join(',')
				const picksNamesCSV = sessionToSave.picks.map((sid) => nameById.get(sid) ?? '').join(',')
				const carryoverCSV = (sessionToSave.carryoverIds || []).join(',')
				const carryoverNamesCSV = (sessionToSave.carryoverIds || []).map((sid) => nameById.get(sid) ?? '').join(',')
				// Sessions row
				await appendRows(spreadsheetId, 'Sessions', [[
					sessionToSave.id,
					sessionToSave.classId,
					sessionToSave.date,
					picksCSV,
					picksNamesCSV,
					carryoverCSV,
					carryoverNamesCSV,
				]])
				// Marks rows (append only if any marks exist)
				const markEntries = Object.entries(sessionToSave.marks)
				if (markEntries.length) {
					const markRows: (string | null)[][] = []
					for (const [sid, mark] of markEntries) {
						markRows.push([
							sessionToSave.id,
							sid,
							nameById.get(sid) ?? '',
							mark.status,
							mark.reason ?? null,
						])
					}
					await appendRows(spreadsheetId, 'Marks', markRows)
				}
				// Ledger rows (append only if any absent marks exist)
				{
					const absents = Object.entries(sessionToSave.marks).filter(([, m]) => m.status === 'absent')
					if (absents.length) {
						const ledgerRows: (string | null)[][] = []
						for (const [sid, mark] of absents) {
							ledgerRows.push([
								/* id */ '',
								classId,
								sid,
								nameById.get(sid) ?? '',
								sessionToSave.date,
								sessionToSave.id,
								mark.reason ?? null,
								null,
							])
						}
						await appendRows(spreadsheetId, 'Ledger', ledgerRows)
					}
				}
				// Basic success notice for manual testing
				// Using alert here to make it obvious in the UI without extra components
				// eslint-disable-next-line no-alert
				alert('Saved to Google Sheets successfully.')
			} else {
				console.log('[Store]', 'No spreadsheetId configured; skipping Google Sheets write')
			}
		} catch (e) {
			console.error('[Store]', 'Google Sheets write failed', e)
			// eslint-disable-next-line no-alert
			alert(`Google Sheets write failed: ${(e as Error).message}`)
		}
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
		} catch {
			// ignore FS API failures (optional feature)
		}
		set({ currentSession: undefined })
	},

	async deleteSession(sessionId) {
		const classId = get().selectedClassId
		if (!classId) return
		await db.transaction('rw', db.sessions, db.ledger, db.students, async () => {
			const session = await db.sessions.get(sessionId)
			if (!session || session.classId !== classId) return
			await db.sessions.delete(sessionId)
			const ledgerToDelete = await db.ledger.where({ classId, sessionId }).toArray()
			if (ledgerToDelete.length) {
				await db.ledger.bulkDelete(ledgerToDelete.map((l) => l.id))
				// decrement absence counts for those students
				const idToDecrement = ledgerToDelete.map((l) => l.studentId)
				const students = await db.students.bulkGet(idToDecrement)
				const updates = students
					.filter((s): s is StudentEntity => !!s)
					.map((s) => ({ ...s, absenceCount: Math.max(0, (s.absenceCount || 0) - 1) }))
				await db.students.bulkPut(updates)
			}
		})
	},

	async clearHistoryForClass() {
		const classId = get().selectedClassId
		if (!classId) return
		await db.transaction('rw', db.sessions, db.ledger, db.students, async () => {
			const sessions = await db.sessions.where('classId').equals(classId).primaryKeys()
			if (sessions.length) await db.sessions.bulkDelete(sessions as string[])
			const ledgerIds = await db.ledger.where('classId').equals(classId).primaryKeys()
			if (ledgerIds.length) await db.ledger.bulkDelete(ledgerIds as string[])
			// reset absence counts to 0 for this class
			const classStudents = await db.students.where('classId').equals(classId).toArray()
			await db.students.bulkPut(classStudents.map((s) => ({ ...s, absenceCount: 0 })))
		})
	},
}))


