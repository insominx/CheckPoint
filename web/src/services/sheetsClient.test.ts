import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeSpreadsheetAccess, SHEETS_SCOPES } from './sheetsClient'

describe('probeSpreadsheetAccess', () => {
	const requestAccessToken = vi.fn()

	beforeEach(() => {
		vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client')
		requestAccessToken.mockImplementation(() => {
			// @ts-expect-error test-only Google Identity shim
			window.google.accounts.oauth2.initTokenClient.mock.calls.at(-1)?.[0].callback({
				access_token: 'token', expires_in: 3600, scope: SHEETS_SCOPES.join(' '),
			})
		})
		Object.assign(globalThis, {
			window: {
				google: { accounts: { oauth2: { initTokenClient: vi.fn(() => ({ requestAccessToken })) } } },
			},
		})
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it.each([200, 204])('classifies HTTP %s as accessible', async (status) => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
		await expect(probeSpreadsheetAccess('sheet-id')).resolves.toEqual({ status: 'accessible' })
	})

	it('classifies only HTTP 404 as missing', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', { status: 404 })))
		await expect(probeSpreadsheetAccess('sheet-id')).resolves.toEqual({ status: 'missing' })
	})

	it.each([401, 403, 500])('rejects HTTP %s instead of reporting a missing sheet', async (status) => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status })))
		await expect(probeSpreadsheetAccess('sheet-id')).rejects.toThrow(`Google API error ${status}: denied`)
	})

	it('propagates fetch failures', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
		await expect(probeSpreadsheetAccess('sheet-id')).rejects.toThrow('offline')
	})
})
