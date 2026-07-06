import { describe, it, expect } from 'vitest'
import { parseSheetExport, type SheetTabs } from './sheetImport'

const HEADERS = {
	students: ['id', 'classId', 'firstName', 'lastName', 'displayName', 'externalId', 'loginId', 'sisId', 'notes', 'absenceCount'],
	sessions: ['id', 'classId', 'date', 'createdAt', 'savedAt', 'picksCSV', 'picksNamesCSV', 'carryoverCSV', 'carryoverNamesCSV'],
	marks: ['sessionId', 'studentId', 'displayName', 'status', 'reason', 'markedAt'],
	ledger: ['id', 'classId', 'studentId', 'displayName', 'date', 'sessionId', 'reason', 'notes'],
	settings: ['classId', 'className', 'defaultN', 'neverSeenWeight', 'cooldownWeight', 'lastExportedAt'],
}

function tabs(partial: Partial<SheetTabs>): SheetTabs {
	return {
		students: [HEADERS.students],
		sessions: [HEADERS.sessions],
		marks: [HEADERS.marks],
		ledger: [HEADERS.ledger],
		settings: [HEADERS.settings],
		...partial,
	}
}

describe('parseSheetExport', () => {
	it('parses a complete payload and rewrites classId to the target class', () => {
		const result = parseSheetExport(
			tabs({
				students: [HEADERS.students, ['stu-1', 'source-class', 'A', 'B', 'A B']],
				sessions: [HEADERS.sessions, ['ses-1', 'source-class', '2026-01-05T10:00:00Z', '', '', 'stu-1', 'A B', 'stu-1', 'A B']],
				marks: [HEADERS.marks, ['ses-1', 'stu-1', 'A B', 'absent', 'excused', '2026-01-05T10:05:00Z']],
				ledger: [HEADERS.ledger, ['led-1', 'source-class', 'stu-1', 'A B', '2026-01-05T10:00:00Z', 'ses-1', 'excused', '']],
			}),
			'target-class',
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.data.students[0].classId).toBe('target-class')
		expect(result.data.sessions[0].classId).toBe('target-class')
		expect(result.data.sessions[0].picks).toEqual(['stu-1'])
		expect(result.data.sessions[0].marks['stu-1']).toMatchObject({ status: 'absent', reason: 'excused' })
		expect(result.data.ledger[0].classId).toBe('target-class')
	})

	it('rejects payloads mixing multiple source classes', () => {
		const result = parseSheetExport(
			tabs({
				students: [
					HEADERS.students,
					['stu-1', 'class-A', '', '', 'A'],
					['stu-2', 'class-B', '', '', 'B'],
				],
			}),
			'target-class',
		)
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error).toContain('multiple classes')
	})

	it('rejects marks that reference unknown students or sessions', () => {
		const result = parseSheetExport(
			tabs({
				students: [HEADERS.students, ['stu-1', '', '', '', 'A']],
				marks: [HEADERS.marks, ['ghost-session', 'stu-1', '', 'present', '', '']],
			}),
			'target-class',
		)
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.reports?.marks.invalid).toBe(1)
	})

	it('rejects duplicate student ids', () => {
		const result = parseSheetExport(
			tabs({
				students: [
					HEADERS.students,
					['stu-1', '', '', '', 'A'],
					['stu-1', '', '', '', 'A again'],
				],
			}),
			'target-class',
		)
		expect(result.ok).toBe(false)
	})

	it('reads optional settings values by header name', () => {
		const result = parseSheetExport(
			tabs({
				settings: [HEADERS.settings, ['source-class', 'My Class', '7', '3', '0.25', '2026-01-01T00:00:00Z']],
			}),
			'target-class',
		)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.data.settings).toMatchObject({ defaultN: 7, neverSeenWeight: 3, cooldownWeight: 0.25 })
	})

	it('accepts an empty sheet (produces an empty dataset)', () => {
		const result = parseSheetExport(tabs({}), 'target-class')
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.data.students).toEqual([])
		expect(result.data.sessions).toEqual([])
	})
})
