/**
 * All IndexedDB (Dexie) access lives here. Pages and the store never touch `db` directly.
 */

import { v4 as uuidv4 } from 'uuid'
import { db } from './db'
import type { AbsenceLedgerItem, AbsenceReason, ClassEntity, Mark, PerClassSettings, SessionEntity, StudentEntity } from '../types'
import { DEFAULT_COOLDOWN_WEIGHT, DEFAULT_N, DEFAULT_NEVER_SEEN_WEIGHT } from '../domain/sessionDraft'
import { countAbsencesByStudent } from '../domain/attendance'

// ---------- Classes ----------

export function listClasses(): Promise<ClassEntity[]> {
	return db.classes.toArray()
}

export function getClass(classId: string): Promise<ClassEntity | undefined> {
	return db.classes.get(classId)
}

export async function createClass(name: string): Promise<ClassEntity> {
	const cls: ClassEntity = { id: uuidv4(), name, defaultN: DEFAULT_N }
	await db.classes.add(cls)
	return cls
}

/** Hard-deletes the class and every piece of local data scoped to it. */
export async function deleteClassCascade(classId: string): Promise<void> {
	await db.transaction('rw', [db.classes, db.students, db.sessions, db.ledger, db.settings], async () => {
		await db.classes.delete(classId)
		const studentKeys = await db.students.where('classId').equals(classId).primaryKeys()
		if (studentKeys.length) await db.students.bulkDelete(studentKeys)
		const sessionKeys = await db.sessions.where('classId').equals(classId).primaryKeys()
		if (sessionKeys.length) await db.sessions.bulkDelete(sessionKeys)
		const ledgerKeys = await db.ledger.where('classId').equals(classId).primaryKeys()
		if (ledgerKeys.length) await db.ledger.bulkDelete(ledgerKeys)
		await db.settings.delete(classId)
	})
}

// ---------- Students ----------

export function getStudents(classId: string): Promise<StudentEntity[]> {
	return db.students.where('classId').equals(classId).toArray()
}

export async function getStudentsWithAbsenceCounts(classId: string): Promise<Array<StudentEntity & { absenceCount: number }>> {
	const [students, ledger] = await Promise.all([
		db.students.where('classId').equals(classId).toArray(),
		db.ledger.where('classId').equals(classId).toArray(),
	])
	const counts = countAbsencesByStudent(ledger)
	return students.map((s) => ({ ...s, absenceCount: counts.get(s.id) ?? 0 }))
}

/**
 * Upserts roster students into a class. Fails closed if any incoming ID
 * already exists in a different class (student IDs are global keys in Dexie).
 */
export async function importRosterStudents(classId: string, entities: StudentEntity[]): Promise<number> {
	const ids = entities.map((s) => s.id)
	const existing = await db.students.bulkGet(ids)
	const collisions = existing.filter((s): s is StudentEntity => !!s && s.classId !== classId)
	if (collisions.length) {
		throw new Error(
			`Import blocked: ${collisions.length} student ID(s) already exist in another class. Student IDs must be unique across classes.`,
		)
	}
	await db.students.bulkPut(entities)
	return entities.length
}

// ---------- Sessions / marks / ledger ----------

export async function getSessions(classId: string): Promise<SessionEntity[]> {
	const sessions = await db.sessions.where('classId').equals(classId).toArray()
	return sessions.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
}

export function getSession(sessionId: string): Promise<SessionEntity | undefined> {
	return db.sessions.get(sessionId)
}

export function getLedger(classId: string): Promise<AbsenceLedgerItem[]> {
	return db.ledger.where('classId').equals(classId).toArray()
}

/** Everything needed to build a draft session or export a class. */
export async function getClassDataset(classId: string) {
	const [students, sessions, ledger, settings, cls] = await Promise.all([
		db.students.where('classId').equals(classId).toArray(),
		db.sessions.where('classId').equals(classId).toArray(),
		db.ledger.where('classId').equals(classId).toArray(),
		db.settings.get(classId),
		db.classes.get(classId),
	])
	return { students, sessions, ledger, settings, cls }
}

/** Persists a finalized session and appends one ledger entry per absent mark. */
export async function saveSessionWithLedger(session: SessionEntity): Promise<void> {
	await db.transaction('rw', db.sessions, db.ledger, async () => {
		await db.sessions.add(session)
		const absentEntries: AbsenceLedgerItem[] = Object.entries(session.marks)
			.filter(([, mark]) => mark.status === 'absent')
			.map(([studentId, mark]) => ({
				id: uuidv4(),
				classId: session.classId,
				studentId,
				date: session.date,
				sessionId: session.id,
				reason: mark.reason,
			}))
		if (absentEntries.length) await db.ledger.bulkAdd(absentEntries)
	})
}

export async function deleteSessionCascade(classId: string, sessionId: string): Promise<void> {
	await db.transaction('rw', db.sessions, db.ledger, async () => {
		const session = await db.sessions.get(sessionId)
		if (!session || session.classId !== classId) return
		await db.sessions.delete(sessionId)
		const ledgerToDelete = await db.ledger.where({ classId, sessionId }).primaryKeys()
		if (ledgerToDelete.length) await db.ledger.bulkDelete(ledgerToDelete)
	})
}

export async function clearHistoryForClass(classId: string): Promise<void> {
	await db.transaction('rw', db.sessions, db.ledger, async () => {
		const sessionKeys = await db.sessions.where('classId').equals(classId).primaryKeys()
		if (sessionKeys.length) await db.sessions.bulkDelete(sessionKeys)
		const ledgerKeys = await db.ledger.where('classId').equals(classId).primaryKeys()
		if (ledgerKeys.length) await db.ledger.bulkDelete(ledgerKeys)
	})
}

/** Corrects a mark on a saved session, keeping the ledger consistent. */
export async function correctMark(
	classId: string,
	sessionId: string,
	studentId: string,
	newStatus: 'present' | 'absent',
	reason?: AbsenceReason,
): Promise<void> {
	await db.transaction('rw', db.sessions, db.ledger, async () => {
		const session = await db.sessions.get(sessionId)
		if (!session || session.classId !== classId) return

		const oldMark = session.marks[studentId]
		const wasAbsent = oldMark?.status === 'absent'
		const willBeAbsent = newStatus === 'absent'

		const newMark: Mark = {
			status: newStatus,
			reason: willBeAbsent ? (reason ?? 'unexcused') : undefined,
			markedAt: new Date().toISOString(),
		}
		await db.sessions.update(sessionId, { marks: { ...session.marks, [studentId]: newMark } })

		if (wasAbsent && !willBeAbsent) {
			const toDelete = await db.ledger.where({ classId, sessionId, studentId }).primaryKeys()
			if (toDelete.length) await db.ledger.bulkDelete(toDelete)
		} else if (!wasAbsent && willBeAbsent) {
			await db.ledger.add({
				id: uuidv4(),
				classId,
				studentId,
				date: session.date,
				sessionId,
				reason: reason ?? 'unexcused',
			})
		} else if (wasAbsent && willBeAbsent && oldMark?.reason !== reason) {
			const existing = await db.ledger.where({ classId, sessionId, studentId }).first()
			if (existing) await db.ledger.update(existing.id, { reason: reason ?? 'unexcused' })
		}
	})
}

// ---------- Settings ----------

export function getSettings(classId: string): Promise<PerClassSettings | undefined> {
	return db.settings.get(classId)
}

export async function getEffectiveSettings(classId: string): Promise<PerClassSettings> {
	const [cls, settings] = await Promise.all([db.classes.get(classId), db.settings.get(classId)])
	return {
		classId,
		defaultN: settings?.defaultN ?? cls?.defaultN ?? DEFAULT_N,
		neverSeenWeight: settings?.neverSeenWeight ?? DEFAULT_NEVER_SEEN_WEIGHT,
		cooldownWeight: settings?.cooldownWeight ?? DEFAULT_COOLDOWN_WEIGHT,
		spreadsheetId: settings?.spreadsheetId,
		lastExportedAt: settings?.lastExportedAt,
	}
}

export async function updateSettings(
	classId: string,
	updates: Partial<Pick<PerClassSettings, 'defaultN' | 'neverSeenWeight' | 'cooldownWeight' | 'spreadsheetId' | 'lastExportedAt'>>,
): Promise<void> {
	if (updates.spreadsheetId) {
		const existing = await db.settings.get(classId)
		if (updates.spreadsheetId !== existing?.spreadsheetId) {
			const all = await db.settings.toArray()
			const conflict = all.find((s) => s.spreadsheetId === updates.spreadsheetId && s.classId !== classId)
			if (conflict) {
				const cls = await db.classes.get(conflict.classId)
				throw new Error(`That spreadsheet is already linked to "${cls?.name ?? conflict.classId}".`)
			}
		}
	}
	const current = await getEffectiveSettings(classId)
	await db.settings.put({ ...current, ...updates, classId })
	if (updates.defaultN !== undefined) {
		const cls = await db.classes.get(classId)
		if (cls) await db.classes.put({ ...cls, defaultN: updates.defaultN })
	}
}

// ---------- Import (destructive overwrite of one class) ----------

export async function replaceClassData(
	classId: string,
	data: {
		students: StudentEntity[]
		sessions: SessionEntity[]
		ledger: AbsenceLedgerItem[]
		settings?: { defaultN?: number; neverSeenWeight?: number; cooldownWeight?: number }
		spreadsheetId?: string
	},
): Promise<void> {
	await db.transaction('rw', [db.students, db.sessions, db.ledger, db.settings, db.classes], async () => {
		for (const table of [db.sessions, db.ledger, db.students] as const) {
			const keys = await table.where('classId').equals(classId).primaryKeys()
			if (keys.length) await table.bulkDelete(keys as string[])
		}
		if (data.students.length) await db.students.bulkAdd(data.students)
		if (data.sessions.length) await db.sessions.bulkAdd(data.sessions)
		if (data.ledger.length) await db.ledger.bulkAdd(data.ledger)

		const current = await db.settings.get(classId)
		const cls = await db.classes.get(classId)
		const defaultN = data.settings?.defaultN ?? current?.defaultN ?? cls?.defaultN ?? DEFAULT_N
		await db.settings.put({
			classId,
			defaultN,
			neverSeenWeight: data.settings?.neverSeenWeight ?? current?.neverSeenWeight ?? DEFAULT_NEVER_SEEN_WEIGHT,
			cooldownWeight: data.settings?.cooldownWeight ?? current?.cooldownWeight ?? DEFAULT_COOLDOWN_WEIGHT,
			spreadsheetId: data.spreadsheetId ?? current?.spreadsheetId,
			lastExportedAt: current?.lastExportedAt,
		})
		if (cls && cls.defaultN !== defaultN) await db.classes.put({ ...cls, defaultN })
	})
}
