import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db'
import { useStore } from '../store'
import { parseRosterCsv, toStudentEntities } from '../utils/csv'

export default function Roster() {
	const { selectedClassId, getStudents } = useStore()
	const [students, setStudents] = useState<{ id: string; displayName: string; firstName?: string; lastName?: string; absenceCount: number }[]>([])
	const [sortKey, setSortKey] = useState<'first' | 'last' | 'absences'>('first')
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

	async function updateAbsenceCount(studentId: string, nextCount: number) {
		const clamped = Math.max(0, Math.floor(nextCount))
		await db.students.update(studentId, { absenceCount: clamped })
		setStudents((prev) => prev.map((s) => (s.id === studentId ? { ...s, absenceCount: clamped } : s)))
		// If count is zero, also clear ledger entries for this student in this class to remove carryover
		if (clamped === 0 && selectedClassId) {
			const items = await db.ledger.where('classId').equals(selectedClassId).and((l) => l.studentId === studentId).toArray()
			if (items.length) {
				await db.ledger.bulkDelete(items.map((i) => i.id))
			}
		}
	}

	useEffect(() => {
		if (!selectedClassId) return
		getStudents().then((s) =>
			setStudents(
				s.map((x) => ({ id: x.id, displayName: x.displayName, firstName: x.firstName, lastName: x.lastName, absenceCount: x.absenceCount })),
			),
		)
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
					<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
								const fresh = await getStudents()
								setStudents(
									fresh.map((x) => ({ id: x.id, displayName: x.displayName, firstName: x.firstName, lastName: x.lastName, absenceCount: x.absenceCount })),
								)
							}}
						/>
					</div>
					<div className="cards">
						{sorted.map((s) => (
							<div className="card" key={s.id}>
								<div style={{ fontWeight: 600, marginBottom: 8 }}>{s.displayName}</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
									<span>Absences:</span>
									<button onClick={() => updateAbsenceCount(s.id, (s.absenceCount || 0) - 1)}>-</button>
									<input
										type="number"
										min={0}
										value={s.absenceCount || 0}
										onChange={(e) => {
											const val = Number(e.target.value)
											setStudents((prev) => prev.map((it) => (it.id === s.id ? { ...it, absenceCount: isNaN(val) ? 0 : val } : it)))
										}}
										onBlur={(e) => updateAbsenceCount(s.id, Number(e.target.value))}
										style={{ width: 80 }}
									/>
									<button onClick={() => updateAbsenceCount(s.id, (s.absenceCount || 0) + 1)}>+</button>
								</div>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	)
}


