const GIS_SRC = 'https://accounts.google.com/gsi/client'
const LOG_PREFIX = '[Google]'

let gisLoaded: Promise<void> | null = null
let accessToken: string | null = null
let accessTokenExpiresAt: number | null = null
let grantedScopes = new Set<string>()

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
		Sessions: ['id','classId','date','picksCSV','picksNamesCSV','carryoverCSV','carryoverNamesCSV'],
		Marks: ['sessionId','studentId','displayName','status','reason'],
		Ledger: ['id','classId','studentId','displayName','date','sessionId','reason','notes'],
		Settings: ['classId','defaultN','neverSeenWeight','cooldownWeight'],
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
		Sessions: ['id','classId','date','picksCSV','picksNamesCSV','carryoverCSV','carryoverNamesCSV'],
		Marks: ['sessionId','studentId','displayName','status','reason'],
		Ledger: ['id','classId','studentId','displayName','date','sessionId','reason','notes'],
		Settings: ['classId','defaultN','neverSeenWeight','cooldownWeight'],
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


