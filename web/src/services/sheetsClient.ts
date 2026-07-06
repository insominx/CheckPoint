/**
 * Thin Google Sheets client: OAuth token handling plus generic spreadsheet
 * operations (create, read, clear, batch write). No CheckPoint semantics here.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client'

export const SHEETS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
export const SHEETS_AND_DRIVE_SCOPES = [
	'https://www.googleapis.com/auth/spreadsheets',
	'https://www.googleapis.com/auth/drive.file',
]

let gisLoaded: Promise<void> | null = null
let accessToken: string | null = null
let accessTokenExpiresAt: number | null = null
const grantedScopes = new Set<string>()

async function loadGis(): Promise<void> {
	if (gisLoaded) return gisLoaded
	gisLoaded = new Promise((resolve, reject) => {
		// @ts-expect-error google may already exist on window
		if (window.google?.accounts?.oauth2) return resolve()
		const s = document.createElement('script')
		s.src = GIS_SRC
		s.async = true
		s.onload = () => resolve()
		s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
		document.head.appendChild(s)
	})
	return gisLoaded
}

export async function getAccessToken(scopes: string[] = SHEETS_SCOPES): Promise<string> {
	await loadGis()
	const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
	if (!clientId) throw new Error('Missing VITE_GOOGLE_CLIENT_ID')

	const now = Date.now()
	const needsScopes = scopes.some((s) => !grantedScopes.has(s))
	const tokenValid = !!accessToken && !!accessTokenExpiresAt && now < accessTokenExpiresAt - 30_000
	if (tokenValid && !needsScopes) return accessToken as string

	return new Promise<string>((resolve, reject) => {
		// @ts-expect-error google on window
		const tokenClient = window.google.accounts.oauth2.initTokenClient({
			client_id: clientId,
			scope: scopes.join(' '),
			prompt: needsScopes ? 'consent' : '',
			callback: (resp: { access_token?: string; expires_in?: number; scope?: string; error?: string }) => {
				if (resp?.access_token) {
					accessToken = resp.access_token
					const expires = Number(resp.expires_in) || 3600
					accessTokenExpiresAt = Date.now() + Math.max(1, expires - 30) * 1000
					for (const s of String(resp.scope || '').split(/\s+/).filter(Boolean)) grantedScopes.add(s)
					resolve(resp.access_token)
				} else {
					reject(new Error(resp?.error || 'No access token returned'))
				}
			},
			error_callback: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
		})
		tokenClient.requestAccessToken({ prompt: needsScopes ? 'consent' : '' })
	})
}

async function fetchJson(url: string, init?: RequestInit) {
	const token = await getAccessToken()
	const res = await fetch(url, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
			...(init?.headers || {}),
		},
	})
	if (!res.ok) {
		const text = await res.text().catch(() => '')
		throw new Error(`Google API error ${res.status}: ${text || res.statusText}`)
	}
	return res.json()
}

const base = 'https://sheets.googleapis.com/v4/spreadsheets'

export async function createSpreadsheetWithTabs(title: string, sheetTitles: string[]): Promise<string> {
	const data = await fetchJson(base, {
		method: 'POST',
		body: JSON.stringify({
			properties: { title },
			sheets: sheetTitles.map((t) => ({ properties: { title: t } })),
		}),
	})
	return data.spreadsheetId as string
}

export async function getSheetTitles(spreadsheetId: string): Promise<Set<string>> {
	const data = await fetchJson(`${base}/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title))`)
	const titles = new Set<string>()
	for (const s of (data.sheets as Array<{ properties?: { title?: string } }>) || []) {
		if (s?.properties?.title) titles.add(s.properties.title)
	}
	return titles
}

export async function addSheets(spreadsheetId: string, titles: string[]): Promise<void> {
	if (!titles.length) return
	await fetchJson(`${base}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
		method: 'POST',
		body: JSON.stringify({ requests: titles.map((title) => ({ addSheet: { properties: { title } } })) }),
	})
}

export async function spreadsheetExists(spreadsheetId: string): Promise<boolean> {
	const token = await getAccessToken()
	const res = await fetch(`${base}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId`, {
		headers: { Authorization: `Bearer ${token}` },
	})
	if (res.status === 404 || res.status === 403) return false
	return res.ok
}

/** Reads multiple A1 ranges in one request; returns them in input order. */
export async function batchReadValues(spreadsheetId: string, rangesA1: string[]): Promise<(string | null)[][][]> {
	const params = rangesA1.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')
	const url = `${base}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`
	const data = await fetchJson(url)
	const ranges = (data.valueRanges as Array<{ values?: (string | null)[][] }>) || []
	return rangesA1.map((_, i) => ranges[i]?.values ?? [])
}

/** Clears multiple A1 ranges in one request. */
export async function batchClearValues(spreadsheetId: string, rangesA1: string[]): Promise<void> {
	await fetchJson(`${base}/${encodeURIComponent(spreadsheetId)}/values:batchClear`, {
		method: 'POST',
		body: JSON.stringify({ ranges: rangesA1 }),
	})
}

export type CellValue = string | number | boolean | null

/** Writes multiple ranges in one request. */
export async function batchWriteValues(
	spreadsheetId: string,
	data: Array<{ range: string; values: CellValue[][] }>,
): Promise<void> {
	if (!data.length) return
	await fetchJson(`${base}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
		method: 'POST',
		body: JSON.stringify({
			valueInputOption: 'RAW',
			data: data.map((d) => ({ range: d.range, majorDimension: 'ROWS', values: d.values })),
		}),
	})
}

// ---------- Spreadsheet ID helpers ----------

export function parseSpreadsheetId(input: string): string {
	const trimmed = (input || '').trim()
	const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
	if (m && m[1]) return m[1]
	return trimmed
}

export function isLikelySpreadsheetId(id: string): boolean {
	return /^[a-zA-Z0-9-_]{20,}$/.test(id)
}

export function normalizeAndValidateSpreadsheetId(input: string): string {
	const id = parseSpreadsheetId(input)
	if (!isLikelySpreadsheetId(id)) {
		throw new Error('Invalid spreadsheet ID. Paste the full sheet URL or the ID from /spreadsheets/d/<ID>/.')
	}
	return id
}

export function spreadsheetUrl(spreadsheetId: string): string {
	return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`
}
