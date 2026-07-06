/**
 * Parses and validates a full spreadsheet payload into a class dataset.
 *
 * Import model: the app is the source of truth. Importing is an explicit,
 * destructive overwrite of one class's local data with whatever the sheet
 * contains. All rows are re-homed to the target class; the only class rule
 * is that the sheet must not mix rows from multiple classes.
 */

import type { AbsenceLedgerItem, Mark, SessionEntity, StudentEntity } from '../types'
import { validateLedgerRow, validateMarkRow, validateSessionRow, validateStudentRow } from './validation'

export interface SheetTabs {
	students: (string | null)[][]
	sessions: (string | null)[][]
	marks: (string | null)[][]
	ledger: (string | null)[][]
	settings: (string | null)[][]
}

export interface TabReport {
	total: number
	valid: number
	invalid: number
	sampleErrors: string[]
}

export interface ParsedImport {
	students: StudentEntity[]
	sessions: SessionEntity[]
	ledger: AbsenceLedgerItem[]
	settings?: { defaultN?: number; neverSeenWeight?: number; cooldownWeight?: number }
	reports: { students: TabReport; sessions: TabReport; marks: TabReport; ledger: TabReport }
}

export type SheetImportResult =
	| { ok: true; data: ParsedImport }
	| { ok: false; error: string; reports?: ParsedImport['reports'] }

const MAX_SAMPLE_ERRORS = 5

function parseCsvList(value: unknown): string[] {
	return String(value ?? '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
}

function body(rows: (string | null)[][]): (string | null)[][] {
	return rows.slice(1).filter((r) => r?.some((c) => String(c ?? '').trim() !== ''))
}

function makeReport(): TabReport {
	return { total: 0, valid: 0, invalid: 0, sampleErrors: [] }
}

function addError(report: TabReport, message: string) {
	report.invalid += 1
	if (report.sampleErrors.length < MAX_SAMPLE_ERRORS) report.sampleErrors.push(message)
}

function findDuplicates(values: string[]): string[] {
	const seen = new Set<string>()
	const dup = new Set<string>()
	for (const v of values) {
		if (!v) continue
		if (seen.has(v)) dup.add(v)
		else seen.add(v)
	}
	return Array.from(dup)
}

/**
 * Parse and validate all tabs. Returns entities with classId rewritten to targetClassId,
 * or a validation error if the payload is structurally unsound.
 */
export function parseSheetExport(tabs: SheetTabs, targetClassId: string): SheetImportResult {
	const reports = {
		students: makeReport(),
		sessions: makeReport(),
		marks: makeReport(),
		ledger: makeReport(),
	}

	const sourceClassIds = new Set<string>()

	// Students
	const students: StudentEntity[] = []
	const studentsBody = body(tabs.students)
	reports.students.total = studentsBody.length
	for (const [idx, row] of studentsBody.entries()) {
		const parsed = validateStudentRow(row)
		if (!parsed) {
			addError(reports.students, `Students row ${idx + 2}: missing id or displayName`)
			continue
		}
		if (parsed.classId) sourceClassIds.add(parsed.classId)
		students.push({ ...parsed, classId: targetClassId })
	}

	// Sessions
	const sessions: SessionEntity[] = []
	const sessionsBody = body(tabs.sessions)
	reports.sessions.total = sessionsBody.length
	for (const [idx, row] of sessionsBody.entries()) {
		const parsed = validateSessionRow(row)
		if (!parsed) {
			addError(reports.sessions, `Sessions row ${idx + 2}: missing id or invalid date`)
			continue
		}
		if (parsed.classId) sourceClassIds.add(parsed.classId)
		sessions.push({
			...parsed,
			classId: targetClassId,
			picks: parseCsvList(row[5]),
			carryoverIds: parseCsvList(row[7]),
			marks: {},
		})
	}

	// Marks
	const marks: Array<{ sessionId: string; studentId: string; mark: Mark; rowNumber: number }> = []
	const marksBody = body(tabs.marks)
	reports.marks.total = marksBody.length
	for (const [idx, row] of marksBody.entries()) {
		const parsed = validateMarkRow(row)
		if (!parsed) {
			addError(reports.marks, `Marks row ${idx + 2}: invalid status/sessionId/studentId/markedAt`)
			continue
		}
		marks.push({ ...parsed, rowNumber: idx + 2 })
	}

	// Ledger
	const ledger: AbsenceLedgerItem[] = []
	const ledgerBody = body(tabs.ledger)
	reports.ledger.total = ledgerBody.length
	const ledgerRowNumbers = new Map<AbsenceLedgerItem, number>()
	for (const [idx, row] of ledgerBody.entries()) {
		const parsed = validateLedgerRow(row)
		if (!parsed) {
			addError(reports.ledger, `Ledger row ${idx + 2}: missing id/studentId or invalid date`)
			continue
		}
		if (parsed.classId) sourceClassIds.add(parsed.classId)
		const item = { ...parsed, classId: targetClassId }
		ledger.push(item)
		ledgerRowNumbers.set(item, idx + 2)
	}

	// Class consistency: the sheet must contain at most one class's data
	if (sourceClassIds.size > 1) {
		return {
			ok: false,
			error: `Sheet contains data from multiple classes (${Array.from(sourceClassIds).join(', ')}). Import one class per spreadsheet.`,
			reports,
		}
	}

	// Duplicates
	for (const id of findDuplicates(students.map((s) => s.id))) {
		addError(reports.students, `Duplicate student ID: ${id}`)
	}
	for (const id of findDuplicates(sessions.map((s) => s.id))) {
		addError(reports.sessions, `Duplicate session ID: ${id}`)
	}
	for (const id of findDuplicates(ledger.map((l) => l.id))) {
		addError(reports.ledger, `Duplicate ledger ID: ${id}`)
	}
	for (const key of findDuplicates(marks.map((m) => `${m.sessionId}::${m.studentId}`))) {
		addError(reports.marks, `Duplicate mark for session/student: ${key}`)
	}

	// Referential integrity
	const studentIds = new Set(students.map((s) => s.id))
	const sessionIds = new Set(sessions.map((s) => s.id))
	for (const entry of marks) {
		if (!studentIds.has(entry.studentId)) {
			addError(reports.marks, `Marks row ${entry.rowNumber}: unknown studentId ${entry.studentId}`)
		} else if (!sessionIds.has(entry.sessionId)) {
			addError(reports.marks, `Marks row ${entry.rowNumber}: unknown sessionId ${entry.sessionId}`)
		}
	}
	for (const item of ledger) {
		const rowNumber = ledgerRowNumbers.get(item)
		if (!studentIds.has(item.studentId)) {
			addError(reports.ledger, `Ledger row ${rowNumber}: unknown studentId ${item.studentId}`)
		} else if (item.sessionId && !sessionIds.has(item.sessionId)) {
			addError(reports.ledger, `Ledger row ${rowNumber}: unknown sessionId ${item.sessionId}`)
		}
	}

	const totalInvalid =
		reports.students.invalid + reports.sessions.invalid + reports.marks.invalid + reports.ledger.invalid
	if (totalInvalid > 0) {
		const parts = Object.entries(reports)
			.filter(([, r]) => r.invalid > 0)
			.map(([name, r]) => `${name}: ${r.invalid} invalid`)
		return { ok: false, error: `Import validation failed (${parts.join(', ')}).`, reports }
	}

	reports.students.valid = students.length
	reports.sessions.valid = sessions.length
	reports.marks.valid = marks.length
	reports.ledger.valid = ledger.length

	// Attach marks to sessions
	const marksBySession = new Map<string, Record<string, Mark>>()
	for (const entry of marks) {
		const obj = marksBySession.get(entry.sessionId) || {}
		obj[entry.studentId] = entry.mark
		marksBySession.set(entry.sessionId, obj)
	}
	const sessionsWithMarks = sessions.map((s) => ({ ...s, marks: marksBySession.get(s.id) || {} }))

	// Settings (optional; header-keyed)
	let settings: ParsedImport['settings']
	const settingsHeader = (tabs.settings[0] || []).map((h) => String(h ?? '').trim())
	const settingsBody = body(tabs.settings)
	if (settingsBody.length) {
		const col = (name: string) => settingsHeader.indexOf(name)
		const row = settingsBody[0]
		const num = (idx: number) => {
			if (idx < 0) return undefined
			const n = Number(row[idx])
			return Number.isFinite(n) ? n : undefined
		}
		settings = {
			defaultN: num(col('defaultN')),
			neverSeenWeight: num(col('neverSeenWeight')),
			cooldownWeight: num(col('cooldownWeight')),
		}
	}

	return {
		ok: true,
		data: { students, sessions: sessionsWithMarks, ledger, settings, reports },
	}
}
