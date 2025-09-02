import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { db } from '../db'
import type { AbsenceReason } from '../types'

export default function Session() {
	const navigate = useNavigate()
	const { selectedClassId, currentSession, pickStudents, redrawRandom, markStudent, saveSession, currentN, isLoading } = useStore()
const [studentNamesById, setStudentNamesById] = useState<Record<string, string>>({})
const [reasonById, setReasonById] = useState<Record<string, AbsenceReason>>({})

	useEffect(() => {
		if (!selectedClassId) navigate('/')
	}, [selectedClassId, navigate])

	useEffect(() => {
		if (!currentSession && selectedClassId) pickStudents()
	}, [currentSession, selectedClassId, pickStudents])

	useEffect(() => {
		;(async () => {
			if (!selectedClassId) return
			const students = await db.students.where('classId').equals(selectedClassId).toArray()
			const mapping: Record<string, string> = {}
			for (const s of students) mapping[s.id] = s.displayName
			setStudentNamesById(mapping)
		})()
	}, [selectedClassId])

	if (!currentSession) {
		return (
			<div style={{ padding: 16 }}>
				<h2>Session</h2>
				<button onClick={() => pickStudents()} disabled={!selectedClassId || isLoading}>
					Generate Picks (N={currentN})
				</button>
			</div>
		)
	}

	return (
		<div className="page">
			<h2>Session</h2>
			<div className="banner">Carryovers included automatically (not capped).</div>
			<div style={{ display: 'flex', gap: 8 }}>
				<button onClick={() => redrawRandom()} disabled={isLoading}>Re-draw</button>
				<button
					onClick={async () => {
						await saveSession()
						navigate('/')
					}}
				>
					Save
				</button>
			</div>
			<div className="cards">
				{currentSession.picks.map((sid) => (
					<div key={sid} className="card">
						<div style={{ marginBottom: 8, fontWeight: 600 }}>{studentNamesById[sid] ?? sid}</div>
						<div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
							Absences: {/* will compute quickly */}
						</div>
						<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
							<button onClick={() => markStudent(sid, { status: 'present' })}>Present</button>
							<button onClick={() => markStudent(sid, { status: 'absent', reason: reasonById[sid] ?? 'unexcused' })}>Absent</button>
							<select
								value={reasonById[sid] ?? 'unexcused'}
								onChange={(e) => setReasonById({ ...reasonById, [sid]: e.target.value as AbsenceReason })}
							>
								<option value="unexcused">Unexcused</option>
								<option value="excused">Excused</option>
							</select>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}


