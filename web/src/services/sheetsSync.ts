/**
 * Google Sheets as a dumb export/import target.
 *
 * - Export: overwrite the sheet with the app's data for one class (one batch write).
 * - Import: read all tabs back; parsing/validation happens in domain/sheetImport.ts.
 *
 * The app is always the source of truth; nothing here reconciles or merges.
 */

import type { AbsenceLedgerItem, ClassEntity, PerClassSettings, SessionEntity, StudentEntity } from '../types'
import type { SheetTabs } from '../domain/sheetImport'
import {
	addSheets,
	batchClearValues,
	batchReadValues,
	batchWriteValues,
	createSpreadsheetWithTabs,
	getSheetTitles,
	spreadsheetExists,
	type CellValue,
} from './sheetsClient'

export const TAB_HEADERS: Record<string, string[]> = {
	Classes: ['id', 'name', 'defaultN'],
	Students: ['id', 'classId', 'firstName', 'lastName', 'displayName', 'externalId', 'loginId', 'sisId', 'notes', 'absenceCount'],
	Sessions: ['id', 'classId', 'date', 'createdAt', 'savedAt', 'picksCSV', 'picksNamesCSV', 'carryoverCSV', 'carryoverNamesCSV'],
	Marks: ['sessionId', 'studentId', 'displayName', 'status', 'reason', 'markedAt'],
	Ledger: ['id', 'classId', 'studentId', 'displayName', 'date', 'sessionId', 'reason', 'notes'],
	Settings: ['classId', 'className', 'defaultN', 'neverSeenWeight', 'cooldownWeight', 'lastExportedAt'],
}

const TAB_NAMES = Object.keys(TAB_HEADERS)

/** Creates a new CheckPoint spreadsheet with all tabs and headers. */
export async function createCheckpointSpreadsheet(title: string): Promise<string> {
	const spreadsheetId = await createSpreadsheetWithTabs(title, TAB_NAMES)
	await batchWriteValues(
		spreadsheetId,
		TAB_NAMES.map((tab) => ({ range: `${tab}!A1`, values: [TAB_HEADERS[tab]] })),
	)
	return spreadsheetId
}

/** Adds any missing CheckPoint tabs (with headers) to an existing spreadsheet. */
export async function ensureCheckpointTabs(spreadsheetId: string): Promise<void> {
	const existing = await getSheetTitles(spreadsheetId)
	const missing = TAB_NAMES.filter((t) => !existing.has(t))
	if (!missing.length) return
	await addSheets(spreadsheetId, missing)
	await batchWriteValues(
		spreadsheetId,
		missing.map((tab) => ({ range: `${tab}!A1`, values: [TAB_HEADERS[tab]] })),
	)
}

export interface ExportDataset {
	cls: ClassEntity
	students: StudentEntity[]
	sessions: SessionEntity[]
	ledger: AbsenceLedgerItem[]
	settings?: PerClassSettings
}

export interface ExportSummary {
	spreadsheetId: string
	exportedAt: string
	counts: { students: number; sessions: number; marks: number; ledger: number }
}

/**
 * Overwrites the spreadsheet with the class dataset. If `spreadsheetId` is missing
 * or the sheet no longer exists, a new spreadsheet is created.
 */
export async function exportClassToSheet(dataset: ExportDataset, spreadsheetId?: string): Promise<ExportSummary> {
	let id = spreadsheetId
	if (!id || !(await spreadsheetExists(id))) {
		id = await createCheckpointSpreadsheet(`CheckPoint — ${dataset.cls.name}`)
	} else {
		await ensureCheckpointTabs(id)
	}

	const exportedAt = new Date().toISOString()
	const { cls, students, ledger, settings } = dataset
	const sessions = [...dataset.sessions].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
	const nameById = new Map(students.map((s) => [s.id, s.displayName]))
	const absenceCounts = new Map<string, number>()
	for (const l of ledger) absenceCounts.set(l.studentId, (absenceCounts.get(l.studentId) || 0) + 1)

	const studentRows: CellValue[][] = students.map((s) => [
		s.id, s.classId, s.firstName ?? '', s.lastName ?? '', s.displayName,
		s.externalId ?? '', s.loginId ?? '', s.sisId ?? '', s.notes ?? '',
		absenceCounts.get(s.id) ?? 0,
	])
	const sessionRows: CellValue[][] = sessions.map((s) => [
		s.id, s.classId, s.date, s.createdAt ?? '', s.savedAt ?? '',
		s.picks.join(','),
		s.picks.map((id2) => nameById.get(id2) ?? '').join(','),
		(s.carryoverIds || []).join(','),
		(s.carryoverIds || []).map((id2) => nameById.get(id2) ?? '').join(','),
	])
	const markRows: CellValue[][] = sessions.flatMap((s) =>
		Object.entries(s.marks).map(([sid, mark]) => [
			s.id, sid, nameById.get(sid) ?? '', mark.status, mark.reason ?? '', mark.markedAt ?? '',
		]),
	)
	const ledgerRows: CellValue[][] = ledger.map((l) => [
		l.id, l.classId, l.studentId, nameById.get(l.studentId) ?? '', l.date,
		l.sessionId ?? '', l.reason ?? '', l.notes ?? '',
	])
	const settingsRow: CellValue[] = [
		cls.id, cls.name,
		settings?.defaultN ?? cls.defaultN,
		settings?.neverSeenWeight ?? 2,
		settings?.cooldownWeight ?? 0.5,
		exportedAt,
	]

	// Clear old data rows, then write everything (headers included) in one batch.
	await batchClearValues(id, TAB_NAMES.map((t) => `${t}!A2:Z`))
	const writes: Array<{ range: string; values: CellValue[][] }> = [
		{ range: 'Classes!A1', values: [TAB_HEADERS.Classes, [cls.id, cls.name, cls.defaultN]] },
		{ range: 'Students!A1', values: [TAB_HEADERS.Students, ...studentRows] },
		{ range: 'Sessions!A1', values: [TAB_HEADERS.Sessions, ...sessionRows] },
		{ range: 'Marks!A1', values: [TAB_HEADERS.Marks, ...markRows] },
		{ range: 'Ledger!A1', values: [TAB_HEADERS.Ledger, ...ledgerRows] },
		{ range: 'Settings!A1', values: [TAB_HEADERS.Settings, settingsRow] },
	]
	await batchWriteValues(id, writes)

	return {
		spreadsheetId: id,
		exportedAt,
		counts: {
			students: studentRows.length,
			sessions: sessionRows.length,
			marks: markRows.length,
			ledger: ledgerRows.length,
		},
	}
}

/** Reads all CheckPoint tabs; the caller parses them via domain/sheetImport.ts. */
export async function fetchClassTabs(spreadsheetId: string): Promise<SheetTabs> {
	const [students, sessions, marks, ledger, settings] = await batchReadValues(spreadsheetId, [
		'Students!A1:Z',
		'Sessions!A1:Z',
		'Marks!A1:Z',
		'Ledger!A1:Z',
		'Settings!A1:Z',
	])
	return { students, sessions, marks, ledger, settings }
}
