import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'

export default function Home() {
	const { loadClasses, createClass, selectClass, selectedClassId } = useStore()
	const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
	const [newClassName, setNewClassName] = useState('')

	useEffect(() => {
		loadClasses().then(setClasses)
	}, [loadClasses])

	return (
		<div className="page">
			<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
				<img src="/logo.png" alt="CheckPoint" width={56} height={56} style={{ borderRadius: 12 }} />
				<h1 style={{ margin: 0 }}>CheckPoint</h1>
			</div>
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
				<Link to="/session">
					<button disabled={!selectedClassId}>Pick Students</button>
				</Link>
			</div>
		</div>
	)
}


