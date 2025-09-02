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
			<div style={{ display: 'flex', gap: 8 }}>
				<button
					onClick={async () => {
						if (!selectedClassId) return
						const [items, classStudents] = await Promise.all([
							db.ledger.where('classId').equals(selectedClassId).toArray(),
							db.students.where('classId').equals(selectedClassId).toArray(),
						])
						const nameById = new Map(classStudents.map((s) => [s.id, s.displayName]))
						exportAbsencesCsv(selectedClassId, items, nameById)
					}}
					disabled={!selectedClassId}
				>
					Export Absences CSV
				</button>
				<button
					style={{ color: '#ef4444', borderColor: '#7f1d1d' }}
					onClick={async () => {
						if (!selectedClassId) return
						if (!confirm('Clear all sessions and absences for this class? This cannot be undone.')) return
						await (useStore.getState().clearHistoryForClass())
						// refresh list
						const sessions = await db.sessions.where('classId').equals(selectedClassId).toArray()
						sessions.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
						setRows(
							sessions.map((s) => ({
								date: s.date,
								picks: s.picks.length,
								absents: Object.values(s.marks).filter((m) => m.status === 'absent').length,
							})),
						)
					}}
					disabled={!selectedClassId}
				>
					Clear All History
				</button>
			</div>
			<table>
				<thead>
					<tr>
						<th>Date</th>
						<th>Picks</th>
						<th>Absents</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.date}>
							<td>{new Date(r.date).toLocaleString()}</td>
							<td>{r.picks}</td>
							<td>{r.absents}</td>
							<td>
								<button
									style={{ color: '#ef4444', borderColor: '#7f1d1d' }}
									onClick={async () => {
										if (!selectedClassId) return
										// find session id by date+class
										const session = await db.sessions.where({ classId: selectedClassId, date: r.date }).first()
										if (!session) return
										if (!confirm('Delete this session and its absences?')) return
										await (useStore.getState().deleteSession(session.id))
										// refresh rows
										const sessions = await db.sessions.where('classId').equals(selectedClassId).toArray()
										sessions.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
										setRows(
											sessions.map((s) => ({
												date: s.date,
												picks: s.picks.length,
												absents: Object.values(s.marks).filter((m) => m.status === 'absent').length,
											})),
										)
									}}
								>
									Delete
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}


