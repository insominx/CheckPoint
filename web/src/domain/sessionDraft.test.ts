import { describe, it, expect } from 'vitest'
import { buildDraftSession } from './sessionDraft'
import type { SessionEntity, StudentEntity } from '../types'

function student(id: string): StudentEntity {
	return { id, classId: 'c1', displayName: `Student ${id}` }
}

function session(overrides: Partial<SessionEntity>): SessionEntity {
	return {
		id: 's-base',
		classId: 'c1',
		date: '2026-01-01T10:00:00Z',
		picks: [],
		carryoverIds: [],
		marks: {},
		...overrides,
	}
}

const newId = () => 'new-session-id'

describe('buildDraftSession', () => {
	const students = ['a', 'b', 'c', 'd', 'e'].map(student)

	it('includes all carryovers plus a random draw of N', () => {
		const draft = buildDraftSession({
			classId: 'c1',
			students,
			sessions: [
				session({ id: 's1', date: '2026-01-02T10:00:00Z', marks: { a: { status: 'absent' } } }),
			],
			ledger: [{ id: 'l1', classId: 'c1', studentId: 'a', date: '2026-01-02T10:00:00Z' }],
			n: 2,
			newId,
			seed: 'fixed',
		})
		expect(draft.carryoverIds).toEqual(['a'])
		expect(draft.picks).toContain('a')
		// carryover + 2 random from {b,c,d,e}
		expect(draft.picks.length).toBe(3)
		expect(draft.id).toBe('new-session-id')
	})

	it('carryover clears once the student is marked present later', () => {
		const draft = buildDraftSession({
			classId: 'c1',
			students,
			sessions: [
				session({ id: 's1', date: '2026-01-02T10:00:00Z', marks: { a: { status: 'absent' } } }),
				session({ id: 's2', date: '2026-01-03T10:00:00Z', marks: { a: { status: 'present' } } }),
			],
			ledger: [{ id: 'l1', classId: 'c1', studentId: 'a', date: '2026-01-02T10:00:00Z' }],
			n: 0,
			newId,
		})
		expect(draft.carryoverIds).toEqual([])
	})

	it('never draws ever-absent students into the random set', () => {
		// 'a' was absent then present (resolved) — still excluded from random draw
		const draft = buildDraftSession({
			classId: 'c1',
			students,
			sessions: [
				session({ id: 's1', date: '2026-01-02T10:00:00Z', marks: { a: { status: 'absent' } } }),
				session({ id: 's2', date: '2026-01-03T10:00:00Z', marks: { a: { status: 'present' } } }),
			],
			ledger: [{ id: 'l1', classId: 'c1', studentId: 'a', date: '2026-01-02T10:00:00Z' }],
			n: 10,
			newId,
		})
		expect(draft.picks).not.toContain('a')
		expect(draft.picks.sort()).toEqual(['b', 'c', 'd', 'e'])
	})

	it('re-draw keeps id, date, and carryovers from the base session', () => {
		const base = session({ id: 'existing', date: '2026-01-05T09:00:00Z', carryoverIds: ['a'], picks: ['a', 'b'] })
		const draft = buildDraftSession({
			classId: 'c1',
			students,
			sessions: [],
			ledger: [],
			n: 2,
			carryoverIdsOverride: base.carryoverIds,
			baseSession: base,
			resetMarks: true,
			newId,
		})
		expect(draft.id).toBe('existing')
		expect(draft.date).toBe('2026-01-05T09:00:00Z')
		expect(draft.carryoverIds).toEqual(['a'])
		expect(draft.marks).toEqual({})
	})

	it('drops carryover overrides for students no longer on the roster', () => {
		const draft = buildDraftSession({
			classId: 'c1',
			students,
			sessions: [],
			ledger: [],
			n: 1,
			carryoverIdsOverride: ['ghost', 'a'],
			newId,
		})
		expect(draft.carryoverIds).toEqual(['a'])
	})

	it('draws as many as available when eligible pool is smaller than N', () => {
		const draft = buildDraftSession({
			classId: 'c1',
			students: [student('a'), student('b')],
			sessions: [],
			ledger: [],
			n: 10,
			newId,
		})
		expect(draft.picks.sort()).toEqual(['a', 'b'])
	})

	it('falls back to default N when n is invalid', () => {
		const draft = buildDraftSession({
			classId: 'c1',
			students,
			sessions: [],
			ledger: [],
			n: NaN,
			newId,
		})
		expect(draft.picks.length).toBe(5)
	})
})
