import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useStore } from '../store'
import { useToast } from '../components/Toast'
import * as repo from '../data/repository'
import { parseRosterCsv, toStudentEntities } from '../utils/csv'
import { pickRosterCsv } from './rosterDrop'

interface RosterEntry {
	id: string
	displayName: string
	firstName?: string
	lastName?: string
	loginId?: string
	absenceCount: number
}

type SortKey = 'name' | 'last' | 'absences'

export default function Roster() {
	const { ready, selectedClass } = useStore()
	const classId = selectedClass?.id
	const toast = useToast()
	const [students, setStudents] = useState<RosterEntry[]>([])
	const [sortKey, setSortKey] = useState<SortKey>('name')
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
	const [importing, setImporting] = useState(false)
	const [dragOver, setDragOver] = useState(false)
	const dragDepth = useRef(0)

	const load = useCallback(async () => {
		if (!classId) return
		setStudents(await repo.getStudentsWithAbsenceCounts(classId))
	}, [classId])

	useEffect(() => {
		load()
	}, [load])

	useEffect(() => {
		dragDepth.current = 0
		setDragOver(false)
	}, [classId])

	if (!ready) return null

	if (!classId) {
		return (
			<div className="page">
				<div className="empty"><h3>No class selected</h3><p>Pick a class in the sidebar first.</p></div>
			</div>
		)
	}

	const toggleSort = (key: SortKey) => {
		if (key === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
		else {
			setSortKey(key)
			setSortDir(key === 'absences' ? 'desc' : 'asc')
		}
	}

	const sorted = [...students].sort((a, b) => {
		let cmp: number
		if (sortKey === 'absences') cmp = a.absenceCount - b.absenceCount
		else if (sortKey === 'last') cmp = (a.lastName || a.displayName).localeCompare(b.lastName || b.displayName)
		else cmp = a.displayName.localeCompare(b.displayName)
		return sortDir === 'asc' ? cmp : -cmp
	})

	const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

	const handleImport = async (file: File) => {
		setImporting(true)
		try {
			const rows = await parseRosterCsv(file)
			const entities = toStudentEntities(classId, rows, uuidv4)
			if (!entities.length) {
				toast.error('No students found in that CSV. Expected headers like studentId, firstName, lastName, displayName.')
				return
			}
			const ids = new Set<string>()
			for (const s of entities) {
				if (ids.has(s.id)) {
					toast.error(`Import blocked: duplicate studentId "${s.id}" in the CSV.`)
					return
				}
				ids.add(s.id)
			}
			const count = await repo.importRosterStudents(classId, entities)
			toast.success(`Imported ${count} student${count === 1 ? '' : 's'}.`)
			await load()
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e))
		} finally {
			setImporting(false)
		}
	}

	const clearDrag = () => {
		dragDepth.current = 0
		setDragOver(false)
	}

	const handleDragEnter = (e: DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		dragDepth.current += 1
		setDragOver(true)
	}

	const handleDragOver = (e: DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (e.dataTransfer) e.dataTransfer.dropEffect = importing ? 'none' : 'copy'
	}

	const handleDragLeave = (e: DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		dragDepth.current = Math.max(0, dragDepth.current - 1)
		if (dragDepth.current === 0) setDragOver(false)
	}

	const handleDrop = async (e: DragEvent) => {
		e.preventDefault()
		e.stopPropagation()
		clearDrag()
		if (importing) return
		const picked = pickRosterCsv(e.dataTransfer.files)
		if ('error' in picked) {
			toast.error(picked.error)
			return
		}
		await handleImport(picked.file)
	}

	const dropHandlers = {
		onDragEnter: handleDragEnter,
		onDragOver: handleDragOver,
		onDragLeave: handleDragLeave,
		onDrop: handleDrop,
	}

	return (
		<div
			className="page"
			onDragOver={(e) => e.preventDefault()}
			onDrop={(e) => e.preventDefault()}
		>
			<div className="page-header">
				<div>
					<h1>Roster</h1>
					<p className="sub">
						{selectedClass?.name} — {students.length} student{students.length === 1 ? '' : 's'}
					</p>
				</div>
				<div className="page-actions">
					<label className={`btn btn-primary file-label ${importing ? 'disabled' : ''}`}>
						{importing ? 'Importing…' : 'Import roster CSV'}
						<input
							type="file"
							accept=".csv"
							disabled={importing}
							onChange={async (e) => {
								const file = e.target.files?.[0]
								e.target.value = ''
								if (file) await handleImport(file)
							}}
						/>
					</label>
				</div>
			</div>

			{students.length === 0 ? (
				<div
					className={`empty roster-drop ${dragOver ? 'is-dragover' : ''}`}
					aria-label="Drop roster CSV to import"
					{...dropHandlers}
				>
					<h3>{dragOver ? 'Drop to import' : 'No students yet'}</h3>
					<p>
						Drop a CSV here, or use Import roster CSV. Recognized columns: <code>studentId</code>,{' '}
						<code>firstName</code>, <code>lastName</code>, <code>displayName</code>, <code>loginId</code>,{' '}
						<code>sisId</code>. Missing IDs are generated automatically; re-importing the same IDs updates existing
						students.
					</p>
				</div>
			) : (
				<div
					className={`table-wrap roster-drop ${dragOver ? 'is-dragover' : ''}`}
					{...dropHandlers}
				>
					<table className="table">
						<thead>
							<tr>
								<th className="sortable" onClick={() => toggleSort('name')}>Name{arrow('name')}</th>
								<th className="sortable" onClick={() => toggleSort('last')}>Last name{arrow('last')}</th>
								<th>Login</th>
								<th className="sortable num" onClick={() => toggleSort('absences')}>Absences{arrow('absences')}</th>
							</tr>
						</thead>
						<tbody>
							{sorted.map((s) => (
								<tr key={s.id}>
									<td style={{ fontWeight: 550 }}>{s.displayName}</td>
									<td className="muted">{s.lastName ?? '—'}</td>
									<td className="muted">{s.loginId ?? '—'}</td>
									<td className="num">
										{s.absenceCount > 0 ? (
											<span className="badge badge-danger">{s.absenceCount}</span>
										) : (
											<span className="badge badge-muted">0</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{students.length > 0 && (
				<p className="faint">To correct a recorded absence, open the session on the History page.</p>
			)}
		</div>
	)
}
