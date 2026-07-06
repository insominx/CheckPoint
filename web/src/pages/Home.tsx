import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { useConfirm } from '../components/Dialog'
import { useToast } from '../components/Toast'
import * as repo from '../data/repository'
import { computeCarryovers } from '../domain/attendance'

interface ClassStats {
	students: number
	sessions: number
	carryovers: number
	absences: number
	lastSessionDate?: string
}

export default function Home() {
	const { classes, selectedClassId, selectedClass, selectClass, createClass, deleteClass, currentSession } = useStore()
	const navigate = useNavigate()
	const confirm = useConfirm()
	const toast = useToast()
	const [newClassName, setNewClassName] = useState('')
	const [stats, setStats] = useState<ClassStats | null>(null)

	const loadStats = useCallback(async () => {
		if (!selectedClassId) {
			setStats(null)
			return
		}
		const { students, sessions, ledger } = await repo.getClassDataset(selectedClassId)
		const sorted = [...sessions].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
		const carryovers = computeCarryovers(students.map((s) => s.id), ledger, sorted)
		setStats({
			students: students.length,
			sessions: sessions.length,
			carryovers: carryovers.length,
			absences: ledger.length,
			lastSessionDate: sorted[0]?.date,
		})
	}, [selectedClassId])

	useEffect(() => {
		loadStats()
	}, [loadStats])

	const handleCreate = async () => {
		const name = newClassName.trim()
		if (!name) return
		const result = await createClass(name)
		if (!result.ok) {
			toast.error(result.error)
			return
		}
		setNewClassName('')
		await selectClass(result.value.id)
		toast.success(`Class "${name}" created. Import a roster to get started.`)
		navigate('/roster')
	}

	const handleDelete = async (classId: string, name: string) => {
		const proceed = await confirm({
			title: `Delete "${name}"?`,
			message:
				'This permanently removes the class with all its students, sessions, and absence history from this browser.\n\nA linked Google Sheet (if any) is not touched.',
			confirmLabel: 'Delete class',
			danger: true,
		})
		if (!proceed) return
		const result = await deleteClass(classId)
		if (result.ok) toast.success(`Deleted "${name}".`)
		else toast.error(result.error)
	}

	return (
		<div className="page">
			<div className="page-header">
				<div>
					<h1>Overview</h1>
					<p className="sub">Spot-check attendance in seconds: pick a few students, mark them, save.</p>
				</div>
			</div>

			{selectedClassId && selectedClass && (
				<section className="panel">
					<header>
						<div>
							<h2>{selectedClass.name}</h2>
							<p className="desc">
								{stats?.lastSessionDate
									? `Last check: ${new Date(stats.lastSessionDate).toLocaleString()}`
									: 'No sessions yet.'}
							</p>
						</div>
						<button className="btn btn-primary btn-lg" onClick={() => navigate('/session')} disabled={!stats?.students}>
							{currentSession ? 'Resume session' : 'Start attendance check'}
						</button>
					</header>
					{stats && stats.students === 0 ? (
						<div className="empty">
							<h3>No students yet</h3>
							<p>Import a roster CSV to start running checks for this class.</p>
							<button className="btn" onClick={() => navigate('/roster')}>Go to Roster</button>
						</div>
					) : (
						stats && (
							<div className="stat-row">
								<div className="stat"><span className="value">{stats.students}</span><span className="label">Students</span></div>
								<div className="stat"><span className="value">{stats.sessions}</span><span className="label">Sessions</span></div>
								<div className={`stat ${stats.carryovers > 0 ? 'warn' : ''}`}>
									<span className="value">{stats.carryovers}</span>
									<span className="label">Waiting for recheck</span>
								</div>
								<div className="stat"><span className="value">{stats.absences}</span><span className="label">Absences recorded</span></div>
							</div>
						)
					)}
				</section>
			)}

			<section className="panel">
				<header>
					<div>
						<h2>Classes</h2>
						<p className="desc">Each class keeps its own roster, history, and settings.</p>
					</div>
				</header>

				{classes.length === 0 ? (
					<div className="empty">
						<h3>Welcome to CheckPoint</h3>
						<p>Create your first class below. Then import a roster CSV and you're ready to run your first check.</p>
					</div>
				) : (
					<div className="table-wrap">
						<table className="table">
							<tbody>
								{classes.map((c) => (
									<tr key={c.id}>
										<td style={{ fontWeight: 550 }}>
											{c.name}{' '}
											{c.id === selectedClassId && <span className="badge badge-success">active</span>}
										</td>
										<td style={{ textAlign: 'right' }}>
											<div className="row" style={{ justifyContent: 'flex-end' }}>
												{c.id !== selectedClassId && (
													<button className="btn btn-sm" onClick={() => selectClass(c.id)}>Switch to</button>
												)}
												<button className="btn btn-sm btn-danger" onClick={() => handleDelete(c.id, c.name)}>
													Delete
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}

				<div className="row">
					<input
						className="input"
						style={{ width: 280 }}
						placeholder="New class name (e.g. CST325 Graphics)"
						value={newClassName}
						onChange={(e) => setNewClassName(e.target.value)}
						onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
					/>
					<button className="btn" onClick={handleCreate} disabled={!newClassName.trim()}>
						Create class
					</button>
				</div>
			</section>
		</div>
	)
}
