/**
 * Pure builder for a draft session: carryovers (uncapped) plus a weighted
 * random draw of N never-absent students. No I/O — callers supply the data.
 */

import type { AbsenceLedgerItem, SessionEntity, StudentEntity } from '../types'
import { computeCarryovers, computeEligibleWithWeights } from './attendance'
import { weightedSampleWithoutReplacement } from './sampling'

export const DEFAULT_N = 5
export const DEFAULT_NEVER_SEEN_WEIGHT = 2.0
export const DEFAULT_COOLDOWN_WEIGHT = 0.5

export interface DraftSessionInputs {
	classId: string
	students: StudentEntity[]
	/** All saved sessions for the class, any order. */
	sessions: SessionEntity[]
	ledger: AbsenceLedgerItem[]
	/** Requested random sample size. */
	n: number
	neverSeenWeight?: number
	cooldownWeight?: number
	/** Existing draft whose identity and carryovers are preserved for a re-draw. */
	redrawFrom?: SessionEntity
	/** Injectable for deterministic tests. */
	newId: () => string
	now?: () => string
	seed?: string
}

export function buildDraftSession(inputs: DraftSessionInputs): SessionEntity {
	const {
		classId, students, ledger, n,
		redrawFrom, newId, seed,
	} = inputs
	const now = inputs.now ?? (() => new Date().toISOString())

	// Most recent first; downstream weighting relies on this order.
	const sessions = [...inputs.sessions].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))

	const studentIds = students.map((s) => s.id)
	const derivedCarryovers = computeCarryovers(studentIds, ledger, sessions)

	const knownIds = new Set(studentIds)
	const carryoverInput = redrawFrom?.carryoverIds ?? derivedCarryovers
	const carryoverIds = Array.from(new Set(carryoverInput.filter((id) => knownIds.has(id))))
	const carryoverSet = new Set(carryoverIds)

	const weighted = computeEligibleWithWeights(
		studentIds.filter((id) => !carryoverSet.has(id)),
		ledger,
		sessions,
		{
			neverSeenWeight: Number.isFinite(inputs.neverSeenWeight) ? inputs.neverSeenWeight : DEFAULT_NEVER_SEEN_WEIGHT,
			cooldownWeight: Number.isFinite(inputs.cooldownWeight) ? inputs.cooldownWeight : DEFAULT_COOLDOWN_WEIGHT,
		},
	)

	const safeN = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_N
	const randomIds = weightedSampleWithoutReplacement(weighted, safeN, seed ? { seed } : undefined)
	const picks = Array.from(new Set<string>([...carryoverIds, ...randomIds]))

	const session: SessionEntity = {
		id: redrawFrom?.id ?? newId(),
		classId,
		date: redrawFrom?.date ?? now(),
		picks,
		carryoverIds,
		marks: {},
	}
	if (redrawFrom?.createdAt) session.createdAt = redrawFrom.createdAt
	if (redrawFrom?.savedAt) session.savedAt = redrawFrom.savedAt

	return session
}
