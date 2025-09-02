import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { db } from '../db'
import { exportAbsencesCsv } from '../utils/csv'

export default function History() {
	const { selectedClassId } = useStore()
	const [rows, setRows] = useState<{ date: string; picks: number; absents: number }[]>([])

	useEffect(() => {
		if (!selectedClassId) return
		;(async () => {
			const sessions = await db.sessions.where('classId').equals(selectedClassId).toArray()
			sessions.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
			setRows(
				sessions.map((s) => ({
					date: s.date,
					picks: s.picks.length,
					absents: Object.values(s.marks).filter((m) => m.status === 'absent').length,
				})),
			)
		})()
	}, [selectedClassId])

	return (
		<div className="page">
			<h2>History</h2>
			<div>
				<button
					onClick={async () => {
						if (!selectedClassId) return
						const items = await db.ledger.where('classId').equals(selectedClassId).toArray()
						exportAbsencesCsv(selectedClassId, items)
					}}
					disabled={!selectedClassId}
				>
					Export Absences CSV
				</button>
			</div>
			<table>
				<thead>
					<tr>
						<th>Date</th>
						<th>Picks</th>
						<th>Absents</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.date}>
							<td>{new Date(r.date).toLocaleString()}</td>
							<td>{r.picks}</td>
							<td>{r.absents}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}


