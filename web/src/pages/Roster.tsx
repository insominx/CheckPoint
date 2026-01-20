import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db'
import { useStore } from '../store'
import { parseRosterCsv, toStudentEntities } from '../utils/csv'

interface StudentDisplay {
	id: string
	displayName: string
	firstName?: string
	lastName?: string
	absenceCount: number
}

export default function Roster() {
	const { selectedClassId, getStudents, getAbsenceCount } = useStore()
	const [students, setStudents] = useState<StudentDisplay[]>([])
	const [sortKey, setSortKey] = useState<'first' | 'last' | 'absences'>('first')
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

	async function loadStudentsWithCounts() {
		if (!selectedClassId) return
		const rawStudents = await getStudents()
		// Get absence counts from ledger (single source of truth)
		const withCounts = await Promise.all(
			rawStudents.map(async (s) => ({
				id: s.id,
				displayName: s.displayName,
				firstName: s.firstName,
				lastName: s.lastName,
				absenceCount: await getAbsenceCount(s.id),
			})),
		)
		setStudents(withCounts)
	}

	useEffect(() => {
		loadStudentsWithCounts()
	}, [selectedClassId, getStudents])

	// Sorted copy for rendering
	const sorted = [...students].sort((a, b) => {
		if (sortKey === 'absences') {
			const diff = (a.absenceCount || 0) - (b.absenceCount || 0)
			return sortDir === 'asc' ? diff : -diff
		}
		const firstA = (a.firstName || a.displayName || '').toLowerCase()
		const firstB = (b.firstName || b.displayName || '').toLowerCase()
		const lastA = (a.lastName || a.displayName || '').toLowerCase()
		const lastB = (b.lastName || b.displayName || '').toLowerCase()
		const va = sortKey === 'first' ? firstA : lastA
		const vb = sortKey === 'first' ? firstB : lastB
		if (va < vb) return sortDir === 'asc' ? -1 : 1
		if (va > vb) return sortDir === 'asc' ? 1 : -1
		return 0
	})

	return (
		<div className="page">
			<h2>Roster</h2>
			{!selectedClassId ? (
				<p>Select a class first.</p>
			) : (
				<>
					<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
						<label>
							Sort by{' '}
							<select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)}>
								<option value="first">First name</option>
								<option value="last">Last name</option>
								<option value="absences">Absences</option>
							</select>
						</label>
						<label>
							Order{' '}
							<select value={sortDir} onChange={(e) => setSortDir(e.target.value as any)}>
								<option value="asc">Ascending</option>
								<option value="desc">Descending</option>
							</select>
						</label>
					</div>
					<div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
						💡 To correct an absence, go to the <strong>History</strong> page and expand the session.
					</div>
					<div>
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
								await loadStudentsWithCounts()
							}}
						/>
					</div>
					<div className="cards">
						{sorted.map((s) => (
							<div className="card" key={s.id}>
								<div style={{ fontWeight: 600, marginBottom: 8 }}>{s.displayName}</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
									<span>Absences:</span>
									<span style={{
										fontWeight: 600,
										color: s.absenceCount > 0 ? '#ef4444' : '#22c55e',
										fontSize: 18,
									}}>
										{s.absenceCount}
									</span>
								</div>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	)
}
