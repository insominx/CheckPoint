import { describe, expect, it } from 'vitest'
import type { AbsenceLedgerItem, SessionEntity } from '../types'
import { eraseStudentFromRecords, keepEnrolledInSession } from './studentRemoval'

function session(overrides: Partial<SessionEntity>): SessionEntity {
	return {
		id: 's1',
		classId: 'c1',
		date: '2026-01-01T10:00:00Z',
		picks: ['a', 'b'],
		carryoverIds: [],
		marks: {},
		...overrides,
	}
}

function ledger(overrides: Partial<AbsenceLedgerItem>): AbsenceLedgerItem {
	return {
		id: 'l1',
		classId: 'c1',
		studentId: 'a',
		date: '2026-01-01T10:00:00Z',
		...overrides,
	}
}

describe('eraseStudentFromRecords', () => {
	it('strips the student from picks, marks, and carryovers', () => {
		const plan = eraseStudentFromRecords(
			'a',
			[session({
				picks: ['a', 'b'],
				carryoverIds: ['a'],
				marks: { a: { status: 'absent' }, b: { status: 'present' } },
			})],
			[ledger({ id: 'l-a', studentId: 'a' }), ledger({ id: 'l-other', studentId: 'z' })],
		)

		expect(plan.sessionIdsToDelete).toEqual([])
		expect(plan.sessionsToPut).toEqual([
			session({
				picks: ['b'],
				carryoverIds: [],
				marks: { b: { status: 'present' } },
			}),
		])
		expect(plan.ledgerIdsToDelete).toEqual(['l-a'])
	})

	it('deletes a session that has no remaining picks', () => {
		const plan = eraseStudentFromRecords(
			'a',
			[session({ id: 'only-a', picks: ['a'], carryoverIds: ['a'], marks: { a: { status: 'absent' } } })],
			[ledger({ id: 'l-a', studentId: 'a', sessionId: 'only-a' })],
		)

		expect(plan.sessionsToPut).toEqual([])
		expect(plan.sessionIdsToDelete).toEqual(['only-a'])
		expect(plan.ledgerIdsToDelete).toEqual(['l-a'])
	})

	it('leaves unrelated sessions untouched', () => {
		const other = session({ id: 's-other', picks: ['b', 'c'], marks: { b: { status: 'present' } } })
		const plan = eraseStudentFromRecords('a', [other], [ledger({ id: 'l-b', studentId: 'b' })])

		expect(plan.sessionsToPut).toEqual([])
		expect(plan.sessionIdsToDelete).toEqual([])
		expect(plan.ledgerIdsToDelete).toEqual([])
	})

	it('deletes ledger rows for the student even when they are not in any session', () => {
		const plan = eraseStudentFromRecords(
			'a',
			[],
			[ledger({ id: 'orphan', studentId: 'a' }), ledger({ id: 'keep', studentId: 'b' })],
		)

		expect(plan).toEqual({
			sessionsToPut: [],
			sessionIdsToDelete: [],
			ledgerIdsToDelete: ['orphan'],
		})
	})

	it('cleans leftover ledger rows for a deleted empty session', () => {
		const plan = eraseStudentFromRecords(
			'a',
			[session({ id: 'empty-after', picks: ['a'] })],
			[ledger({ id: 'stale', studentId: 'b', sessionId: 'empty-after' })],
		)

		expect(plan.sessionIdsToDelete).toEqual(['empty-after'])
		expect(plan.ledgerIdsToDelete).toEqual(['stale'])
	})
})

describe('keepEnrolledInSession', () => {
	it('returns the original session when every referenced id is known', () => {
		const current = session({ picks: ['b'], marks: { b: { status: 'present' } }, carryoverIds: ['b'] })
		expect(keepEnrolledInSession(current, ['b'])).toBe(current)
	})

	it('returns undefined when no enrolled picks remain', () => {
		expect(keepEnrolledInSession(
			session({ picks: ['a'], marks: { a: { status: 'present' } } }),
			['b'],
		)).toBeUndefined()
	})

	it('strips unknown picks, marks, and carryovers', () => {
		const next = keepEnrolledInSession(
			session({
				picks: ['a', 'b'],
				carryoverIds: ['a', 'b'],
				marks: { a: { status: 'absent' }, b: { status: 'present' } },
			}),
			['b'],
		)
		expect(next).toEqual(session({
			picks: ['b'],
			carryoverIds: ['b'],
			marks: { b: { status: 'present' } },
		}))
	})
})
