import { Fragment, useCallback, useEffect, useState } from 'react'
import { useStore } from '../store'
import { useConfirm } from '../components/Dialog'
import { useToast } from '../components/Toast'
import * as repo from '../data/repository'
import { exportAbsencesCsv } from '../utils/csv'
import type { AbsenceReason, SessionEntity } from '../types'

interface SessionRow {
	id: string
	date: string
	picks: number
	present: number
	absent: number
}

interface ExpandedDetails {
	session: SessionEntity
	studentNames: Record<string, string>
}

export default function History() {
	const { ready, selectedClassId, selectedClass } = useStore()
	const confirm = useConfirm()
	const toast = useToast()
	const [rows, setRows] = useState<SessionRow[]>([])
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const [expanded, setExpanded] = useState<ExpandedDetails | null>(null)
	const [correcting, setCorrecting] = useState(false)

	const load = useCallback(async () => {
		if (!selectedClassId) return
		const sessions = await repo.getSessions(selectedClassId)
		setRows(
			sessions.map((s) => {
				const marks = Object.values(s.marks)
				return {
					id: s.id,
					date: s.date,
					picks: s.picks.length,
					present: marks.filter((m) => m.status === 'present').length,
					absent: marks.filter((m) => m.status === 'absent').length,
				}
			}),
		)
	}, [selectedClassId])

	useEffect(() => {
		load()
		setExpandedId(null)
		setExpanded(null)
	}, [load])

	if (!ready) return null

	if (!selectedClassId) {
		return (
			<div className="page">
				<div className="empty"><h3>No class selected</h3><p>Pick a class in the sidebar first.</p></div>
			</div>
		)
	}

	const loadDetails = async (sessionId: string) => {
		const [session, students] = await Promise.all([
			repo.getSession(sessionId),
			repo.getStudents(selectedClassId),
		])
		if (!session) return
		const studentNames: Record<string, string> = {}
		for (const s of students) studentNames[s.id] = s.displayName
		setExpanded({ session, studentNames })
	}

	const handleExpand = async (sessionId: string) => {
		if (expandedId === sessionId) {
			setExpandedId(null)
			setExpanded(null)
			return
		}
		setExpandedId(sessionId)
		await loadDetails(sessionId)
	}

	const handleCorrect = async (studentId: string, newStatus: 'present' | 'absent', reason?: AbsenceReason) => {
		if (!expandedId) return
		setCorrecting(true)
		try {
			await repo.correctMark(selectedClassId, expandedId, studentId, newStatus, reason)
			await Promise.all([load(), loadDetails(expandedId)])
		} finally {
			setCorrecting(false)
		}
	}

	const handleExportCsv = async () => {
		const [items, students] = await Promise.all([
			repo.getLedger(selectedClassId),
			repo.getStudents(selectedClassId),
		])
		if (!items.length) {
			toast.info('No absences recorded yet — nothing to export.')
			return
		}
		exportAbsencesCsv(selectedClassId, items, new Map(students.map((s) => [s.id, s.displayName])))
	}

	const handleClearAll = async () => {
		const proceed = await confirm({
			title: 'Clear all history?',
			message: `Every session and absence record for "${selectedClass?.name}" will be deleted. The roster stays.\n\nThis cannot be undone.`,
			confirmLabel: 'Clear history',
			danger: true,
		})
		if (!proceed) return
		await repo.clearHistoryForClass(selectedClassId)
		await load()
		setExpandedId(null)
		setExpanded(null)
		toast.success('History cleared.')
	}

	const handleDeleteSession = async (sessionId: string, date: string) => {
		const proceed = await confirm({
			title: 'Delete this session?',
			message: `The session from ${new Date(date).toLocaleString()} and its absence records will be removed.`,
			confirmLabel: 'Delete session',
			danger: true,
		})
		if (!proceed) return
		await repo.deleteSessionCascade(selectedClassId, sessionId)
		await load()
		if (expandedId === sessionId) {
			setExpandedId(null)
			setExpanded(null)
		}
	}

	return (
		<div className="page">
			<div className="page-header">
				<div>
					<h1>History</h1>
					<p className="sub">{selectedClass?.name} — {rows.length} saved session{rows.length === 1 ? '' : 's'}</p>
				</div>
				<div className="page-actions">
					<button className="btn" onClick={handleExportCsv}>Export absences CSV</button>
					<button className="btn btn-danger" onClick={handleClearAll} disabled={!rows.length}>Clear all history</button>
				</div>
			</div>

			{rows.length === 0 ? (
				<div className="empty">
					<h3>No sessions yet</h3>
					<p>Saved attendance checks show up here. Expand a session to review or correct marks.</p>
				</div>
			) : (
				<div className="table-wrap">
					<table className="table">
						<thead>
							<tr>
								<th style={{ width: 28 }} />
								<th>Date</th>
								<th className="num">Checked</th>
								<th className="num">Present</th>
								<th className="num">Absent</th>
								<th style={{ width: 100 }} />
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<Fragment key={r.id}>
									<tr className="clickable" onClick={() => handleExpand(r.id)}>
										<td className="muted">{expandedId === r.id ? '▾' : '▸'}</td>
										<td>{new Date(r.date).toLocaleString()}</td>
										<td className="num">{r.picks}</td>
										<td className="num">{r.present}</td>
										<td className="num">{r.absent > 0 ? <span className="badge badge-danger">{r.absent}</span> : 0}</td>
										<td style={{ textAlign: 'right' }}>
											<button
												className="btn btn-sm btn-ghost"
												onClick={(e) => {
													e.stopPropagation()
													handleDeleteSession(r.id, r.date)
												}}
											>
												Delete
											</button>
										</td>
									</tr>
									{expandedId === r.id && expanded && (
										<tr className="expand-row">
											<td colSpan={6}>
												<p className="faint" style={{ marginBottom: 10 }}>Click a status to correct it — the absence ledger stays in sync.</p>
												<div className="cards">
													{expanded.session.picks.map((sid) => {
														const mark = expanded.session.marks[sid]
														const isAbsent = mark?.status === 'absent'
														const isCarryover = expanded.session.carryoverIds?.includes(sid)
														return (
															<div key={sid} className={`student-card ${isCarryover ? 'carryover' : ''}`}>
																<div className="name">
																	<span>{expanded.studentNames[sid] ?? sid}</span>
																	{isCarryover && <span className="badge badge-warn">recheck</span>}
																</div>
																<div className="meta">
																	{mark
																		? <>Marked <strong style={{ color: isAbsent ? 'var(--danger)' : 'var(--success)' }}>{mark.status}</strong>{isAbsent && mark.reason ? ` (${mark.reason})` : ''}</>
																		: 'Not marked'}
																</div>
																<div className="row">
																	{isAbsent ? (
																		<>
																			<button className="btn btn-sm" disabled={correcting} onClick={() => handleCorrect(sid, 'present')}>
																				Mark present
																			</button>
																			<button
																				className="btn btn-sm btn-ghost"
																				disabled={correcting}
																				onClick={() => handleCorrect(sid, 'absent', mark?.reason === 'excused' ? 'unexcused' : 'excused')}
																			>
																				{mark?.reason === 'excused' ? 'Set unexcused' : 'Set excused'}
																			</button>
																		</>
																	) : (
																		<button className="btn btn-sm" disabled={correcting} onClick={() => handleCorrect(sid, 'absent', 'unexcused')}>
																			Mark absent
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
								</Fragment>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	)
}
