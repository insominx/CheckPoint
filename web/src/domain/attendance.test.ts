import { describe, it, expect } from 'vitest'
import {
    computeCarryovers,
    computeEligibleWithWeights,
    isCarryover,
    countAbsences,
    countAbsencesByStudent,
} from './attendance'

describe('computeCarryovers', () => {
    it('returns empty when no ledger entries exist', () => {
        const result = computeCarryovers(['s1', 's2'], [], [])
        expect(result).toEqual([])
    })

    it('returns student who was absent and never marked present', () => {
        const ledger = [{ studentId: 's1', date: '2024-01-10T10:00:00Z' }]
        const sessions: { date: string; marks: Record<string, { status: 'present' | 'absent' }> }[] = []

        const result = computeCarryovers(['s1', 's2'], ledger, sessions)
        expect(result).toEqual(['s1'])
    })

    it('does not return student who was marked present after absence', () => {
        const ledger = [{ studentId: 's1', date: '2024-01-10T10:00:00Z' }]
        const sessions = [
            { date: '2024-01-15T10:00:00Z', marks: { s1: { status: 'present' as const } } },
        ]

        const result = computeCarryovers(['s1', 's2'], ledger, sessions)
        expect(result).toEqual([])
    })

    it('returns student who was absent AFTER being marked present', () => {
        const ledger = [{ studentId: 's1', date: '2024-01-20T10:00:00Z' }]
        const sessions = [
            { date: '2024-01-15T10:00:00Z', marks: { s1: { status: 'present' as const } } },
        ]

        const result = computeCarryovers(['s1', 's2'], ledger, sessions)
        expect(result).toEqual(['s1'])
    })

    it('handles multiple absences correctly - uses most recent', () => {
        const ledger = [
            { studentId: 's1', date: '2024-01-05T10:00:00Z' },
            { studentId: 's1', date: '2024-01-25T10:00:00Z' }, // Most recent absence
        ]
        const sessions = [
            { date: '2024-01-15T10:00:00Z', marks: { s1: { status: 'present' as const } } },
        ]

        // s1 was absent on Jan 25, present on Jan 15 → still a carryover
        const result = computeCarryovers(['s1'], ledger, sessions)
        expect(result).toEqual(['s1'])
    })

    it('handles multiple students independently', () => {
        const ledger = [
            { studentId: 's1', date: '2024-01-10T10:00:00Z' },
            { studentId: 's2', date: '2024-01-10T10:00:00Z' },
        ]
        const sessions = [
            { date: '2024-01-15T10:00:00Z', marks: { s1: { status: 'present' as const } } },
            // s2 was never marked present
        ]

        const result = computeCarryovers(['s1', 's2', 's3'], ledger, sessions)
        expect(result).toEqual(['s2']) // s1 cleared, s2 still carries, s3 never absent
    })
})

describe('computeEligibleWithWeights', () => {
    it('excludes students who were ever absent', () => {
        const ledger = [{ studentId: 's1', date: '2024-01-10T10:00:00Z' }]
        const sessions: { picks: string[]; marks: Record<string, unknown> }[] = []

        const result = computeEligibleWithWeights(['s1', 's2', 's3'], ledger, sessions)
        const ids = result.map((r) => r.item)

        expect(ids).not.toContain('s1')
        expect(ids).toContain('s2')
        expect(ids).toContain('s3')
    })

    it('gives neverSeenWeight to students never marked', () => {
        const ledger: { studentId: string; date: string }[] = []
        const sessions = [{ picks: ['s1'], marks: { s1: {} } }]

        const result = computeEligibleWithWeights(['s1', 's2'], ledger, sessions, {
            neverSeenWeight: 2.0,
        })

        const s1Weight = result.find((r) => r.item === 's1')?.weight
        const s2Weight = result.find((r) => r.item === 's2')?.weight

        expect(s1Weight).toBe(1.0) // s1 was marked
        expect(s2Weight).toBe(2.0) // s2 never seen
    })

    it('applies cooldown to students in both of last two sessions', () => {
        const ledger: { studentId: string; date: string }[] = []
        const sessions = [
            { picks: ['s1', 's2'], marks: { s1: {}, s2: {} } },
            { picks: ['s1', 's3'], marks: { s1: {}, s3: {} } },
        ]

        const result = computeEligibleWithWeights(['s1', 's2', 's3', 's4'], ledger, sessions, {
            neverSeenWeight: 2.0,
            cooldownWeight: 0.5,
        })

        // s1 was in both → gets cooldown
        const s1 = result.find((r) => r.item === 's1')
        expect(s1?.weight).toBe(1.0 * 0.5) // marked * cooldown

        // s2 was only in first → no cooldown
        const s2 = result.find((r) => r.item === 's2')
        expect(s2?.weight).toBe(1.0)

        // s4 never seen → neverSeenWeight, no cooldown
        const s4 = result.find((r) => r.item === 's4')
        expect(s4?.weight).toBe(2.0)
    })
})

describe('isCarryover', () => {
    it('returns true for unresolved absence', () => {
        const ledger = [{ studentId: 's1', date: '2024-01-10T10:00:00Z' }]
        expect(isCarryover('s1', ledger, [])).toBe(true)
    })

    it('returns false for resolved absence', () => {
        const ledger = [{ studentId: 's1', date: '2024-01-10T10:00:00Z' }]
        const sessions = [{ date: '2024-01-15T10:00:00Z', marks: { s1: { status: 'present' as const } } }]
        expect(isCarryover('s1', ledger, sessions)).toBe(false)
    })

    it('returns false for student never absent', () => {
        expect(isCarryover('s1', [], [])).toBe(false)
    })
})

describe('countAbsences', () => {
    it('returns 0 for student with no absences', () => {
        expect(countAbsences('s1', [])).toBe(0)
    })

    it('counts multiple absences correctly', () => {
        const ledger = [
            { studentId: 's1', date: '2024-01-10T10:00:00Z' },
            { studentId: 's1', date: '2024-01-15T10:00:00Z' },
            { studentId: 's2', date: '2024-01-10T10:00:00Z' },
        ]
        expect(countAbsences('s1', ledger)).toBe(2)
        expect(countAbsences('s2', ledger)).toBe(1)
        expect(countAbsences('s3', ledger)).toBe(0)
    })
})

describe('countAbsencesByStudent', () => {
    it('returns a map with counts per student', () => {
        const ledger = [
            { studentId: 's1', date: '2024-01-10T10:00:00Z' },
            { studentId: 's1', date: '2024-01-15T10:00:00Z' },
            { studentId: 's2', date: '2024-01-10T10:00:00Z' },
        ]

        const result = countAbsencesByStudent(ledger)
        expect(result.get('s1')).toBe(2)
        expect(result.get('s2')).toBe(1)
        expect(result.get('s3')).toBeUndefined()
    })

    it('returns an empty map when ledger is empty', () => {
        const result = countAbsencesByStudent([])
        expect(result.size).toBe(0)
    })
})
