import { describe, expect, it } from 'vitest'
import {
	buildClassFile,
	CLASS_FILE_FORMAT,
	CLASS_FILE_VERSION,
	parseClassFile,
	remapClassFile,
	type ClassFileBackup,
} from './classFile'

const backup = (): ClassFileBackup => ({
	format: CLASS_FILE_FORMAT,
	version: CLASS_FILE_VERSION,
	exportedAt: '2026-09-02T12:00:00.000Z',
	class: { id: 'class-old', name: 'CST 325' },
	settings: { defaultN: 7, neverSeenWeight: 3, cooldownWeight: 0.25 },
	students: [
		{ id: 'student-1', classId: 'class-old', displayName: 'Ada' },
		{ id: 'student-2', classId: 'class-old', displayName: 'Grace' },
	],
	sessions: [{
		id: 'session-1',
		classId: 'class-old',
		date: '2026-09-01T12:00:00.000Z',
		picks: ['student-1', 'student-2'],
		carryoverIds: ['student-1'],
		marks: {
			'student-1': { status: 'absent', reason: 'excused' },
			'student-2': { status: 'present' },
		},
	}],
	ledger: [{
		id: 'ledger-1',
		classId: 'class-old',
		studentId: 'student-1',
		sessionId: 'session-1',
		date: '2026-09-01T12:00:00.000Z',
		reason: 'excused',
	}],
	draftSession: {
		id: 'draft-1',
		classId: 'class-old',
		date: '2026-09-02T12:00:00.000Z',
		picks: ['student-2'],
		marks: { 'student-2': { status: 'present' } },
	},
})

describe('class file backup', () => {
	it('builds and parses a complete backup without linked Sheet metadata', () => {
		const file = buildClassFile({
			cls: { id: 'class-old', name: 'CST 325' },
			settings: {
				classId: 'class-old',
				defaultN: 7,
				neverSeenWeight: 3,
				cooldownWeight: 0.25,
				spreadsheetId: 'sheet-id',
				lastExportedAt: '2026-09-01T00:00:00.000Z',
			},
			students: backup().students,
			sessions: backup().sessions,
			ledger: backup().ledger,
		}, backup().draftSession, '2026-09-02T12:00:00.000Z')

		expect(file.settings).toEqual({ defaultN: 7, neverSeenWeight: 3, cooldownWeight: 0.25 })
		expect(file.settings).not.toHaveProperty('spreadsheetId')
		expect(parseClassFile(JSON.stringify(file))).toEqual({ ok: true, data: file })
	})

	it.each([
		['invalid JSON', '{'],
		['wrong format', JSON.stringify({ ...backup(), format: 'other' })],
		['future version', JSON.stringify({ ...backup(), version: 2 })],
		['invalid dates', JSON.stringify({ ...backup(), exportedAt: 'not-a-date' })],
		['mixed class IDs', JSON.stringify({
			...backup(),
			students: [{ ...backup().students[0], classId: 'other' }],
		})],
		['dangling student reference', JSON.stringify({
			...backup(),
			sessions: [{ ...backup().sessions[0], picks: ['missing'] }],
		})],
		['dangling session reference', JSON.stringify({
			...backup(),
			ledger: [{ ...backup().ledger[0], sessionId: 'missing' }],
		})],
	])('rejects %s', (_label, json) => {
		expect(parseClassFile(json).ok).toBe(false)
	})

	it('remaps all IDs and references, including marks and the draft', () => {
		let next = 0
		const remapped = remapClassFile(backup(), () => `new-${++next}`)
		const [student1, student2] = remapped.students
		const session = remapped.sessions[0]
		const ledger = remapped.ledger[0]

		expect(remapped.class).toEqual({ id: 'new-1', name: 'CST 325' })
		expect(remapped.settings).toMatchObject({ classId: 'new-1', defaultN: 7 })
		expect(student1.classId).toBe('new-1')
		expect(student1.id).not.toBe('student-1')
		expect(session.classId).toBe('new-1')
		expect(session.picks).toEqual([student1.id, student2.id])
		expect(session.carryoverIds).toEqual([student1.id])
		expect(Object.keys(session.marks)).toEqual([student1.id, student2.id])
		expect(ledger).toMatchObject({
			classId: 'new-1',
			studentId: student1.id,
			sessionId: session.id,
		})
		expect(remapped.draftSession).toMatchObject({
			classId: 'new-1',
			picks: [student2.id],
		})
		expect(Object.keys(remapped.draftSession?.marks ?? {})).toEqual([student2.id])
	})
})
