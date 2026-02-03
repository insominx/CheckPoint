import { describe, expect, it } from 'vitest'
import * as google from './google'

describe('google spreadsheet id helpers', () => {
	it('parses spreadsheet ID from a full URL', () => {
		const url = 'https://docs.google.com/spreadsheets/d/abcDEF123-_4567890_long_id/edit#gid=0'
		expect(google.parseSpreadsheetId(url)).toBe('abcDEF123-_4567890_long_id')
	})

	it('returns raw ID when no URL match', () => {
		expect(google.parseSpreadsheetId('abcDEF123-_456')).toBe('abcDEF123-_456')
	})

	it('validates and normalizes spreadsheet IDs', () => {
		const url = 'https://docs.google.com/spreadsheets/d/abcDEF123-_4567890_long_id/edit#gid=0'
		expect(google.normalizeAndValidateSpreadsheetId(url)).toBe('abcDEF123-_4567890_long_id')
		expect(google.isLikelySpreadsheetId('short')).toBe(false)
	})

	it('throws on invalid spreadsheet IDs', () => {
		expect(() => google.normalizeAndValidateSpreadsheetId('not-an-id')).toThrow('Invalid Spreadsheet ID')
	})
})

describe('deriveCheckpointSpreadsheetIdentity', () => {
	it('returns legacy when Settings sheet is empty', () => {
		const result = google.deriveCheckpointSpreadsheetIdentity([])
		expect(result.isLegacy).toBe(true)
		expect(result.classId).toBeUndefined()
	})

	it('returns multipleClassIds when Settings has multiple class IDs', () => {
		const settingsRows = [
			['classId', 'className', 'schemaVersion', 'lastExportedAt'],
			['classA', 'Alpha', '2', '2026-02-03T10:00:00Z'],
			['classB', 'Beta', '2', '2026-02-03T10:00:00Z'],
		]
		const result = google.deriveCheckpointSpreadsheetIdentity(settingsRows as any)
		expect(result.multipleClassIds).toEqual(['classA', 'classB'])
		expect(result.isLegacy).toBe(false)
	})

	it('returns identity details when Settings contains a single class', () => {
		const settingsRows = [
			['classId', 'className', 'defaultN', 'neverSeenWeight', 'cooldownWeight', 'schemaVersion', 'lastExportedAt'],
			['classA', 'Alpha', '5', '2', '0.5', '2', '2026-02-03T10:00:00Z'],
		]
		const result = google.deriveCheckpointSpreadsheetIdentity(settingsRows as any)
		expect(result.isLegacy).toBe(false)
		expect(result.classId).toBe('classA')
		expect(result.className).toBe('Alpha')
		expect(result.schemaVersion).toBe('2')
		expect(result.lastExportedAt).toBe('2026-02-03T10:00:00Z')
	})

	it('falls back to Classes sheet when Settings has no classId header', () => {
		const settingsRows = [
			['className', 'schemaVersion', 'lastExportedAt'],
			['Alpha', '2', '2026-02-03T10:00:00Z'],
		]
		const classesRows = [
			['classA', 'Alpha'],
		]
		const result = google.deriveCheckpointSpreadsheetIdentity(settingsRows as any, classesRows as any)
		expect(result.isLegacy).toBe(true)
		expect(result.classId).toBe('classA')
		expect(result.className).toBe('Alpha')
	})
})
