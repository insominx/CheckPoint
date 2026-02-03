const GIS_SRC = 'https://accounts.google.com/gsi/client'
const LOG_PREFIX = '[Google]'

let gisLoaded: Promise<void> | null = null
let accessToken: string | null = null
let accessTokenExpiresAt: number | null = null
let grantedScopes = new Set<string>()

export const CHECKPOINT_SETTINGS_SCHEMA_VERSION = '2'
export const CHECKPOINT_SETTINGS_HEADERS = [
	'classId',
	'className',
	'defaultN',
	'neverSeenWeight',
	'cooldownWeight',
	'schemaVersion',
	'lastExportedAt',
]

export interface SpreadsheetIdentityProbe {
	isLegacy: boolean
	classId?: string
	className?: string
	schemaVersion?: string
	lastExportedAt?: string
	multipleClassIds?: string[]
}

async function loadGis(): Promise<void> {
	if (gisLoaded) return gisLoaded
	console.log(LOG_PREFIX, 'Loading GIS script...')
	gisLoaded = new Promise((resolve, reject) => {
		// @ts-expect-error google may already exist
		if (window.google?.accounts?.oauth2) {
			console.log(LOG_PREFIX, 'GIS already present on window')
			return resolve()
		}
		const s = document.createElement('script')
		s.src = GIS_SRC
		s.async = true
		s.onload = () => {
			console.log(LOG_PREFIX, 'GIS script loaded')
			resolve()
		}
		s.onerror = () => {
			console.error(LOG_PREFIX, 'Failed to load GIS script')
			reject(new Error('Failed to load Google Identity Services'))
		}
		document.head.appendChild(s)
	})
	return gisLoaded
}

export async function getAccessToken(scopes: string[] = [
	'https://www.googleapis.com/auth/spreadsheets',
]): Promise<string> {
	await loadGis()
	const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
	if (!clientId) throw new Error('Missing VITE_GOOGLE_CLIENT_ID')

	// Return cached token if valid and covers required scopes
	const now = Date.now()
	const needsScopes = scopes.some((s) => !grantedScopes.has(s))
	const tokenValid = !!accessToken && !!accessTokenExpiresAt && now < accessTokenExpiresAt - 30_000
	if (tokenValid && !needsScopes) {
		console.log(LOG_PREFIX, 'Using cached access token')
		return accessToken as string
	}

	console.log(LOG_PREFIX, 'Requesting access token', { scopes, needsScopes, tokenValid })
	return new Promise<string>((resolve, reject) => {
		// @ts-expect-error google on window
		const tokenClient = window.google.accounts.oauth2.initTokenClient({
			client_id: clientId,
			scope: scopes.join(' '),
			prompt: needsScopes ? 'consent' : '',
			callback: (resp: any) => {
				console.log(LOG_PREFIX, 'Token callback', resp)
				if (resp?.access_token) {
					const token = resp.access_token as string
					accessToken = token
					const expires = Number(resp?.expires_in) || 3600
					accessTokenExpiresAt = Date.now() + Math.max(1, expires - 30) * 1000
					const scopeStr = String(resp?.scope || '')
					for (const s of scopeStr.split(/\s+/).filter(Boolean)) grantedScopes.add(s)
					console.log(LOG_PREFIX, 'Access token acquired')
					resolve(token)
				} else {
					const errMsg = resp?.error || 'No access token returned'
					console.error(LOG_PREFIX, 'Token error', errMsg)
					reject(new Error(errMsg))
				}
			},
			error_callback: (err: any) => {
				console.error(LOG_PREFIX, 'Token error callback', err)
				reject(err)
			},
		})
		console.log(LOG_PREFIX, 'Calling requestAccessToken', { prompt: needsScopes ? 'consent' : '' })
		;(tokenClient as any).requestAccessToken({ prompt: needsScopes ? 'consent' : '' })
	})
}

async function fetchJson(url: string, init?: RequestInit) {
	const token = await getAccessToken()
	const bodyPreview = (() => {
		try {
			return init?.body ? JSON.stringify(JSON.parse(init.body as string)).slice(0, 300) : undefined
		} catch {
			return typeof init?.body === 'string' ? (init.body as string).slice(0, 300) : undefined
		}
	})()
	console.log(LOG_PREFIX, 'HTTP', init?.method || 'GET', url, { bodyPreview })
	const res = await fetch(url, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
			...(init?.headers || {}),
		},
	})
	const status = res.status
	if (!res.ok) {
		const text = await res.text().catch(() => '')
		console.error(LOG_PREFIX, 'HTTP error', status, text || res.statusText)
		throw new Error(`HTTP ${status}: ${text || res.statusText}`)
	}
	const json = await res.json()
	console.log(LOG_PREFIX, 'HTTP', status, 'OK')
	return json
}

export async function createSpreadsheetWithTabs(title: string, sheetTitles: string[]): Promise<string> {
	const body = {
		properties: { title },
		sheets: sheetTitles.map((t) => ({ properties: { title: t } })),
	}
	console.log(LOG_PREFIX, 'Creating spreadsheet', { title, sheetTitles })
	const data = await fetchJson('https://sheets.googleapis.com/v4/spreadsheets', {
		method: 'POST',
		body: JSON.stringify(body),
	})
	console.log(LOG_PREFIX, 'Spreadsheet created', { spreadsheetId: data.spreadsheetId })
	return data.spreadsheetId as string
}

async function writeHeaderRow(spreadsheetId: string, sheet: string, headers: string[]) {
	// Use append with OVERWRITE to avoid range mismatch issues on fresh sheets
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheet + '!A1')}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`
	console.log(LOG_PREFIX, 'Writing header row', { sheet, headers })
	await fetchJson(url, {
		method: 'POST',
		body: JSON.stringify({
			range: `${sheet}!A1`,
			majorDimension: 'ROWS',
			values: [headers],
		}),
	})
}

export async function createAndInitSpreadsheetForCheckPoint(title: string): Promise<string> {
	const sheetTitles = ['Classes', 'Students', 'Sessions', 'Marks', 'Ledger', 'Settings']
	const spreadsheetId = await createSpreadsheetWithTabs(title, sheetTitles)

	const headers: Record<string, string[]> = {
		Classes: ['id', 'name', 'defaultN'],
		Students: [
			'id','classId','firstName','lastName','displayName',
			'externalId','loginId','sisId','notes','absenceCount',
		],
		Sessions: ['id','classId','date','createdAt','savedAt','picksCSV','picksNamesCSV','carryoverCSV','carryoverNamesCSV'],
		Marks: ['sessionId','studentId','displayName','status','reason','markedAt'],
		Ledger: ['id','classId','studentId','displayName','date','sessionId','reason','notes'],
		Settings: CHECKPOINT_SETTINGS_HEADERS,
	}

	await Promise.all(
		Object.entries(headers).map(([sheet, cols]) => writeHeaderRow(spreadsheetId, sheet, cols)),
	)

	return spreadsheetId
}

export async function appendRows(
	spreadsheetId: string,
	sheet: string,
	rows: (string | number | boolean | null)[][],
): Promise<any> {
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheet + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
	console.log(LOG_PREFIX, 'Appending rows', { sheet, rowsCount: rows.length, firstRow: rows[0] })
	const res = await fetchJson(url, {
		method: 'POST',
		body: JSON.stringify({
			range: `${sheet}!A1`,
			majorDimension: 'ROWS',
			values: rows,
		}),
	})
	console.log(LOG_PREFIX, 'Append OK', { sheet, updates: (res as any)?.updates })
	return res
}

export async function readValues(spreadsheetId: string, rangeA1: string): Promise<(string | null)[][]> {
	const token = await getAccessToken()
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`
	console.log(LOG_PREFIX, 'Reading values', { rangeA1 })
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
	if (!res.ok) {
		const txt = await res.text().catch(() => '')
		throw new Error(`Read failed ${res.status}: ${txt || res.statusText}`)
	}
	const json = await res.json()
	const rows = (json?.values as any[]) || []
	return rows
}

export async function clearSheetData(spreadsheetId: string, sheet: string): Promise<void> {
	console.log(LOG_PREFIX, 'Clearing sheet data', { sheet })
	const token = await getAccessToken()
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheet + '!A2:Z')}:clear`
	const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
	if (!res.ok) {
		const txt = await res.text().catch(() => '')
		console.warn(LOG_PREFIX, 'Clear sheet data failed', { sheet, status: res.status, body: txt?.slice(0, 200) })
	}
}

export async function ensureSpreadsheet(spreadsheetTitle: string, preferredId?: string): Promise<string> {
	// If preferredId is provided and exists, return it; otherwise create a new one
	if (preferredId && (await spreadsheetExists(preferredId))) {
		console.log(LOG_PREFIX, 'ensureSpreadsheet: using existing preferredId')
		return preferredId
	}
	console.log(LOG_PREFIX, 'ensureSpreadsheet: creating new spreadsheet', { spreadsheetTitle })
	return createAndInitSpreadsheetForCheckPoint(spreadsheetTitle)
}

export async function spreadsheetExists(spreadsheetId: string): Promise<boolean> {
	console.log(LOG_PREFIX, 'Checking spreadsheet existence', { spreadsheetId })
	// First try Drive API to also detect trashed files
	try {
		const driveToken = await getAccessToken([
			'https://www.googleapis.com/auth/spreadsheets',
			'https://www.googleapis.com/auth/drive.file',
		])
		const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?fields=id,trashed,mimeType&supportsAllDrives=true`
		const driveRes = await fetch(driveUrl, { headers: { Authorization: `Bearer ${driveToken}` } })
		const driveStatus = driveRes.status
		let driveBody: any = undefined
		if (driveRes.ok) {
			driveBody = await driveRes.json().catch(() => undefined)
			console.log(LOG_PREFIX, 'Drive exists check', { status: driveStatus, body: driveBody })
			if (driveBody?.trashed === true) return false
			return true
		} else {
			const txt = await driveRes.text().catch(() => '')
			console.warn(LOG_PREFIX, 'Drive exists check not ok', { status: driveStatus, body: txt?.slice(0, 200) })
			if (driveStatus === 404 || driveStatus === 403) return false
		}
	} catch (err) {
		console.warn(LOG_PREFIX, 'Drive exists check failed, falling back to Sheets', err)
	}

	// Fallback to Sheets API basic existence
	try {
		const sheetsToken = await getAccessToken(['https://www.googleapis.com/auth/spreadsheets'])
		const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId`
		const res = await fetch(sheetsUrl, { headers: { Authorization: `Bearer ${sheetsToken}` } })
		const status = res.status
		const ok = res.ok
		let bodyText = ''
		if (!ok) {
			try { bodyText = await res.text() } catch {}
		}
		console.log(LOG_PREFIX, 'Sheets exists check', { status, ok, bodyText: bodyText?.slice(0, 200) })
		if (status === 404 || status === 403) return false
		return ok
	} catch (err) {
		console.error(LOG_PREFIX, 'Sheets exists check failed', err)
		return false
	}
}

export function parseSpreadsheetId(input: string): string {
	const trimmed = (input || '').trim()
	const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)\//)
	if (m && m[1]) return m[1]
	return trimmed
}

export function isLikelySpreadsheetId(id: string): boolean {
	// Google spreadsheet IDs are URL-safe base64-like strings (letters, numbers, '-', '_'), typically > 30 chars
	return /^[a-zA-Z0-9-_]{20,}$/.test(id)
}

export function normalizeAndValidateSpreadsheetId(input: string): string {
	const id = parseSpreadsheetId(input)
	if (!isLikelySpreadsheetId(id)) {
		throw new Error('Invalid Spreadsheet ID. Paste the full sheet URL or the ID from /spreadsheets/d/<ID>/...')
	}
	return id
}

async function getSheetTitles(spreadsheetId: string): Promise<Set<string>> {
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title))`
	console.log(LOG_PREFIX, 'Fetching sheet titles')
	const data = await fetchJson(url, { method: 'GET' })
	const titles = new Set<string>()
	for (const s of (data.sheets as any[]) || []) {
		const t = s?.properties?.title as string | undefined
		if (t) titles.add(t)
	}
	console.log(LOG_PREFIX, 'Sheet titles', Array.from(titles))
	return titles
}

export async function ensureCheckpointSheets(spreadsheetId: string): Promise<void> {
	const required: Record<string, string[]> = {
		Classes: ['id', 'name', 'defaultN'],
		Students: [
			'id','classId','firstName','lastName','displayName',
			'externalId','loginId','sisId','notes','absenceCount',
		],
		Sessions: ['id','classId','date','createdAt','savedAt','picksCSV','picksNamesCSV','carryoverCSV','carryoverNamesCSV'],
		Marks: ['sessionId','studentId','displayName','status','reason','markedAt'],
		Ledger: ['id','classId','studentId','displayName','date','sessionId','reason','notes'],
		Settings: CHECKPOINT_SETTINGS_HEADERS,
	}
	const existing = await getSheetTitles(spreadsheetId)
	const missing = Object.keys(required).filter((t) => !existing.has(t))
	console.log(LOG_PREFIX, 'Ensuring required sheets', { missing })
	if (missing.length) {
		const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`
		await fetchJson(url, {
			method: 'POST',
			body: JSON.stringify({
				requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
			}),
		})
	}
	// Write headers only for newly added sheets (do not rewrite existing headers)
	await Promise.all(
		Object.entries(required)
			.filter(([t]) => !existing.has(t))
			.map(([t, headers]) => writeHeaderRow(spreadsheetId, t, headers)),
	)
}

function normalizeHeaderCell(value: string | null | undefined): string {
	return String(value ?? '').trim()
}

function buildHeaderIndex(headers: string[]): Map<string, number> {
	const map = new Map<string, number>()
	headers.forEach((h, idx) => {
		const key = normalizeHeaderCell(h)
		if (key) map.set(key, idx)
	})
	return map
}

async function readClassIdentityFromClasses(spreadsheetId: string): Promise<{ classIds: string[]; classNameById: Map<string, string> }> {
	const rows = await readValues(spreadsheetId, 'Classes!A2:B')
	const classNameById = new Map<string, string>()
	const ids: string[] = []
	for (const r of rows) {
		const id = normalizeHeaderCell(r?.[0] as any)
		if (!id) continue
		if (!classNameById.has(id)) {
			classNameById.set(id, normalizeHeaderCell(r?.[1] as any))
			ids.push(id)
		}
	}
	return { classIds: ids, classNameById }
}

export async function ensureCheckpointSettingsHeader(spreadsheetId: string): Promise<void> {
	const headerRows = await readValues(spreadsheetId, 'Settings!A1:Z1')
	const headerRow = (headerRows?.[0] || []).map((h) => normalizeHeaderCell(h as any))
	const matches = CHECKPOINT_SETTINGS_HEADERS.every((h, idx) => headerRow[idx] === h)
	if (!matches) {
		await writeHeaderRow(spreadsheetId, 'Settings', CHECKPOINT_SETTINGS_HEADERS)
	}
}

export async function probeCheckpointSpreadsheetIdentity(spreadsheetId: string): Promise<SpreadsheetIdentityProbe> {
	const settingsRows = await readValues(spreadsheetId, 'Settings!A1:Z')
	if (!settingsRows.length) {
		return { isLegacy: true }
	}
	const header = (settingsRows[0] || []).map((h) => normalizeHeaderCell(h as any))
	const body = settingsRows.slice(1).filter((r) => r.some((c) => normalizeHeaderCell(c as any) !== ''))
	const headerIndex = buildHeaderIndex(header)
	const classIdIdx = headerIndex.get('classId')
	const classNameIdx = headerIndex.get('className')
	const schemaIdx = headerIndex.get('schemaVersion')
	const lastExportedIdx = headerIndex.get('lastExportedAt')

	const hasIdentityHeaders = classNameIdx !== undefined && schemaIdx !== undefined && lastExportedIdx !== undefined

	if (classIdIdx === undefined) {
		const fallback = await readClassIdentityFromClasses(spreadsheetId)
		if (fallback.classIds.length === 1) {
			const onlyId = fallback.classIds[0]
			return {
				isLegacy: true,
				classId: onlyId,
				className: fallback.classNameById.get(onlyId),
			}
		}
		if (fallback.classIds.length > 1) {
			return { isLegacy: true, multipleClassIds: fallback.classIds }
		}
		return { isLegacy: true }
	}

	const classIds = Array.from(
		new Set(
			body
				.map((r) => normalizeHeaderCell(r?.[classIdIdx] as any))
				.filter((id) => {
					if (!id) return false
					const lower = id.toLowerCase()
					return !/^class\s*id$/.test(lower)
				}),
		),
	)

	if (classIds.length > 1) {
		return { isLegacy: !hasIdentityHeaders, multipleClassIds: classIds }
	}

	if (classIds.length === 1) {
		const classId = classIds[0]
		const row = body.find((r) => normalizeHeaderCell(r?.[classIdIdx] as any) === classId) || []
		const className = classNameIdx !== undefined ? normalizeHeaderCell(row?.[classNameIdx] as any) : undefined
		const schemaVersion = schemaIdx !== undefined ? normalizeHeaderCell(row?.[schemaIdx] as any) : undefined
		const lastExportedAt = lastExportedIdx !== undefined
			? normalizeHeaderCell(row?.[lastExportedIdx] as any)
			: normalizeHeaderCell(row?.[4] as any)
		return {
			isLegacy: !hasIdentityHeaders,
			classId,
			className,
			schemaVersion,
			lastExportedAt: lastExportedAt || undefined,
		}
	}

	// No class IDs in Settings body; fall back to Classes tab
	const fallback = await readClassIdentityFromClasses(spreadsheetId)
	if (fallback.classIds.length === 1) {
		const onlyId = fallback.classIds[0]
		return {
			isLegacy: true,
			classId: onlyId,
			className: fallback.classNameById.get(onlyId),
		}
	}
	if (fallback.classIds.length > 1) {
		return { isLegacy: true, multipleClassIds: fallback.classIds }
	}
	return { isLegacy: true }
}


