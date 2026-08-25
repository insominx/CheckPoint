import { Fragment, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useStore } from '../store'
import { useConfirm } from '../components/Dialog'
import { useToast } from '../components/Toast'
import * as repo from '../data/repository'
import { exportAbsencesCsv } from '../utils/csv'
import type { AbsenceReason } from '../types'
import { reduceExpansion, shouldCommitHistoryDetails, shouldCommitHistoryRows } from './historyExpansion'

interface SessionRow {
	id: string
	date: string
	picks: number
	present: number
	absent: number
}

export default function History() {
	const { ready, selectedClass } = useStore()
	const classId = selectedClass?.id
	const confirm = useConfirm()
	const toast = useToast()
	const [rows, setRows] = useState<SessionRow[]>([])
	const [expansion, dispatchExpansion] = useReducer(reduceExpansion, { kind: 'closed' })
	const requestId = useRef(0)
	const rowsRequestId = useRef(0)
	const currentClassId = useRef(classId)
	currentClassId.current = classId

	const load = useCallback(async (targetClassId = classId) => {
		if (!targetClassId) return
		const request = ++rowsRequestId.current
		const sessions = await repo.getSessions(targetClassId)
		if (!shouldCommitHistoryRows({
			requestedClassId: targetClassId,
			currentClassId: currentClassId.current,
			requestedGeneration: request,
			currentGeneration: rowsRequestId.current,
		})) return
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
	}, [classId])

	useEffect(() => {
		requestId.current += 1
		dispatchExpansion({ type: 'close' })
		setRows([])
		void load(classId)
	}, [classId, load])

	if (!ready) return null

	if (!classId) {
		return (
			<div className="page">
				<div className="empty"><h3>No class selected</h3><p>Pick a class in the sidebar first.</p></div>
			</div>
		)
	}

	const loadDetails = async (targetClassId: string, sessionId: string, request: number) => {
		const [session, students] = await Promise.all([
			repo.getSession(sessionId),
			repo.getStudents(targetClassId),
		])
		if (!session || !shouldCommitHistoryDetails({
			requestedClassId: targetClassId,
			currentClassId: currentClassId.current,
			requestedGeneration: request,
			currentGeneration: requestId.current,
			sessionClassId: session.classId,
		})) return
		const studentNames: Record<string, string> = {}
		for (const s of students) studentNames[s.id] = s.displayName
		dispatchExpansion({ type: 'loaded', classId: targetClassId, sessionId, requestId: request, details: { session, studentNames } })
	}

	const handleExpand = async (sessionId: string) => {
		if (expansion.kind !== 'closed' && expansion.sessionId === sessionId) {
			requestId.current += 1
			dispatchExpansion({ type: 'close' })
			return
		}
		const request = ++requestId.current
		dispatchExpansion({ type: 'load', classId, sessionId, requestId: request })
		await loadDetails(classId, sessionId, request)
	}

	const handleCorrect = async (studentId: string, newStatus: 'present' | 'absent', reason?: AbsenceReason) => {
		if (expansion.kind !== 'open' || expansion.classId !== classId) return
		const { classId: targetClassId, sessionId, requestId: request } = expansion
		dispatchExpansion({ type: 'correcting', classId: targetClassId, sessionId, requestId: request, value: true })
		try {
			await repo.correctMark(targetClassId, sessionId, studentId, newStatus, reason)
			await Promise.all([load(targetClassId), loadDetails(targetClassId, sessionId, request)])
		} finally {
			dispatchExpansion({ type: 'correcting', classId: targetClassId, sessionId, requestId: request, value: false })
		}
	}

	const handleExportCsv = async () => {
		const [items, students] = await Promise.all([
			repo.getLedger(classId),
			repo.getStudents(classId),
		])
		if (!items.length) {
			toast.info('No absences recorded yet — nothing to export.')
			return
		}
		exportAbsencesCsv(classId, items, new Map(students.map((s) => [s.id, s.displayName])))
	}

	const handleClearAll = async () => {
		const proceed = await confirm({
			title: 'Clear all history?',
			message: `Every session and absence record for "${selectedClass?.name}" will be deleted. The roster stays.\n\nThis cannot be undone.`,
			confirmLabel: 'Clear history',
			danger: true,
		})
		if (!proceed) return
		await repo.clearHistoryForClass(classId)
		await load()
		requestId.current += 1
		dispatchExpansion({ type: 'close' })
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
		await repo.deleteSessionCascade(classId, sessionId)
		await load()
		if (expansion.kind !== 'closed' && expansion.sessionId === sessionId) {
			requestId.current += 1
			dispatchExpansion({ type: 'close' })
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
										<td className="muted">{expansion.kind !== 'closed' && expansion.sessionId === r.id ? '▾' : '▸'}</td>
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
									{expansion.kind === 'open' && expansion.sessionId === r.id && (
										<tr className="expand-row">
											<td colSpan={6}>
												<p className="faint" style={{ marginBottom: 10 }}>Click a status to correct it — the absence ledger stays in sync.</p>
												<div className="cards">
													{expansion.details.session.picks.map((sid) => {
														const mark = expansion.details.session.marks[sid]
														const isAbsent = mark?.status === 'absent'
														const isCarryover = expansion.details.session.carryoverIds?.includes(sid)
														return (
															<div key={sid} className={`student-card ${isCarryover ? 'carryover' : ''}`}>
																<div className="name">
																	<span>{expansion.details.studentNames[sid] ?? sid}</span>
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
																		<button className="btn btn-sm" disabled={expansion.correcting} onClick={() => handleCorrect(sid, 'present')}>
																				Mark present
																			</button>
																			<button
																				className="btn btn-sm btn-ghost"
																			disabled={expansion.correcting}
																				onClick={() => handleCorrect(sid, 'absent', mark?.reason === 'excused' ? 'unexcused' : 'excused')}
																			>
																				{mark?.reason === 'excused' ? 'Set unexcused' : 'Set excused'}
																			</button>
																		</>
																	) : (
																	<button className="btn btn-sm" disabled={expansion.correcting} onClick={() => handleCorrect(sid, 'absent', 'unexcused')}>
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
