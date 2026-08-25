import type { SessionEntity } from '../types'

export interface ExpandedDetails {
	session: SessionEntity
	studentNames: Record<string, string>
}

export type ExpansionState =
	| { kind: 'closed' }
	| { kind: 'loading'; classId: string; sessionId: string; requestId: number }
	| { kind: 'open'; classId: string; sessionId: string; requestId: number; details: ExpandedDetails; correcting: boolean }

export type ExpansionAction =
	| { type: 'close' }
	| { type: 'load'; classId: string; sessionId: string; requestId: number }
	| { type: 'loaded'; classId: string; sessionId: string; requestId: number; details: ExpandedDetails }
	| { type: 'correcting'; classId: string; sessionId: string; requestId: number; value: boolean }

export function shouldCommitHistoryRows(input: {
	requestedClassId: string
	currentClassId?: string
	requestedGeneration: number
	currentGeneration: number
}): boolean {
	return input.requestedClassId === input.currentClassId && input.requestedGeneration === input.currentGeneration
}

export function shouldCommitHistoryDetails(input: {
	requestedClassId: string
	currentClassId?: string
	requestedGeneration: number
	currentGeneration: number
	sessionClassId: string
}): boolean {
	return shouldCommitHistoryRows(input) && input.sessionClassId === input.requestedClassId
}

export function reduceExpansion(state: ExpansionState, action: ExpansionAction): ExpansionState {
	if (action.type === 'close') return { kind: 'closed' }
	if (action.type === 'load') return { kind: 'loading', classId: action.classId, sessionId: action.sessionId, requestId: action.requestId }
	if (
		state.kind === 'closed' || state.classId !== action.classId ||
		state.sessionId !== action.sessionId || state.requestId !== action.requestId
	) return state
	if (action.type === 'loaded') {
		return { kind: 'open', classId: action.classId, sessionId: action.sessionId, requestId: action.requestId, details: action.details, correcting: false }
	}
	if (action.type === 'correcting' && state.kind === 'open') return { ...state, correcting: action.value }
	return state
}
