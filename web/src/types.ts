export type AbsenceReason = 'excused' | 'unexcused'

export interface ClassEntity {
	id: string
	name: string
	csvPath?: string
	defaultN: number
}

export interface StudentEntity {
	id: string
	classId: string
	firstName?: string
	lastName?: string
	displayName: string
	externalId?: string
	loginId?: string
	sisId?: string
	notes?: string
	absenceCount: number
}

export type AttendanceStatus = 'present' | 'absent'

export interface Mark {
	status: AttendanceStatus
	reason?: AbsenceReason
}

export interface SessionEntity {
	id: string
	classId: string
	date: string // ISO string
	/**
	 * Set of student IDs shown in this session (carryovers ∪ random draw)
	 */
	picks: string[]
	/**
	 * Subset of picks that are carryovers (derived from ledger)
	 */
	carryoverIds?: string[]
	/**
	 * A mapping of studentId -> mark for this session
	 */
	marks: Record<string, Mark>
}

export interface AbsenceLedgerItem {
	id: string
	classId: string
	studentId: string
	date: string // ISO string
	sessionId?: string
	reason?: AbsenceReason
	notes?: string
}

export interface PerClassSettings {
	classId: string
	defaultN: number
	neverSeenWeight: number
	cooldownWeight: number
	csvFileHandle?: unknown
	spreadsheetId?: string
}


