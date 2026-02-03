import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import type { AbsenceReason } from '../types'

export default function Session() {
	const navigate = useNavigate()
	const { selectedClassId, currentSession, pickStudents, redrawRandom, markStudent, saveSession, currentN, isLoading, isPickingStudents, getStudents } = useStore()
	const [studentNamesById, setStudentNamesById] = useState<Record<string, string>>({})
	const [reasonById, setReasonById] = useState<Record<string, AbsenceReason>>({})
	const [redrawMessage, setRedrawMessage] = useState<string | null>(null)

	useEffect(() => {
		if (!selectedClassId) navigate('/')
	}, [selectedClassId, navigate])

	useEffect(() => {
		if (!currentSession && selectedClassId) pickStudents()
	}, [currentSession, selectedClassId, pickStudents])

	useEffect(() => {
		; (async () => {
			if (!selectedClassId) return
			const students = await getStudents()
			const mapping: Record<string, string> = {}
			for (const s of students) mapping[s.id] = s.displayName
			setStudentNamesById(mapping)
		})()
	}, [selectedClassId, getStudents])

	const handleRedraw = async () => {
		if (!currentSession) return
		setRedrawMessage(null)
		const hasMarks = Object.keys(currentSession.marks || {}).length > 0
		let allowResetMarks = false
		if (hasMarks) {
			// eslint-disable-next-line no-alert
			const confirmed = confirm('Re-draw will clear any existing marks for this session. Continue?')
			if (!confirmed) return
			allowResetMarks = true
		}
		const result = await redrawRandom({ allowResetMarks })
		if (result === 'ok') {
			if (allowResetMarks) setReasonById({})
			return
		}
		if (result === 'blocked') {
			setRedrawMessage('Re-draw is already in progress.')
			return
		}
		if (result === 'needs-confirm') {
			setRedrawMessage('Re-draw requires confirmation to reset marks.')
			return
		}
		setRedrawMessage('Re-draw failed. Please try again.')
	}

	if (!currentSession) {
		return (
			<div style={{ padding: 16 }}>
				<h2>Session</h2>
				<button onClick={() => pickStudents()} disabled={!selectedClassId || isLoading || isPickingStudents}>
					Generate Picks (N={currentN})
				</button>
			</div>
		)
	}

	const markedCount = currentSession.picks.filter((sid) => !!currentSession.marks[sid])?.length || 0
	const allMarked = markedCount === currentSession.picks.length && currentSession.picks.length > 0

	return (
		<div className="page">
			<h2>Session</h2>
			<div className="banner">Carryovers included automatically (not capped).</div>
			<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
				<span style={{ opacity: 0.8 }}>{markedCount}/{currentSession.picks.length} marked</span>
				<button onClick={handleRedraw} disabled={isLoading || isPickingStudents}>Re-draw</button>
				<button
					disabled={!allMarked || isLoading || isPickingStudents}
					onClick={async () => {
						await saveSession()
						navigate('/')
					}}
				>
					Save
				</button>
			</div>
			{redrawMessage ? <div style={{ marginTop: 6, fontSize: 12, color: '#fbbf24' }}>{redrawMessage}</div> : null}
			<div className="cards">
				{currentSession.picks.map((sid) => (
					<div key={sid} className={`card ${currentSession.carryoverIds?.includes(sid) ? 'carryover' : ''}`}>
						<div style={{ marginBottom: 8, fontWeight: 600 }}>{studentNamesById[sid] ?? sid}</div>
						{currentSession.carryoverIds?.includes(sid) ? (
							<div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 8 }}>Carryover</div>
						) : null}
						<div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
							Absences: {/* will compute quickly */}
						</div>
						{(() => {
							const m = currentSession.marks[sid]
							const isPresent = m?.status === 'present'
							const isAbsent = m?.status === 'absent'
							return (
								<div className="toggle-group" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
									<button
										className={isPresent ? 'selected present' : ''}
										onClick={() => markStudent(sid, { status: 'present' })}
									>
										Present
									</button>
									<button
										className={isAbsent ? 'selected absent' : ''}
										onClick={() => markStudent(sid, { status: 'absent', reason: reasonById[sid] ?? 'unexcused' })}
									>
										Absent
									</button>
									<select
										value={reasonById[sid] ?? 'unexcused'}
										disabled={!isAbsent}
										onChange={(e) => setReasonById({ ...reasonById, [sid]: e.target.value as AbsenceReason })}
									>
										<option value="unexcused">Unexcused</option>
										<option value="excused">Excused</option>
									</select>
								</div>
							)
						})()}
					</div>
				))}
			</div>
		</div>
	)
}


