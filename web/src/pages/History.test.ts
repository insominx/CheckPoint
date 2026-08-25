import { describe, expect, it } from 'vitest'
import {
	reduceExpansion,
	shouldCommitHistoryDetails,
	shouldCommitHistoryRows,
	type ExpansionState,
} from './historyExpansion'
import type { SessionEntity } from '../types'

const details = (id: string, classId = 'c1') => ({
	session: { id, classId, date: '2026-01-01', picks: [], marks: {} } satisfies SessionEntity,
	studentNames: {},
})

describe('History request-keyed expansion', () => {
	it('ignores a late A response after B becomes current', () => {
		let state: ExpansionState = { kind: 'closed' }
		state = reduceExpansion(state, { type: 'load', classId: 'c1', sessionId: 'A', requestId: 1 })
		state = reduceExpansion(state, { type: 'load', classId: 'c1', sessionId: 'B', requestId: 2 })
		state = reduceExpansion(state, { type: 'loaded', classId: 'c1', sessionId: 'A', requestId: 1, details: details('A') })
		expect(state).toEqual({ kind: 'loading', classId: 'c1', sessionId: 'B', requestId: 2 })
		state = reduceExpansion(state, { type: 'loaded', classId: 'c1', sessionId: 'B', requestId: 2, details: details('B') })
		expect(state.kind === 'open' && state.details.session.id).toBe('B')
	})

	it('ignores the first A generation after A to B to A', () => {
		let state: ExpansionState = { kind: 'loading', classId: 'c1', sessionId: 'A', requestId: 3 }
		state = reduceExpansion(state, { type: 'loaded', classId: 'c1', sessionId: 'A', requestId: 1, details: details('stale-A') })
		expect(state).toEqual({ kind: 'loading', classId: 'c1', sessionId: 'A', requestId: 3 })
	})

	it('keeps correction status and refreshes scoped to the open request', () => {
		let state: ExpansionState = { kind: 'open', classId: 'c1', sessionId: 'A', requestId: 1, details: details('A'), correcting: false }
		state = reduceExpansion(state, { type: 'correcting', classId: 'c1', sessionId: 'A', requestId: 1, value: true })
		expect(state.kind === 'open' && state.correcting).toBe(true)
		state = reduceExpansion(state, { type: 'loaded', classId: 'c1', sessionId: 'B', requestId: 2, details: details('B') })
		expect(state.kind === 'open' && state.details.session.id).toBe('A')
	})

	it('invalidates late work when closed', () => {
		let state: ExpansionState = reduceExpansion({ kind: 'loading', classId: 'c1', sessionId: 'A', requestId: 1 }, { type: 'close' })
		state = reduceExpansion(state, { type: 'loaded', classId: 'c1', sessionId: 'A', requestId: 1, details: details('A') })
		expect(state).toEqual({ kind: 'closed' })
	})

	it('commits rows only for the current class and latest generation', () => {
		expect(shouldCommitHistoryRows({ requestedClassId: 'A', currentClassId: 'B', requestedGeneration: 1, currentGeneration: 2 })).toBe(false)
		expect(shouldCommitHistoryRows({ requestedClassId: 'A', currentClassId: 'A', requestedGeneration: 1, currentGeneration: 2 })).toBe(false)
		expect(shouldCommitHistoryRows({ requestedClassId: 'A', currentClassId: 'A', requestedGeneration: 3, currentGeneration: 3 })).toBe(true)
	})

	it('commits details only for the open class-owned session request', () => {
		expect(shouldCommitHistoryDetails({
		requestedClassId: 'A', currentClassId: 'A', requestedGeneration: 2, currentGeneration: 2, sessionClassId: 'B',
	})).toBe(false)
		expect(shouldCommitHistoryDetails({
		requestedClassId: 'A', currentClassId: 'B', requestedGeneration: 2, currentGeneration: 2, sessionClassId: 'A',
	})).toBe(false)
		expect(shouldCommitHistoryDetails({
		requestedClassId: 'A', currentClassId: 'A', requestedGeneration: 2, currentGeneration: 2, sessionClassId: 'A',
	})).toBe(true)
	})
})
