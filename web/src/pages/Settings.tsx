import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { db } from '../db'
import { createAndInitSpreadsheetForCheckPoint, getAccessToken, normalizeAndValidateSpreadsheetId, ensureCheckpointSheets } from '../google'

export default function Settings() {
	const { selectedClassId } = useStore()
	const [defaultN, setDefaultN] = useState(5)
	const [neverSeenWeight, setNeverSeenWeight] = useState(2)
	const [cooldownWeight, setCooldownWeight] = useState(0.5)
	const [csvPicked, setCsvPicked] = useState(false)
	const [spreadsheetId, setSpreadsheetId] = useState<string | undefined>(undefined)
	const [isAuthReady, setIsAuthReady] = useState(false)
	const [busy, setBusy] = useState(false)

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
				setSpreadsheetId((st as any).spreadsheetId)
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
							await db.settings.put({ classId: selectedClassId, defaultN, neverSeenWeight, cooldownWeight, spreadsheetId })
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
				<hr style={{ margin: '16px 0' }} />
				<div>
					<h3 style={{ margin: '4px 0' }}>Google Sheets</h3>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
						<button
							disabled={busy}
							onClick={async () => {
								try {
									setBusy(true)
									await getAccessToken()
									setIsAuthReady(true)
									alert('Google connected — token acquired')
								} catch (e) {
									alert((e as Error).message)
								} finally {
									setBusy(false)
								}
							}}
						>
							{isAuthReady ? 'Google Connected' : 'Connect Google'}
						</button>

						<button
							disabled={busy}
							onClick={async () => {
								if (!selectedClassId) return
								try {
									setBusy(true)
									// Ensure we have Drive scope before creating a spreadsheet
									await getAccessToken([
										'https://www.googleapis.com/auth/spreadsheets',
										'https://www.googleapis.com/auth/drive.file',
									])
									console.log('[Settings]', 'Creating spreadsheet for class', selectedClassId)
									const cls = await db.classes.get(selectedClassId)
									const title = `CheckPoint — ${cls?.name || selectedClassId}`
									const id = await createAndInitSpreadsheetForCheckPoint(title)
									setSpreadsheetId(id)
									const st = (await db.settings.get(selectedClassId)) || {
										classId: selectedClassId,
										defaultN,
										neverSeenWeight,
										cooldownWeight,
									}
									await db.settings.put({ ...st, spreadsheetId: id })
									console.log('[Settings]', 'Spreadsheet created and ID saved', id)
									alert('Created spreadsheet and initialized headers.')
								} catch (e) {
									console.error('[Settings]', 'Create spreadsheet failed', e)
									alert((e as Error).message)
								} finally {
									setBusy(false)
								}
							}}
						>
							Create Spreadsheet
						</button>

						<label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
							<span>Spreadsheet ID</span>
							<input
								style={{ width: 340 }}
								type="text"
								placeholder="Paste an existing spreadsheetId"
								value={spreadsheetId || ''}
								onChange={(e) => setSpreadsheetId(e.target.value || undefined)}
							/>
						</label>
						<button
							disabled={busy}
							onClick={async () => {
								if (!selectedClassId || !spreadsheetId) return
								const st = (await db.settings.get(selectedClassId)) || {
									classId: selectedClassId,
									defaultN,
									neverSeenWeight,
									cooldownWeight,
								}
								try {
									console.log('[Settings]', 'Saving provided Spreadsheet ID', spreadsheetId)
									const id = normalizeAndValidateSpreadsheetId(spreadsheetId)
									await ensureCheckpointSheets(id)
									await db.settings.put({ ...st, spreadsheetId: id })
									console.log('[Settings]', 'Spreadsheet ID saved', id)
									alert('Saved Spreadsheet ID.')
								} catch (e) {
									console.error('[Settings]', 'Save ID failed', e)
									alert((e as Error).message)
									return
								}
							}}
						>
							Save ID
						</button>
					</div>
					{spreadsheetId ? (
						<p style={{ marginTop: 8 }}>Using Spreadsheet: <code>{spreadsheetId}</code></p>
					) : null}
				</div>
				</>
			)}
		</div>
	)
}


