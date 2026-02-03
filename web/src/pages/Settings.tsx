import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { db } from '../db' // Needed for CSV file handle operations
import { createAndInitSpreadsheetForCheckPoint, getAccessToken, normalizeAndValidateSpreadsheetId, ensureCheckpointSheets, probeCheckpointSpreadsheetIdentity } from '../google'

export default function Settings() {
	const { selectedClassId, getClassSettings, updateClassSettings, exportCurrentClassToSheets, importCurrentClassFromSheets, repairCurrentClassSpreadsheetIdentity, opStatus } = useStore()
	const [defaultN, setDefaultN] = useState(5)
	const [neverSeenWeight, setNeverSeenWeight] = useState(2)
	const [cooldownWeight, setCooldownWeight] = useState(0.5)
	const [csvPicked, setCsvPicked] = useState(false)
	const [spreadsheetId, setSpreadsheetId] = useState<string | undefined>(undefined)
	const [activeClassName, setActiveClassName] = useState<string | undefined>(undefined)
	const [isAuthReady, setIsAuthReady] = useState(false)
	const [busy, setBusy] = useState(false)
	const exportBusy = opStatus.exportSheets.inProgress
	const importBusy = opStatus.importSheets.inProgress
	const repairBusy = opStatus.repairSheets.inProgress
	const syncBusy = exportBusy || importBusy || repairBusy

	useEffect(() => {
		; (async () => {
			if (!selectedClassId) return
			const result = await getClassSettings()
			if (result) {
				setActiveClassName(result.cls.name)
				setDefaultN(result.cls.defaultN)
				setNeverSeenWeight(result.settings.neverSeenWeight)
				setCooldownWeight(result.settings.cooldownWeight)
				setCsvPicked(!!result.settings.csvFileHandle)
				setSpreadsheetId(result.settings.spreadsheetId)
			}
		})()
	}, [selectedClassId, getClassSettings])

	return (
		<div style={{ padding: 16 }}>
			<h2>Settings</h2>
			{!selectedClassId ? (
				<p>Select a class first.</p>
			) : (
				<>
					<p style={{ marginTop: 4, opacity: 0.85 }}>
						Active class: <strong>{activeClassName || 'Unknown'}</strong> (<code>{selectedClassId}</code>)
					</p>
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
								try {
									await updateClassSettings({ defaultN, neverSeenWeight, cooldownWeight, spreadsheetId })
								} catch (e) {
									alert((e as Error).message)
								}
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
								disabled={busy || syncBusy}
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
								disabled={busy || syncBusy}
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
										await updateClassSettings({ defaultN, neverSeenWeight, cooldownWeight, spreadsheetId: id })
										await repairCurrentClassSpreadsheetIdentity({ silent: true })
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
								disabled={busy || syncBusy}
								onClick={async () => {
									if (!selectedClassId || !spreadsheetId) return
									try {
										console.log('[Settings]', 'Saving provided Spreadsheet ID', spreadsheetId)
										const id = normalizeAndValidateSpreadsheetId(spreadsheetId)
										await ensureCheckpointSheets(id)
										await updateClassSettings({ defaultN, neverSeenWeight, cooldownWeight, spreadsheetId: id })
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
							<button
								disabled={busy || syncBusy || !selectedClassId || !spreadsheetId}
								onClick={async () => {
									if (!selectedClassId || !spreadsheetId) return
									try {
										setBusy(true)
										await getAccessToken()
										const id = normalizeAndValidateSpreadsheetId(spreadsheetId)
										const identity = await probeCheckpointSpreadsheetIdentity(id)
										if (identity.multipleClassIds?.length) {
											throw new Error(`Spreadsheet contains multiple class IDs: ${identity.multipleClassIds.join(', ')}`)
										}
										if (identity.classId && identity.classId !== selectedClassId) {
											const sheetLabel = identity.className ? `${identity.className} (${identity.classId})` : identity.classId
											throw new Error(`Spreadsheet belongs to ${sheetLabel}, not this class.`)
										}
										if (identity.isLegacy) {
											const proceed = confirm('This spreadsheet does not declare class identity yet.\n\nOpen anyway?')
											if (!proceed) return
										}
										const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`
										window.open(url, '_blank', 'noopener,noreferrer')
									} catch (e) {
										alert((e as Error).message)
									} finally {
										setBusy(false)
									}
								}}
							>
								Open Spreadsheet
							</button>
							<button
								disabled={busy || syncBusy || !selectedClassId || !spreadsheetId}
								onClick={async () => {
									try {
										setBusy(true)
										await getAccessToken([
											'https://www.googleapis.com/auth/spreadsheets',
											'https://www.googleapis.com/auth/drive.file',
										])
										await repairCurrentClassSpreadsheetIdentity()
									} catch (e) {
										alert((e as Error).message)
									} finally {
										setBusy(false)
									}
								}}
							>
								Repair Sheet Metadata
							</button>
						</div>
						{spreadsheetId ? (
							<p style={{ marginTop: 8 }}>Using Spreadsheet: <code>{spreadsheetId}</code></p>
						) : null}
						<div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
							<button
								disabled={busy || exportBusy || !selectedClassId}
								onClick={async () => {
									try {
										setBusy(true)
										await getAccessToken([
											'https://www.googleapis.com/auth/spreadsheets',
											'https://www.googleapis.com/auth/drive.file',
										])
										console.log('[Settings]', 'Triggering exportCurrentClassToSheets')
										await exportCurrentClassToSheets()
									} catch (e) {
										console.error('[Settings]', 'Sync failed', e)
										alert((e as Error).message)
									} finally {
										setBusy(false)
									}
								}}
							>
								Sync to Google Sheets
							</button>
							<button
								disabled={busy || importBusy || !selectedClassId}
								onClick={async () => {
									try {
										setBusy(true)
										await getAccessToken([
											'https://www.googleapis.com/auth/spreadsheets',
											'https://www.googleapis.com/auth/drive.file',
										])
										console.log('[Settings]', 'Triggering importCurrentClassFromSheets')
										await importCurrentClassFromSheets()
									} catch (e) {
										console.error('[Settings]', 'Import failed', e)
										alert((e as Error).message)
									} finally {
										setBusy(false)
									}
								}}
							>
								Import from Google Sheets (overwrite)
							</button>
							<button
								style={{ opacity: 0.8 }}
								disabled={busy || exportBusy || !selectedClassId}
								onClick={async () => {
									try {
										setBusy(true)
										await getAccessToken([
											'https://www.googleapis.com/auth/spreadsheets',
											'https://www.googleapis.com/auth/drive.file',
										])
										console.log('[Settings]', 'Triggering exportCurrentClassToSheets with recreate')
										await exportCurrentClassToSheets({ recreate: true })
									} catch (e) {
										console.error('[Settings]', 'Full resync failed', e)
										alert((e as Error).message)
									} finally {
										setBusy(false)
									}
								}}
							>
								Full Recreate & Sync
							</button>
						</div>
					</div>
				</>
			)}
		</div>
	)
}


