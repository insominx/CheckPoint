import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'

export default function Home() {
	const { loadClasses, createClass, selectClass, selectedClassId, currentN } = useStore()
	const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
	const [newClassName, setNewClassName] = useState('')

	useEffect(() => {
		loadClasses().then(setClasses)
	}, [loadClasses])

	return (
		<div className="page">
			<h1>CheckPoint</h1>
			<div>
				<label>
					Class:
					<select
						value={selectedClassId ?? ''}
						onChange={async (e) => {
							await selectClass(e.target.value)
						}}
					>
						<option value="">Select class</option>
						{classes.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
							</option>
						))}
					</select>
				</label>
				<div style={{ display: 'inline-block', marginLeft: 8 }}>
					<input
						placeholder="New class name"
						value={newClassName}
						onChange={(e) => setNewClassName(e.target.value)}
					/>
					<button
						onClick={async () => {
							if (!newClassName.trim()) return
							const cls = await createClass(newClassName.trim())
							setClasses(await loadClasses())
							await selectClass(cls.id)
							setNewClassName('')
						}}
					>
						Add Class
					</button>
				</div>
			</div>
			<div>
				<p>Default N: {currentN}</p>
				<div style={{ display: 'flex', gap: 8 }}>
					<Link to="/session">
						<button disabled={!selectedClassId}>Pick Students</button>
					</Link>
					<Link to="/roster">
						<button disabled={!selectedClassId}>Manage Roster</button>
					</Link>
				</div>
			</div>
		</div>
	)
}


