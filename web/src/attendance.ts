/**
 * Pure functions for attendance logic.
 * These are extracted from store.ts for testability.
 */


/** Minimal data needed for carryover computation */
export interface LedgerEntry {
    studentId: string
    date: string
}

/** Minimal session data for carryover computation */
export interface SessionMarks {
    date: string
    marks: Record<string, { status: 'present' | 'absent' }>
}

/**
 * Compute which students should carry over to the next session.
 * A student is a carryover if:
 * - They were marked absent at least once (in ledger)
 * - Their most recent absence is MORE RECENT than their most recent present mark
 */
export function computeCarryovers(
    studentIds: string[],
    ledger: LedgerEntry[],
    sessions: SessionMarks[],
): string[] {
    // Build map: studentId -> most recent absent date
    const lastAbsentDateByStudent = new Map<string, string>()
    for (const item of ledger) {
        const prev = lastAbsentDateByStudent.get(item.studentId)
        if (!prev || Date.parse(item.date) > Date.parse(prev)) {
            lastAbsentDateByStudent.set(item.studentId, item.date)
        }
    }

    // Build map: studentId -> most recent present date
    const lastPresentDateByStudent = new Map<string, string>()
    for (const s of sessions) {
        for (const [sid, mark] of Object.entries(s.marks)) {
            if (mark.status === 'present') {
                const prev = lastPresentDateByStudent.get(sid)
                if (!prev || Date.parse(s.date) > Date.parse(prev)) {
                    lastPresentDateByStudent.set(sid, s.date)
                }
            }
        }
    }

    // Carryover if: was absent AND (never marked present OR last present < last absent)
    return studentIds.filter((id) => {
        const lastAbsent = lastAbsentDateByStudent.get(id)
        if (!lastAbsent) return false
        const lastPresent = lastPresentDateByStudent.get(id)
        if (!lastPresent) return true
        return Date.parse(lastPresent) < Date.parse(lastAbsent)
    })
}

/**
 * Compute weighted items for random sampling.
 * - Never-seen students get neverSeenWeight (default 2.0)
 * - Students in both of the last two sessions get cooldownWeight multiplier (default 0.5)
 * - Students who were ever absent are excluded (they're handled as carryovers)
 */
export function computeEligibleWithWeights(
    studentIds: string[],
    ledger: LedgerEntry[],
    sessions: { picks: string[]; marks: Record<string, unknown> }[],
    options: { neverSeenWeight?: number; cooldownWeight?: number } = {},
): Array<{ item: string; weight: number }> {
    const neverSeenWeight = options.neverSeenWeight ?? 2.0
    const cooldownWeight = options.cooldownWeight ?? 0.5

    // Students who were ever absent are ineligible for random selection
    const everAbsentIds = new Set(ledger.map((l) => l.studentId))
    const eligible = studentIds.filter((id) => !everAbsentIds.has(id))

    // Determine who has ever been marked (seen)
    const allMarkedIds = new Set<string>()
    for (const s of sessions) {
        for (const sid of Object.keys(s.marks)) {
            allMarkedIds.add(sid)
        }
    }

    // Determine who was in BOTH of the last two sessions
    const involvedInLastTwo = new Set<string>()
    const sortedSessions = sessions // assume already sorted by caller
    if (sortedSessions.length >= 2) {
        const s1Picks = new Set(sortedSessions[0].picks)
        const s2Picks = new Set(sortedSessions[1].picks)
        for (const id of eligible) {
            if (s1Picks.has(id) && s2Picks.has(id)) {
                involvedInLastTwo.add(id)
            }
        }
    }

    // Compute weights
    return eligible.map((id) => {
        let weight = allMarkedIds.has(id) ? 1.0 : neverSeenWeight
        if (involvedInLastTwo.has(id)) {
            weight *= cooldownWeight
        }
        return { item: id, weight }
    })
}

/**
 * Check if a student is currently a carryover (has unresolved absence).
 */
export function isCarryover(
    studentId: string,
    ledger: LedgerEntry[],
    sessions: SessionMarks[],
): boolean {
    return computeCarryovers([studentId], ledger, sessions).length > 0
}

/**
 * Count absences for a student from ledger entries.
 */
export function countAbsences(studentId: string, ledger: LedgerEntry[]): number {
    return ledger.filter((l) => l.studentId === studentId).length
}

/**
 * Build a per-student absence count map from ledger entries.
 */
export function countAbsencesByStudent(ledger: LedgerEntry[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const entry of ledger) {
        counts.set(entry.studentId, (counts.get(entry.studentId) || 0) + 1)
    }
    return counts
}
