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
	const { selectedClassId, getStudentsWithAbsenceCounts } = useStore()
	const [students, setStudents] = useState<StudentDisplay[]>([])
	const [sortKey, setSortKey] = useState<'first' | 'last' | 'absences'>('first')
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

	async function loadStudentsWithCounts() {
		if (!selectedClassId) return
		const withCounts = await getStudentsWithAbsenceCounts()
		setStudents(withCounts.map((s) => ({
			id: s.id,
			displayName: s.displayName,
			firstName: s.firstName,
			lastName: s.lastName,
			absenceCount: s.absenceCount ?? 0,
		})))
	}

	useEffect(() => {
		loadStudentsWithCounts()
	}, [selectedClassId, getStudentsWithAbsenceCounts])

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
								const idCounts = new Map<string, number>()
								for (const s of entities) {
									idCounts.set(s.id, (idCounts.get(s.id) || 0) + 1)
								}
								const duplicateIds = Array.from(idCounts.entries())
									.filter(([, count]) => count > 1)
									.map(([id]) => id)
								if (duplicateIds.length) {
									alert(`Import blocked: ${duplicateIds.length} duplicate studentId values in the CSV. Each studentId must be unique within a class.`)
									return
								}
								const uniqueIds = Array.from(idCounts.keys())
								const existing = await db.students.bulkGet(uniqueIds)
								const collisions = existing
									.map((student, idx) => {
										if (!student || student.classId === selectedClassId) return null
										return { id: uniqueIds[idx], classId: student.classId }
									})
									.filter((entry): entry is { id: string; classId: string } => entry !== null)
								if (collisions.length) {
									alert(`Import blocked: ${collisions.length} studentId values already exist in another class. Student IDs must be globally unique with current storage.`)
									return
								}
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
