import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({
	addSheets: vi.fn(),
	batchClearValues: vi.fn(),
	batchReadValues: vi.fn(),
	batchWriteValues: vi.fn(),
	createSpreadsheetWithTabs: vi.fn(),
	getSheetTitles: vi.fn(),
	probeSpreadsheetAccess: vi.fn(),
}))

vi.mock('./sheetsClient', () => client)

import { exportClassToSheet } from './sheetsSync'

const dataset = {
	cls: { id: 'c1', name: 'Class One' },
	students: [], sessions: [], ledger: [],
	settings: { classId: 'c1', defaultN: 5, neverSeenWeight: 2, cooldownWeight: 0.5 },
}

describe('exportClassToSheet target policy', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		client.createSpreadsheetWithTabs.mockResolvedValue('new-sheet')
		client.getSheetTitles.mockResolvedValue(new Set(['Classes', 'Students', 'Sessions', 'Marks', 'Ledger', 'Settings']))
	})

	it.each([
		['no linked id', undefined],
		['confirmed 404', 'old-sheet'],
	])('creates a sheet for %s', async (_, id) => {
		if (id) client.probeSpreadsheetAccess.mockResolvedValue({ status: 'missing' })
		const result = await exportClassToSheet(dataset, id)
		expect(result.spreadsheetId).toBe('new-sheet')
		expect(client.createSpreadsheetWithTabs).toHaveBeenCalledOnce()
	})

	it('overwrites an accessible linked sheet', async () => {
		client.probeSpreadsheetAccess.mockResolvedValue({ status: 'accessible' })
		const result = await exportClassToSheet(dataset, 'old-sheet')
		expect(result.spreadsheetId).toBe('old-sheet')
		expect(client.createSpreadsheetWithTabs).not.toHaveBeenCalled()
		expect(client.getSheetTitles).toHaveBeenCalledWith('old-sheet')
		const writes = client.batchWriteValues.mock.calls.at(-1)?.[1] as Array<{ range: string; values: unknown[][] }>
		expect(writes.find((write) => write.range === 'Classes!A1')?.values[1]?.[2]).toBe(5)
		expect(writes.find((write) => write.range === 'Settings!A1')?.values[1]?.[2]).toBe(5)
	})

	it('projects the settings default into both compatibility cells', async () => {
		client.probeSpreadsheetAccess.mockResolvedValue({ status: 'accessible' })
		await exportClassToSheet({ ...dataset, settings: { ...dataset.settings, defaultN: 7 } }, 'old-sheet')
		const writes = client.batchWriteValues.mock.calls.at(-1)?.[1] as Array<{ range: string; values: unknown[][] }>
		expect(writes.find((write) => write.range === 'Classes!A1')?.values[1]?.[2]).toBe(7)
		expect(writes.find((write) => write.range === 'Settings!A1')?.values[1]?.[2]).toBe(7)
	})

	it('fails closed when the access probe rejects', async () => {
		client.probeSpreadsheetAccess.mockRejectedValue(new Error('Google API error 403: denied'))
		await expect(exportClassToSheet(dataset, 'old-sheet')).rejects.toThrow('403')
		expect(client.createSpreadsheetWithTabs).not.toHaveBeenCalled()
		expect(client.batchWriteValues).not.toHaveBeenCalled()
	})
})
