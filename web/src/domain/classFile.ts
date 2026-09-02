import type {
	AbsenceLedgerItem,
	AbsenceReason,
	ClassEntity,
	Mark,
	PerClassSettings,
	SessionEntity,
	StudentEntity,
} from '../types'
import {
	DEFAULT_COOLDOWN_WEIGHT,
	DEFAULT_N,
	DEFAULT_NEVER_SEEN_WEIGHT,
} from './sessionDraft'
import { isValidISODate } from './validation'

export const CLASS_FILE_FORMAT = 'checkpoint-class'
export const CLASS_FILE_VERSION = 1

export interface ClassFileSettings {
	defaultN: number
	neverSeenWeight: number
	cooldownWeight: number
}

export interface ClassFileBackup {
	format: typeof CLASS_FILE_FORMAT
	version: typeof CLASS_FILE_VERSION
	exportedAt: string
	class: ClassEntity
	settings: ClassFileSettings
	students: StudentEntity[]
	sessions: SessionEntity[]
	ledger: AbsenceLedgerItem[]
	draftSession?: SessionEntity
}

export interface ClassFileDataset {
	class: ClassEntity
	settings: PerClassSettings
	students: StudentEntity[]
	sessions: SessionEntity[]
	ledger: AbsenceLedgerItem[]
	draftSession?: SessionEntity
}

export type ClassFileParseResult =
	| { ok: true; data: ClassFileBackup }
	| { ok: false; error: string }

export function classFileName(className: string, exportedAt: string): string {
	const safeName = className
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'class'
	const date = exportedAt.slice(0, 10)
	return `checkpoint-${safeName}-${date}.json`
}

interface BuildDataset {
	cls: ClassEntity
	settings?: PerClassSettings
	students: StudentEntity[]
	sessions: SessionEntity[]
	ledger: AbsenceLedgerItem[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0

const isOptionalString = (value: unknown): value is string | undefined =>
	value === undefined || typeof value === 'string'

const isOptionalDate = (value: unknown): value is string | undefined =>
	value === undefined || (typeof value === 'string' && isValidISODate(value))

const isReason = (value: unknown): value is AbsenceReason | undefined =>
	value === undefined || value === 'excused' || value === 'unexcused'

const hasUniqueStrings = (values: string[]) => new Set(values).size === values.length

function validateMark(value: unknown): value is Mark {
	if (!isRecord(value)) return false
	return (
		(value.status === 'present' || value.status === 'absent') &&
		isReason(value.reason) &&
		isOptionalDate(value.markedAt)
	)
}

function validateStudent(value: unknown, classId: string): value is StudentEntity {
	if (!isRecord(value)) return false
	return (
		isNonEmptyString(value.id) &&
		value.classId === classId &&
		isNonEmptyString(value.displayName) &&
		isOptionalString(value.firstName) &&
		isOptionalString(value.lastName) &&
		isOptionalString(value.externalId) &&
		isOptionalString(value.loginId) &&
		isOptionalString(value.sisId) &&
		isOptionalString(value.notes)
	)
}

function validateSessionShape(value: unknown, classId: string): value is SessionEntity {
	if (!isRecord(value) || !isRecord(value.marks)) return false
	if (
		!isNonEmptyString(value.id) ||
		value.classId !== classId ||
		typeof value.date !== 'string' ||
		!isValidISODate(value.date) ||
		!isOptionalDate(value.createdAt) ||
		!isOptionalDate(value.savedAt) ||
		!Array.isArray(value.picks) ||
		!value.picks.every(isNonEmptyString) ||
		!hasUniqueStrings(value.picks)
	) return false
	if (
		value.carryoverIds !== undefined &&
		(!Array.isArray(value.carryoverIds) ||
			!value.carryoverIds.every(isNonEmptyString) ||
			!hasUniqueStrings(value.carryoverIds))
	) return false
	return Object.values(value.marks).every(validateMark)
}

function validateLedgerItem(value: unknown, classId: string): value is AbsenceLedgerItem {
	if (!isRecord(value)) return false
	return (
		isNonEmptyString(value.id) &&
		value.classId === classId &&
		isNonEmptyString(value.studentId) &&
		typeof value.date === 'string' &&
		isValidISODate(value.date) &&
		isOptionalString(value.sessionId) &&
		isReason(value.reason) &&
		isOptionalString(value.notes)
	)
}

function validateSessionReferences(
	session: SessionEntity,
	studentIds: Set<string>,
	label: string,
): string | undefined {
	for (const id of session.picks) {
		if (!studentIds.has(id)) return `${label} references unknown student "${id}".`
	}
	for (const id of session.carryoverIds ?? []) {
		if (!studentIds.has(id)) return `${label} references unknown carryover student "${id}".`
		if (!session.picks.includes(id)) return `${label} has a carryover student that is not in its picks.`
	}
	for (const id of Object.keys(session.marks)) {
		if (!studentIds.has(id)) return `${label} has a mark for unknown student "${id}".`
	}
	return undefined
}

export function buildClassFile(
	dataset: BuildDataset,
	draftSession?: SessionEntity,
	exportedAt = new Date().toISOString(),
): ClassFileBackup {
	return {
		format: CLASS_FILE_FORMAT,
		version: CLASS_FILE_VERSION,
		exportedAt,
		class: { ...dataset.cls },
		settings: {
			defaultN: dataset.settings?.defaultN ?? DEFAULT_N,
			neverSeenWeight: dataset.settings?.neverSeenWeight ?? DEFAULT_NEVER_SEEN_WEIGHT,
			cooldownWeight: dataset.settings?.cooldownWeight ?? DEFAULT_COOLDOWN_WEIGHT,
		},
		students: dataset.students.map((student) => ({ ...student })),
		sessions: dataset.sessions.map((session) => ({
			...session,
			picks: [...session.picks],
			carryoverIds: session.carryoverIds ? [...session.carryoverIds] : undefined,
			marks: Object.fromEntries(
				Object.entries(session.marks).map(([studentId, mark]) => [studentId, { ...mark }]),
			),
		})),
		ledger: dataset.ledger.map((item) => ({ ...item })),
		draftSession: draftSession
			? {
					...draftSession,
					picks: [...draftSession.picks],
					carryoverIds: draftSession.carryoverIds ? [...draftSession.carryoverIds] : undefined,
					marks: Object.fromEntries(
						Object.entries(draftSession.marks).map(([studentId, mark]) => [studentId, { ...mark }]),
					),
				}
			: undefined,
	}
}

export function parseClassFile(json: string): ClassFileParseResult {
	let value: unknown
	try {
		value = JSON.parse(json)
	} catch {
		return { ok: false, error: 'The selected file is not valid JSON.' }
	}
	if (!isRecord(value)) return { ok: false, error: 'The selected file is not a CheckPoint class file.' }
	if (value.format !== CLASS_FILE_FORMAT) {
		return { ok: false, error: 'The selected file is not a CheckPoint class file.' }
	}
	if (value.version !== CLASS_FILE_VERSION) {
		return { ok: false, error: `Unsupported CheckPoint class file version "${String(value.version)}".` }
	}
	if (typeof value.exportedAt !== 'string' || !isValidISODate(value.exportedAt)) {
		return { ok: false, error: 'The class file has an invalid export date.' }
	}
	if (!isRecord(value.class) || !isNonEmptyString(value.class.id) || !isNonEmptyString(value.class.name)) {
		return { ok: false, error: 'The class file has invalid class details.' }
	}
	const classId = value.class.id
	if (!isRecord(value.settings)) return { ok: false, error: 'The class file has invalid settings.' }
	const { defaultN, neverSeenWeight, cooldownWeight } = value.settings
	if (
		typeof defaultN !== 'number' ||
		!Number.isFinite(defaultN) ||
		defaultN < 1 ||
		typeof neverSeenWeight !== 'number' ||
		!Number.isFinite(neverSeenWeight) ||
		typeof cooldownWeight !== 'number' ||
		!Number.isFinite(cooldownWeight)
	) return { ok: false, error: 'The class file has invalid settings.' }

	if (!Array.isArray(value.students) || !value.students.every((row) => validateStudent(row, classId))) {
		return { ok: false, error: 'The class file has invalid student records.' }
	}
	if (!Array.isArray(value.sessions) || !value.sessions.every((row) => validateSessionShape(row, classId))) {
		return { ok: false, error: 'The class file has invalid session records.' }
	}
	if (!Array.isArray(value.ledger) || !value.ledger.every((row) => validateLedgerItem(row, classId))) {
		return { ok: false, error: 'The class file has invalid absence records.' }
	}
	if (value.draftSession !== undefined && !validateSessionShape(value.draftSession, classId)) {
		return { ok: false, error: 'The class file has an invalid draft session.' }
	}

	const students = value.students as StudentEntity[]
	const sessions = value.sessions as SessionEntity[]
	const ledger = value.ledger as AbsenceLedgerItem[]
	const draftSession = value.draftSession as SessionEntity | undefined
	const studentIds = students.map((student) => student.id)
	const sessionIds = sessions.map((session) => session.id)
	const ledgerIds = ledger.map((item) => item.id)
	if (!hasUniqueStrings(studentIds)) return { ok: false, error: 'The class file contains duplicate student IDs.' }
	if (!hasUniqueStrings(sessionIds)) return { ok: false, error: 'The class file contains duplicate session IDs.' }
	if (!hasUniqueStrings(ledgerIds)) return { ok: false, error: 'The class file contains duplicate absence IDs.' }
	if (draftSession && sessionIds.includes(draftSession.id)) {
		return { ok: false, error: 'The draft session ID duplicates a saved session ID.' }
	}

	const studentIdSet = new Set(studentIds)
	const sessionIdSet = new Set(sessionIds)
	for (const session of sessions) {
		const error = validateSessionReferences(session, studentIdSet, `Session "${session.id}"`)
		if (error) return { ok: false, error }
	}
	if (draftSession) {
		const error = validateSessionReferences(draftSession, studentIdSet, 'The draft session')
		if (error) return { ok: false, error }
	}
	for (const item of ledger) {
		if (!studentIdSet.has(item.studentId)) {
			return { ok: false, error: `Absence "${item.id}" references an unknown student.` }
		}
		if (item.sessionId && !sessionIdSet.has(item.sessionId)) {
			return { ok: false, error: `Absence "${item.id}" references an unknown session.` }
		}
	}

	return { ok: true, data: value as unknown as ClassFileBackup }
}

function remapSession(
	session: SessionEntity,
	classId: string,
	sessionId: string,
	studentIds: Map<string, string>,
): SessionEntity {
	const remapStudent = (id: string) => studentIds.get(id) as string
	return {
		...session,
		id: sessionId,
		classId,
		picks: session.picks.map(remapStudent),
		carryoverIds: session.carryoverIds?.map(remapStudent),
		marks: Object.fromEntries(
			Object.entries(session.marks).map(([studentId, mark]) => [remapStudent(studentId), { ...mark }]),
		),
	}
}

export function remapClassFile(
	backup: ClassFileBackup,
	uuid: () => string,
): ClassFileDataset {
	const classId = uuid()
	const studentIds = new Map(backup.students.map((student) => [student.id, uuid()]))
	const sessionIds = new Map(backup.sessions.map((session) => [session.id, uuid()]))
	const students = backup.students.map((student) => ({
		...student,
		id: studentIds.get(student.id) as string,
		classId,
	}))
	const sessions = backup.sessions.map((session) =>
		remapSession(session, classId, sessionIds.get(session.id) as string, studentIds),
	)
	const ledger = backup.ledger.map((item) => ({
		...item,
		id: uuid(),
		classId,
		studentId: studentIds.get(item.studentId) as string,
		sessionId: item.sessionId ? sessionIds.get(item.sessionId) : undefined,
	}))
	return {
		class: { ...backup.class, id: classId },
		settings: { classId, ...backup.settings },
		students,
		sessions,
		ledger,
		draftSession: backup.draftSession
			? remapSession(backup.draftSession, classId, uuid(), studentIds)
			: undefined,
	}
}
