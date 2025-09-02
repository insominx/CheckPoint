import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { db } from '../db'

export default function Settings() {
	const { selectedClassId } = useStore()
	const [defaultN, setDefaultN] = useState(5)
	const [neverSeenWeight, setNeverSeenWeight] = useState(2)
	const [cooldownWeight, setCooldownWeight] = useState(0.5)
	const [csvPicked, setCsvPicked] = useState(false)

	useEffect(() => {
		;(async () => {
			if (!selectedClassId) return
			const cls = await db.classes.get(selectedClassId)
			if (cls) setDefaultN(cls.defaultN)
			const st = await db.settings.get(selectedClassId)
			if (st) {
				setNeverSeenWeight(st.neverSeenWeight)
				setCooldownWeight(st.cooldownWeight)
				setCsvPicked(!!st.csvFileHandle)
			}
		})()
	}, [selectedClassId])

	return (
		<div style={{ padding: 16 }}>
			<h2>Settings</h2>
			{!selectedClassId ? (
				<p>Select a class first.</p>
			) : (
				<>
				<div>
					<label>
						Default N:{' '}
						<input
							type="number"
							min={1}
							value={defaultN}
							onChange={(e) => setDefaultN(Number(e.target.value))}
						/>
					</label>
					<button
						style={{ marginLeft: 8 }}
						onClick={async () => {
							if (!selectedClassId) return
							const cls = await db.classes.get(selectedClassId)
							if (!cls) return
							await db.classes.put({ ...cls, defaultN })
							await db.settings.put({ classId: selectedClassId, defaultN, neverSeenWeight, cooldownWeight })
						}}
					>
						Save
					</button>
					<button
						style={{ marginLeft: 8 }}
						onClick={async () => {
							if (!selectedClassId) return
							// @ts-expect-error File System Access API in browser
							if (!window.showSaveFilePicker) return
							// @ts-expect-error
							const handle = await window.showSaveFilePicker({
								suggestedName: `absences_${selectedClassId}.csv`,
								types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
							})
							const st = (await db.settings.get(selectedClassId)) || {
								classId: selectedClassId,
								defaultN,
								neverSeenWeight,
								cooldownWeight,
							}
							await db.settings.put({ ...st, csvFileHandle: handle })
							setCsvPicked(true)
						}}
					>
						Choose CSV Output
					</button>
					{csvPicked ? <span style={{ marginLeft: 8 }}>CSV selected</span> : null}
				</div>
				<div style={{ marginTop: 12 }}>
					<label>
						Never-seen weight
						<input type="number" step={0.1} value={neverSeenWeight} onChange={(e) => setNeverSeenWeight(Number(e.target.value))} />
					</label>
					<label style={{ marginLeft: 8 }}>
						Cooldown weight
						<input type="number" step={0.1} value={cooldownWeight} onChange={(e) => setCooldownWeight(Number(e.target.value))} />
					</label>
				</div>
				</>
			)}
		</div>
	)
}


