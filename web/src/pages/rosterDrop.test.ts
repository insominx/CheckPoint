import { describe, expect, it } from 'vitest'
import { pickRosterCsv } from './rosterDrop'

const file = (name: string, type = '') => new File(['studentId,displayName\n1,Ada'], name, { type })

describe('pickRosterCsv', () => {
	it('accepts a .csv by extension even without a MIME type', () => {
		const picked = pickRosterCsv([file('roster.csv')])
		expect('file' in picked && picked.file.name).toBe('roster.csv')
	})

	it('accepts a CSV MIME type', () => {
		const picked = pickRosterCsv([file('students', 'text/csv')])
		expect('file' in picked).toBe(true)
	})

	it('rejects a non-CSV drop', () => {
		const picked = pickRosterCsv([file('notes.txt', 'text/plain')])
		expect(picked).toEqual({ error: 'Please drop a CSV file.' })
	})

	it('rejects an empty drop', () => {
		expect(pickRosterCsv([])).toEqual({ error: 'No file dropped.' })
		expect(pickRosterCsv(null)).toEqual({ error: 'No file dropped.' })
	})
})
