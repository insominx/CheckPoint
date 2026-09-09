/**
 * Pure rewrite of saved attendance when a student is hard-removed.
 * Callers persist the plan; this module does no I/O.
 */

import type { AbsenceLedgerItem, SessionEntity } from '../types'

export interface StudentErasePlan {
	sessionsToPut: SessionEntity[]
	sessionIdsToDelete: string[]
	ledgerIdsToDelete: string[]
}

function referencesStudent(session: SessionEntity, studentId: string): boolean {
	if (session.picks.includes(studentId)) return true
	if (session.carryoverIds?.includes(studentId)) return true
	return Object.prototype.hasOwnProperty.call(session.marks, studentId)
}

function scrubSession(session: SessionEntity, studentId: string): SessionEntity {
	const next: SessionEntity = {
		...session,
		picks: session.picks.filter((id) => id !== studentId),
		marks: Object.fromEntries(Object.entries(session.marks).filter(([id]) => id !== studentId)),
	}
	if (session.carryoverIds !== undefined) {
		next.carryoverIds = session.carryoverIds.filter((id) => id !== studentId)
	}
	return next
}

/**
 * Empty picks after a scrub deletes the whole session (History is pick-centric).
 * Ledger rows for those session ids are deleted with it, same as History delete.
 */
export function eraseStudentFromRecords(
	studentId: string,
	sessions: SessionEntity[],
	ledger: AbsenceLedgerItem[],
): StudentErasePlan {
	const sessionsToPut: SessionEntity[] = []
	const sessionIdsToDelete: string[] = []

	for (const session of sessions) {
		if (!referencesStudent(session, studentId)) continue
		const scrubbed = scrubSession(session, studentId)
		if (scrubbed.picks.length === 0) sessionIdsToDelete.push(session.id)
		else sessionsToPut.push(scrubbed)
	}

	const deletedSessions = new Set(sessionIdsToDelete)
	const ledgerIdsToDelete = ledger
		.filter((item) => item.studentId === studentId || (item.sessionId !== undefined && deletedSessions.has(item.sessionId)))
		.map((item) => item.id)

	return { sessionsToPut, sessionIdsToDelete, ledgerIdsToDelete }
}

/** Strips ids that are not on the roster. Returns `undefined` when no picks remain. */
export function keepEnrolledInSession(
	session: SessionEntity,
	knownIds: Iterable<string>,
): SessionEntity | undefined {
	const known = knownIds instanceof Set ? knownIds : new Set(knownIds)
	const hasUnknownPick = session.picks.some((id) => !known.has(id))
	const hasUnknownMark = Object.keys(session.marks).some((id) => !known.has(id))
	const hasUnknownCarryover = session.carryoverIds?.some((id) => !known.has(id)) ?? false
	if (!hasUnknownPick && !hasUnknownMark && !hasUnknownCarryover) return session

	const picks = session.picks.filter((id) => known.has(id))
	if (picks.length === 0) return undefined

	const next: SessionEntity = {
		...session,
		picks,
		marks: Object.fromEntries(Object.entries(session.marks).filter(([id]) => known.has(id))),
	}
	if (session.carryoverIds !== undefined) {
		next.carryoverIds = session.carryoverIds.filter((id) => known.has(id))
	}
	return next
}
