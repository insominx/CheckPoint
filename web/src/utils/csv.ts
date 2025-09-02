import Papa from 'papaparse'
import type { ParseResult } from 'papaparse'
import type { AbsenceLedgerItem, StudentEntity } from '../types'

export function exportAbsencesCsv(
	classId: string,
	items: AbsenceLedgerItem[],
	studentNameById?: Map<string, string>,
) {
	const rows = items.map((a) => ({
		date: a.date,
		studentId: a.studentId,
		displayName: studentNameById?.get(a.studentId) ?? '',
		status: 'ABSENT',
		reason: a.reason ?? '',
	}))
	const csv = Papa.unparse(rows, { header: true })
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = `absences_${classId}.csv`
	document.body.appendChild(a)
	a.click()
	document.body.removeChild(a)
	URL.revokeObjectURL(url)
}

export interface RosterRow {
	studentId?: string
	firstName?: string
	lastName?: string
	displayName?: string
	loginId?: string
	sisId?: string
	className?: string
}

export async function parseRosterCsv(file: File): Promise<RosterRow[]> {
	return new Promise((resolve, reject) => {
		Papa.parse<RosterRow>(file, {
			header: true,
			skipEmptyLines: true,
			complete: (res: ParseResult<RosterRow>) => resolve(res.data),
			error: (err: Error) => reject(err),
		})
	})
}

export function toStudentEntities(classId: string, rows: RosterRow[], uuidv4: () => string): StudentEntity[] {
	return rows
		.filter((r) => (r.displayName || r.firstName || r.lastName))
		.map((r) => {
			const displayName = r.displayName || [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || 'Unnamed'
			const id = r.studentId && r.studentId.trim().length > 0 ? r.studentId : uuidv4()
			return {
				id,
				classId,
				firstName: r.firstName,
				lastName: r.lastName,
				displayName,
				loginId: r.loginId,
				sisId: r.sisId,
				absenceCount: 0,
			}
		})
}


