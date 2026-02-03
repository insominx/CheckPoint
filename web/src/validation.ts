/**
 * Validation utilities for data import.
 * Ensures imported data meets basic integrity requirements.
 */

import type { StudentEntity, SessionEntity, AbsenceLedgerItem, Mark } from './types'

/**
 * Validate and parse a student row from imported data.
 * Returns null if the row is invalid.
 */
export function validateStudentRow(row: unknown[], classId: string): StudentEntity | null {
    const id = String(row[0] ?? '').trim()
    const rowClassId = String(row[1] ?? '').trim()
    const firstName = String(row[2] ?? '').trim() || undefined
    const lastName = String(row[3] ?? '').trim() || undefined
    const displayName = String(row[4] ?? '').trim()
    const externalId = String(row[5] ?? '').trim() || undefined
    const loginId = String(row[6] ?? '').trim() || undefined
    const sisId = String(row[7] ?? '').trim() || undefined
    const notes = String(row[8] ?? '').trim() || undefined
    // row[9] (absenceCount) is ignored during import as it is strictly derived from ledger now

    // Required fields
    if (!id || !displayName) return null

    // Class ID must match
    const finalClassId = rowClassId || classId
    if (finalClassId !== classId) return null

    return {
        id,
        classId,
        displayName,
        firstName,
        lastName,
        externalId,
        loginId,
        sisId,
        notes
    }
}

/**
 * Validate and parse a session row from imported data.
 * Returns null if the row is invalid.
 */
export function validateSessionRow(row: unknown[], classId: string): SessionEntity | null {
    const id = String(row[0] ?? '').trim()
    const rowClassId = String(row[1] ?? '').trim()
    const date = String(row[2] ?? '').trim()

    // Required fields
    if (!id || !date) return null

    // Class ID must match
    if (rowClassId && rowClassId !== classId) return null

    // Validate date format (basic ISO check)
    if (!isValidISODate(date)) return null

    return {
        id,
        classId,
        date,
        createdAt: String(row[3] ?? '') || undefined,
        savedAt: String(row[4] ?? '') || undefined,
        picks: [],
        carryoverIds: [],
        marks: {},
    }
}

/**
 * Validate and parse a ledger item row from imported data.
 * Returns null if the row is invalid.
 */
export function validateLedgerRow(row: unknown[], classId: string): AbsenceLedgerItem | null {
    const id = String(row[0] ?? '').trim()
    const rowClassId = String(row[1] ?? '').trim()
    const studentId = String(row[2] ?? '').trim()
    const date = String(row[4] ?? '').trim()

    // Required fields
    if (!id || !studentId || !date) return null

    // Class ID must match
    if (rowClassId && rowClassId !== classId) return null

	// Validate date format (basic ISO check)
	if (!isValidISODate(date)) return null

    return {
        id,
        classId,
        studentId,
        date,
        sessionId: String(row[5] ?? '') || undefined,
        reason: parseAbsenceReason(row[6]),
        notes: String(row[7] ?? '') || undefined,
    }
}

/**
 * Validate and parse a marks row from imported data.
 * Returns null if the row is invalid.
 */
export function validateMarkRow(row: unknown[]): { sessionId: string; studentId: string; mark: Mark } | null {
	const sessionId = String(row[0] ?? '').trim()
	const studentId = String(row[1] ?? '').trim()
	const statusRaw = String(row[3] ?? '').toLowerCase().trim()
	const reasonRaw = String(row[4] ?? '').toLowerCase().trim()
	const markedAtRaw = String(row[5] ?? '').trim()

	if (!sessionId || !studentId) return null
	if (statusRaw !== 'present' && statusRaw !== 'absent') return null
	if (markedAtRaw && !isValidISODate(markedAtRaw)) return null

	const reason = reasonRaw === 'excused' ? 'excused' : reasonRaw === 'unexcused' ? 'unexcused' : undefined

	return {
		sessionId,
		studentId,
		mark: {
			status: statusRaw as Mark['status'],
			reason,
			markedAt: markedAtRaw || undefined,
		},
	}
}

/**
 * Basic ISO date format validation.
 */
export function isValidISODate(dateStr: string): boolean {
    if (!dateStr) return false
    const date = new Date(dateStr)
    return !isNaN(date.getTime())
}

/**
 * Parse absence reason from import.
 */
function parseAbsenceReason(value: unknown): 'excused' | 'unexcused' | undefined {
    const str = String(value ?? '').toLowerCase().trim()
    if (str === 'excused') return 'excused'
    if (str === 'unexcused') return 'unexcused'
    return undefined
}

/**
 * Count valid and invalid rows after validation.
 */
export function logValidationResults<T>(
    entityType: string,
    originalCount: number,
    validItems: T[],
): void {
    const invalidCount = originalCount - validItems.length
    if (invalidCount > 0) {
        console.warn(`[Import] ${entityType}: Skipped ${invalidCount} invalid rows (${validItems.length} valid)`)
    }
}
