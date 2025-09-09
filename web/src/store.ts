import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { db } from './db'
import { appendRows, ensureCheckpointSheets, ensureSpreadsheet, clearSheetData, readValues, normalizeAndValidateSpreadsheetId } from './google'
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
	exportCurrentClassToSheets: (opts?: { recreate?: boolean }) => Promise<void>
	importCurrentClassFromSheets: () => Promise<void>
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
			// Clear data rows (keep headers) for deterministic export
			await Promise.all([
				clearSheetData(spreadsheetId, 'Classes'),
				clearSheetData(spreadsheetId, 'Students'),
				clearSheetData(spreadsheetId, 'Sessions'),
				clearSheetData(spreadsheetId, 'Marks'),
				clearSheetData(spreadsheetId, 'Ledger'),
				clearSheetData(spreadsheetId, 'Settings'),
			])
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
			// Write Students
			if (students.length) {
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
						s.absenceCount ?? 0,
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
			// Write Settings row for this class
			if (perClassSettings) {
				await appendRows(spreadsheetId, 'Settings', [[
					perClassSettings.classId,
					perClassSettings.defaultN,
					perClassSettings.neverSeenWeight,
					perClassSettings.cooldownWeight,
				]])
			}
			// Persist spreadsheetId if changed
			if (spreadsheetId && preferredId !== spreadsheetId) {
				await db.settings.put({ ...(perClassSettings || { classId }), defaultN: perClassSettings?.defaultN ?? 5, neverSeenWeight: perClassSettings?.neverSeenWeight ?? 2, cooldownWeight: perClassSettings?.cooldownWeight ?? 0.5, spreadsheetId })
			}
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
			// Read headers to verify schema, then read bodies
			const [classesRows, studentRows, sessionsRows, marksRows, ledgerRows, settingsRows] = await Promise.all([
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
					await db.students.bulkAdd(
						studentsBody.map((r) => ({
							id: String(r[0] ?? ''),
							classId: String(r[1] ?? ''),
							firstName: (r[2] as string) || undefined,
							lastName: (r[3] as string) || undefined,
							displayName: String(r[4] ?? ''),
							externalId: (r[5] as string) || undefined,
							loginId: (r[6] as string) || undefined,
							sisId: (r[7] as string) || undefined,
							notes: (r[8] as string) || undefined,
							absenceCount: Number(r[9] ?? 0),
						})),
					)
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
					const row = settingsBody.find((r) => String(r[0] ?? '') === classId)
					if (row) {
						await db.settings.put({
							classId,
							defaultN: Number(row[1] ?? 5),
							neverSeenWeight: Number(row[2] ?? 2),
							cooldownWeight: Number(row[3] ?? 0.5),
							spreadsheetId: spreadsheetId,
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
}))


