import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { useConfirm } from '../components/Dialog'
import { useToast } from '../components/Toast'
import * as repo from '../data/repository'
import type { AbsenceReason } from '../types'
import { drawFailureMessage, shouldAutoDraw, shouldCommitStudentInfo } from './sessionDraw'

interface StudentInfo {
	displayName: string
	lastAbsenceDate?: string
}

export default function Session() {
	const navigate = useNavigate()
	const confirm = useConfirm()
	const toast = useToast()
	const {
		ready, selectedClass, currentSession, currentN, inFlight,
		pickStudents, redrawRandom, markStudent, saveSession, discardDraft,
	} = useStore()
	const classId = selectedClass?.id
	const [studentInfo, setStudentInfo] = useState<Record<string, StudentInfo> | null>(null)
	const [reasonById, setReasonById] = useState<Record<string, AbsenceReason>>({})
	const [drawFailure, setDrawFailure] = useState<string | null>(null)
	const lastAttemptedClass = useRef<string | undefined>(undefined)

	useEffect(() => {
		if (ready && !classId) navigate('/')
	}, [ready, classId, navigate])

	const attemptDraw = useCallback(async (targetClassId: string) => {
		lastAttemptedClass.current = targetClassId
		setDrawFailure(null)
		const result = await pickStudents()
		if (useStore.getState().selectedClass?.id !== targetClassId) return
		setDrawFailure(drawFailureMessage(result))
	}, [pickStudents])

	// Draw once per selected class. A restored draft counts as the class's completed draw.
	useEffect(() => {
		if (!ready || !classId) return
		if (currentSession?.classId === classId) {
			lastAttemptedClass.current = classId
			setDrawFailure(null)
			return
		}
		if (!shouldAutoDraw({
			ready, classId, currentSessionClassId: currentSession?.classId,
			inFlight, lastAttemptedClass: lastAttemptedClass.current,
		})) return
		void attemptDraw(classId)
	}, [ready, currentSession, classId, inFlight, attemptDraw])

	useEffect(() => {
		let isMounted = true
		setStudentInfo(null)
		if (!classId) return () => { isMounted = false }
		void repo.getStudentsWithAbsenceCounts(classId).then((students) => {
			if (!shouldCommitStudentInfo({ requestedClassId: classId, currentClassId: useStore.getState().selectedClass?.id, isMounted })) return
			const info: Record<string, StudentInfo> = {}
			for (const s of students) info[s.id] = { displayName: s.displayName, lastAbsenceDate: s.lastAbsenceDate }
			setStudentInfo(info)
		})
		return () => { isMounted = false }
	}, [classId])

	if (!ready || !classId) return null

	if (!currentSession) {
		return (
			<div className="page">
				<div className="page-header">
					<div>
						<h1>Session</h1>
						<p className="sub">{drawFailure ?? 'Drawing students…'}</p>
					</div>
				</div>
				{drawFailure && (
					<button className="btn btn-primary" onClick={() => void attemptDraw(classId)} disabled={inFlight !== null}>
						Retry
					</button>
				)}
			</div>
		)
	}

	const picks = currentSession.picks
	const carryoverSet = new Set(currentSession.carryoverIds ?? [])
	const markedCount = picks.filter((sid) => !!currentSession.marks[sid]).length
	const allMarked = picks.length > 0 && markedCount === picks.length
	const absentCount = picks.filter((sid) => currentSession.marks[sid]?.status === 'absent').length
	const actionBusy = inFlight !== null
	const isResumedDraft = Date.now() - Date.parse(currentSession.date) > 2 * 60 * 60 * 1000
	const byName = (a: string, b: string) =>
		(studentInfo?.[a]?.displayName ?? a).localeCompare(studentInfo?.[b]?.displayName ?? b)
	const rechecks = picks.filter((sid) => carryoverSet.has(sid)).sort(byName)
	const randoms = picks.filter((sid) => !carryoverSet.has(sid)).sort(byName)

	const renderCard = (sid: string) => {
		const info = studentInfo?.[sid]
		const mark = currentSession.marks[sid]
		const isPresent = mark?.status === 'present'
		const isAbsent = mark?.status === 'absent'
		const isCarryover = carryoverSet.has(sid)
		return (
			<div
				key={sid}
				className={`student-card ${isCarryover ? 'carryover' : ''} ${isPresent ? 'marked-present' : ''} ${isAbsent ? 'marked-absent' : ''}`}
			>
				<div className="name">
					<span>{info?.displayName ?? sid}</span>
					{isCarryover && <span className="badge badge-warn">recheck</span>}
				</div>
				{isCarryover && info?.lastAbsenceDate && (
					<div className="meta">
						Last absent {new Date(info.lastAbsenceDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
					</div>
				)}
				<div className="mark-buttons">
					<button
						className={`mark-btn present ${isPresent ? 'on' : ''}`}
						onClick={() => markStudent(sid, { status: 'present' })}
					>
						Present
					</button>
					<button
						className={`mark-btn absent ${isAbsent ? 'on' : ''}`}
						onClick={() => markStudent(sid, { status: 'absent', reason: reasonById[sid] ?? 'unexcused' })}
					>
						Absent
					</button>
				</div>
				{isAbsent && (
					<select
						className="select"
						value={reasonById[sid] ?? mark?.reason ?? 'unexcused'}
						onChange={(e) => {
							const reason = e.target.value as AbsenceReason
							setReasonById({ ...reasonById, [sid]: reason })
							markStudent(sid, { status: 'absent', reason })
						}}
					>
						<option value="unexcused">Unexcused</option>
						<option value="excused">Excused</option>
					</select>
				)}
			</div>
		)
	}

	const handleRedraw = async () => {
		const hasMarks = Object.keys(currentSession.marks || {}).length > 0
		if (hasMarks) {
			const proceed = await confirm({
				title: 'Re-draw students?',
				message: 'Re-drawing replaces the random picks and clears the marks you have made so far. Students waiting for a recheck stay in the list.',
				confirmLabel: 'Re-draw',
			})
			if (!proceed) return
		}
		const result = await redrawRandom({ allowResetMarks: hasMarks })
		if (result === 'ok') setReasonById({})
		else if (result === 'blocked') toast.info('A draw is already in progress.')
		else if (result === 'error') toast.error('Re-draw failed. Please try again.')
	}

	const handleDiscard = async () => {
		const proceed = await confirm({
			title: 'Discard this session?',
			message: 'The current picks and marks are thrown away. Nothing is saved to history.',
			confirmLabel: 'Discard',
			danger: true,
		})
		if (!proceed) return
		discardDraft()
		navigate('/')
	}

	const handleSave = async () => {
		const result = await saveSession()
		if (result.ok) {
			toast.success(absentCount > 0 ? `Session saved — ${absentCount} absent.` : 'Session saved — everyone present.')
			navigate('/')
		} else {
			toast.error(`Could not save session: ${result.error}`)
		}
	}

	return (
		<div className="page">
			<div className="page-header">
				<div>
					<h1>Attendance check</h1>
					<p className="sub">
						{picks.length - carryoverSet.size} random pick{picks.length - carryoverSet.size === 1 ? '' : 's'} (N={currentN})
						{carryoverSet.size > 0 && <> + {carryoverSet.size} recheck{carryoverSet.size === 1 ? '' : 's'} carried over</>}
					</p>
				</div>
			</div>

			{isResumedDraft && (
				<div className="banner">
					<span>Resuming an unsaved session from {new Date(currentSession.date).toLocaleString()}.</span>
					<button className="btn btn-sm" onClick={handleDiscard}>Discard</button>
				</div>
			)}

			<div className="session-toolbar">
				<span className="count">{markedCount} of {picks.length} marked</span>
				<div className="progress-track">
					<div
						className={`progress-fill ${allMarked ? 'done' : ''}`}
						style={{ width: picks.length ? `${(markedCount / picks.length) * 100}%` : '0%' }}
					/>
				</div>
				<button className="btn btn-ghost" onClick={handleDiscard} disabled={actionBusy}>Discard</button>
				<button className="btn" onClick={handleRedraw} disabled={actionBusy}>Re-draw</button>
				<button className="btn btn-primary" onClick={handleSave} disabled={!allMarked || actionBusy}>
					{inFlight === 'save' ? 'Saving…' : 'Save session'}
				</button>
			</div>

			{picks.length === 0 ? (
				<div className="empty">
					<h3>Nothing to check</h3>
					<p>This class has no students to draw from. Import a roster first.</p>
					<button className="btn" onClick={() => navigate('/roster')}>Go to Roster</button>
				</div>
			) : !studentInfo ? (
				<p className="pick-section-note">Loading students…</p>
			) : (
				<>
					{rechecks.length > 0 && (
						<section className="pick-section rechecks">
							<h2>
								Absent last time — please confirm you're here
								<span className="pick-section-count">{rechecks.length}</span>
							</h2>
							<div className="cards">{rechecks.map(renderCard)}</div>
						</section>
					)}
					<section className="pick-section">
						<h2>
							Random check
							<span className="pick-section-count">{randoms.length}</span>
						</h2>
						{randoms.length > 0
							? <div className="cards">{randoms.map(renderCard)}</div>
							: <p className="pick-section-note">No random picks this time.</p>}
					</section>
				</>
			)}
		</div>
	)
}
