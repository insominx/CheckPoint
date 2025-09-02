import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db'
import { useStore } from '../store'
import { parseRosterCsv, toStudentEntities } from '../utils/csv'

export default function Roster() {
	const { selectedClassId, getStudents } = useStore()
	const [students, setStudents] = useState<{ id: string; displayName: string; absenceCount: number }[]>([])

	useEffect(() => {
		if (!selectedClassId) return
		getStudents().then((s) => setStudents(s.map((x) => ({ id: x.id, displayName: x.displayName, absenceCount: x.absenceCount }))))
	}, [selectedClassId, getStudents])

	return (
		<div style={{ padding: 16 }}>
			<h2>Roster</h2>
			{!selectedClassId ? (
				<p>Select a class first.</p>
			) : (
				<>
					<div style={{ marginBottom: 12 }}>
						<input
							type="file"
							accept=".csv"
							onChange={async (e) => {
								const file = e.target.files?.[0]
								if (!file || !selectedClassId) return
								const rows = await parseRosterCsv(file)
								const entities = toStudentEntities(selectedClassId, rows, uuidv4)
								await db.transaction('rw', db.students, async () => {
									for (const s of entities) {
										await db.students.put(s)
									}
								})
								const fresh = await getStudents()
								setStudents(fresh.map((x) => ({ id: x.id, displayName: x.displayName, absenceCount: x.absenceCount })))
							}}
						/>
					</div>
					<ul>
						{students.map((s) => (
							<li key={s.id}>{s.displayName} — absences: {s.absenceCount}</li>
						))}
					</ul>
				</>
			)}
		</div>
	)
}


