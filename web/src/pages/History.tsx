import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { db } from '../db' // Needed for CSV export
import { exportAbsencesCsv } from '../utils/csv'
import type { SessionEntity, AbsenceReason } from '../types'

interface SessionRow {
	id: string
	date: string
	picks: number
	absents: number
}

interface ExpandedDetails {
	session: SessionEntity
	studentNames: Record<string, string>
}

export default function History() {
	const { selectedClassId, getSessions, getSessionDetails, correctMark, deleteSession, clearHistoryForClass } = useStore()
	const [rows, setRows] = useState<SessionRow[]>([])
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const [expandedDetails, setExpandedDetails] = useState<ExpandedDetails | null>(null)
	const [correcting, setCorrecting] = useState(false)

	async function loadSessions() {
		if (!selectedClassId) return
		const sessions = await getSessions()
		setRows(
			sessions.map((s) => ({
				id: s.id,
				date: s.date,
				picks: s.picks.length,
				absents: Object.values(s.marks).filter((m) => m.status === 'absent').length,
			})),
		)
	}

	useEffect(() => {
		loadSessions()
		setExpandedId(null)
		setExpandedDetails(null)
	}, [selectedClassId])

	async function handleExpand(sessionId: string) {
		if (expandedId === sessionId) {
			setExpandedId(null)
			setExpandedDetails(null)
			return
		}
		const details = await getSessionDetails(sessionId)
		if (details) {
			setExpandedId(sessionId)
			setExpandedDetails(details)
		}
	}

	async function handleCorrect(studentId: string, newStatus: 'present' | 'absent', reason?: AbsenceReason) {
		if (!expandedId) return
		setCorrecting(true)
		try {
			await correctMark(expandedId, studentId, newStatus, reason)
			// Refresh both the list and expanded details
			await loadSessions()
			const details = await getSessionDetails(expandedId)
			if (details) setExpandedDetails(details)
		} finally {
			setCorrecting(false)
		}
	}

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
						const nameById = new Map<string, string>(classStudents.map((s) => [s.id, s.displayName]))
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
						await clearHistoryForClass()
						await loadSessions()
						setExpandedId(null)
						setExpandedDetails(null)
					}}
					disabled={!selectedClassId}
				>
					Clear All History
				</button>
			</div>
			<table>
				<thead>
					<tr>
						<th></th>
						<th>Date</th>
						<th>Picks</th>
						<th>Absents</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<>
							<tr key={r.id} onClick={() => handleExpand(r.id)} style={{ cursor: 'pointer' }}>
								<td style={{ width: 24 }}>{expandedId === r.id ? '▼' : '▶'}</td>
								<td>{new Date(r.date).toLocaleString()}</td>
								<td>{r.picks}</td>
								<td>{r.absents}</td>
								<td>
									<button
										style={{ color: '#ef4444', borderColor: '#7f1d1d' }}
										onClick={async (e) => {
											e.stopPropagation()
											if (!selectedClassId) return
											if (!confirm('Delete this session and its absences?')) return
											await deleteSession(r.id)
											await loadSessions()
											if (expandedId === r.id) {
												setExpandedId(null)
												setExpandedDetails(null)
											}
										}}
									>
										Delete
									</button>
								</td>
							</tr>
							{expandedId === r.id && expandedDetails && (
								<tr key={`${r.id}-details`}>
									<td colSpan={5} style={{ background: 'rgba(255,255,255,0.05)', padding: 12 }}>
										<div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Session Details — Click to correct marks</div>
										<div className="cards" style={{ gap: 8, display: 'flex', flexWrap: 'wrap' }}>
											{expandedDetails.session.picks.map((sid) => {
												const mark = expandedDetails.session.marks[sid]
												const isAbsent = mark?.status === 'absent'
												const isCarryover = expandedDetails.session.carryoverIds?.includes(sid)
												return (
													<div
														key={sid}
														className="card"
														style={{
															minWidth: 180,
															padding: 12,
															border: isCarryover ? '2px solid #fbbf24' : undefined,
														}}
													>
														<div style={{ fontWeight: 600, marginBottom: 4 }}>
															{expandedDetails.studentNames[sid] ?? sid}
														</div>
														{isCarryover && <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 4 }}>Carryover</div>}
														<div style={{ fontSize: 12, marginBottom: 8 }}>
															Status: <strong style={{ color: isAbsent ? '#ef4444' : '#22c55e' }}>{mark?.status ?? 'unmarked'}</strong>
															{isAbsent && mark?.reason && <span> ({mark.reason})</span>}
														</div>
														<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
															{isAbsent ? (
																<button
																	disabled={correcting}
																	onClick={() => handleCorrect(sid, 'present')}
																	style={{ background: '#166534', borderColor: '#166534' }}
																>
																	→ Present
																</button>
															) : (
																<>
																	<button
																		disabled={correcting}
																		onClick={() => handleCorrect(sid, 'absent', 'unexcused')}
																		style={{ background: '#991b1b', borderColor: '#991b1b' }}
																	>
																		→ Absent
																	</button>
																</>
															)}
															{isAbsent && (
																<button
																	disabled={correcting}
																	onClick={() => handleCorrect(sid, 'absent', mark?.reason === 'excused' ? 'unexcused' : 'excused')}
																	style={{ fontSize: 11 }}
																>
																	{mark?.reason === 'excused' ? 'Set Unexcused' : 'Set Excused'}
																</button>
															)}
														</div>
													</div>
												)
											})}
										</div>
									</td>
								</tr>
							)}
						</>
					))}
				</tbody>
			</table>
		</div>
	)
}
