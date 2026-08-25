import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store'
import { useConfirm } from '../components/Dialog'
import { useToast } from '../components/Toast'
import * as repo from '../data/repository'
import { spreadsheetUrl, normalizeAndValidateSpreadsheetId } from '../services/sheetsClient'

export default function Settings() {
	const { ready, selectedClass, inFlight, updateSettings, exportToSheets, previewImport, applyImport } = useStore()
	const classId = selectedClass?.id
	const confirm = useConfirm()
	const toast = useToast()

	const [defaultN, setDefaultN] = useState(5)
	const [neverSeenWeight, setNeverSeenWeight] = useState(2)
	const [cooldownWeight, setCooldownWeight] = useState(0.5)
	const [spreadsheetIdInput, setSpreadsheetIdInput] = useState('')
	const [linkedSpreadsheetId, setLinkedSpreadsheetId] = useState<string | undefined>()
	const [lastExportedAt, setLastExportedAt] = useState<string | undefined>()

	const load = useCallback(async () => {
		if (!classId) return
		const settings = await repo.getEffectiveSettings(classId)
		setDefaultN(settings.defaultN)
		setNeverSeenWeight(settings.neverSeenWeight)
		setCooldownWeight(settings.cooldownWeight)
		setLinkedSpreadsheetId(settings.spreadsheetId)
		setSpreadsheetIdInput(settings.spreadsheetId ?? '')
		setLastExportedAt(settings.lastExportedAt)
	}, [classId])

	useEffect(() => {
		load()
	}, [load])

	if (!ready) return null

	if (!classId) {
		return (
			<div className="page">
				<div className="empty"><h3>No class selected</h3><p>Pick a class in the sidebar first.</p></div>
			</div>
		)
	}

	const handleSavePicking = async () => {
		const result = await updateSettings({ defaultN, neverSeenWeight, cooldownWeight })
		if (result.ok) toast.success('Picking settings saved.')
		else toast.error(result.error)
	}

	const handleLinkSpreadsheet = async () => {
		try {
			const id = normalizeAndValidateSpreadsheetId(spreadsheetIdInput)
			const result = await updateSettings({ spreadsheetId: id })
			if (!result.ok) {
				toast.error(result.error)
				return
			}
			setLinkedSpreadsheetId(id)
			setSpreadsheetIdInput(id)
			toast.success('Spreadsheet linked.')
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e))
		}
	}

	const handleExport = async () => {
		if (linkedSpreadsheetId) {
			const proceed = await confirm({
				title: 'Export to Google Sheets?',
				message: 'The linked spreadsheet will be overwritten with this class’s current data. Anything typed into the sheet by hand is replaced.',
				confirmLabel: 'Export',
			})
			if (!proceed) return
		}
		const result = await exportToSheets()
		if (result.ok) {
			const { counts, spreadsheetId } = result.value
			setLinkedSpreadsheetId(spreadsheetId)
			setSpreadsheetIdInput(spreadsheetId)
			setLastExportedAt(result.value.exportedAt)
			toast.success(`Exported ${counts.students} students, ${counts.sessions} sessions, ${counts.ledger} absences.`)
		} else {
			toast.error(`Export failed: ${result.error}`)
		}
	}

	const handleImport = async () => {
		const preview = await previewImport()
		if (!preview.ok) {
			toast.error(`Import failed: ${preview.error}`)
			return
		}
		const { reports } = preview.value.parsed
		const proceed = await confirm({
			title: 'Overwrite local data with the sheet?',
			message:
				`The sheet contains ${reports.students.total} students, ${reports.sessions.total} sessions, ` +
				`${reports.marks.total} marks, and ${reports.ledger.total} absence records.\n\n` +
				`All current local data for "${selectedClass?.name}" will be replaced. This cannot be undone.`,
			confirmLabel: 'Overwrite local data',
			danger: true,
		})
		if (!proceed) return
		const result = await applyImport(preview.value)
		if (result.ok) {
			toast.success('Import complete — local data replaced from the sheet.')
			await load()
		} else {
			toast.error(`Import failed: ${result.error}`)
		}
	}

	return (
		<div className="page">
			<div className="page-header">
				<div>
					<h1>Settings</h1>
					<p className="sub">{selectedClass?.name}</p>
				</div>
			</div>

			<section className="panel">
				<header>
					<div>
						<h2>Picking</h2>
						<p className="desc">How students are drawn for each attendance check.</p>
					</div>
					<button className="btn btn-primary" onClick={handleSavePicking} disabled={inFlight !== null}>Save</button>
				</header>
				<div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
					<div className="field">
						<label htmlFor="set-n">Students per check (N)</label>
						<input id="set-n" className="input" type="number" min={1} style={{ width: 110 }}
							value={defaultN} onChange={(e) => setDefaultN(Number(e.target.value))} />
						<span className="hint">Random picks per session. Students waiting for a recheck are always added on top.</span>
					</div>
					<div className="field">
						<label htmlFor="set-never">Never-seen boost</label>
						<input id="set-never" className="input" type="number" step={0.1} min={0} style={{ width: 110 }}
							value={neverSeenWeight} onChange={(e) => setNeverSeenWeight(Number(e.target.value))} />
						<span className="hint">Weight for students who have never been checked (1 = no boost).</span>
					</div>
					<div className="field">
						<label htmlFor="set-cooldown">Cooldown</label>
						<input id="set-cooldown" className="input" type="number" step={0.1} min={0} style={{ width: 110 }}
							value={cooldownWeight} onChange={(e) => setCooldownWeight(Number(e.target.value))} />
						<span className="hint">Weight multiplier for students picked in both of the last two sessions.</span>
					</div>
				</div>
			</section>

			<section className="panel">
				<header>
					<div>
						<h2>Google Sheets backup</h2>
						<p className="desc">
							Your data lives in this app. <strong>Export</strong> overwrites the linked sheet with local data;{' '}
							<strong>Import</strong> overwrites local data with the sheet. Nothing syncs automatically.
						</p>
					</div>
				</header>

				<div className="field">
					<label htmlFor="set-sheet">Linked spreadsheet</label>
					<div className="row">
						<input
							id="set-sheet"
							className="input"
							style={{ width: 380 }}
							placeholder="Paste a spreadsheet URL or ID (optional)"
							value={spreadsheetIdInput}
							onChange={(e) => setSpreadsheetIdInput(e.target.value)}
						/>
						<button className="btn" onClick={handleLinkSpreadsheet} disabled={inFlight !== null || !spreadsheetIdInput.trim() || spreadsheetIdInput.trim() === linkedSpreadsheetId}>
							Link
						</button>
						{linkedSpreadsheetId && (
							<a className="btn btn-ghost" href={spreadsheetUrl(linkedSpreadsheetId)} target="_blank" rel="noopener noreferrer">
								Open sheet ↗
							</a>
						)}
					</div>
					<span className="hint">
						{linkedSpreadsheetId
							? lastExportedAt
								? `Last exported ${new Date(lastExportedAt).toLocaleString()}.`
								: 'Linked, but never exported yet.'
							: 'No sheet linked. Exporting creates a new spreadsheet automatically.'}
					</span>
				</div>

				<div className="row">
					<button className="btn btn-primary" onClick={handleExport} disabled={inFlight !== null}>
						{inFlight === 'export' ? 'Exporting…' : 'Export to sheet'}
					</button>
					<button className="btn" onClick={handleImport} disabled={inFlight !== null || !linkedSpreadsheetId}>
						{inFlight === 'import' ? 'Importing…' : 'Import from sheet (overwrite local)'}
					</button>
				</div>
				<p className="faint">
					Requires a Google sign-in on first use. The app only gets access to spreadsheets it creates or that you link here.
				</p>
			</section>
		</div>
	)
}
