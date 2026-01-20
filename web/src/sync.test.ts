import { describe, it, expect } from 'vitest'
import { shouldWarnAboutConflict, canStartOperation } from './sync'

describe('shouldWarnAboutConflict', () => {
    it('returns false when remote timestamp is undefined', () => {
        expect(shouldWarnAboutConflict(undefined, '2024-01-15T10:00:00Z')).toBe(false)
    })

    it('returns false when local timestamp is undefined', () => {
        expect(shouldWarnAboutConflict('2024-01-15T10:00:00Z', undefined)).toBe(false)
    })

    it('returns false when both timestamps are undefined', () => {
        expect(shouldWarnAboutConflict(undefined, undefined)).toBe(false)
    })

    it('returns false when remote is older than local', () => {
        const remote = '2024-01-10T10:00:00Z'
        const local = '2024-01-15T10:00:00Z'
        expect(shouldWarnAboutConflict(remote, local)).toBe(false)
    })

    it('returns false when timestamps are equal', () => {
        const timestamp = '2024-01-15T10:00:00Z'
        expect(shouldWarnAboutConflict(timestamp, timestamp)).toBe(false)
    })

    it('returns true when remote is newer than local', () => {
        const remote = '2024-01-20T10:00:00Z'
        const local = '2024-01-15T10:00:00Z'
        expect(shouldWarnAboutConflict(remote, local)).toBe(true)
    })

    it('handles null values', () => {
        expect(shouldWarnAboutConflict(null, '2024-01-15T10:00:00Z')).toBe(false)
        expect(shouldWarnAboutConflict('2024-01-15T10:00:00Z', null)).toBe(false)
    })
})

describe('canStartOperation', () => {
    it('returns true when not in progress and no existing result', () => {
        expect(canStartOperation(false, false)).toBe(true)
    })

    it('returns false when operation is in progress', () => {
        expect(canStartOperation(true, false)).toBe(false)
    })

    it('returns false when existing result exists', () => {
        expect(canStartOperation(false, true)).toBe(false)
    })

    it('returns false when both conditions are true', () => {
        expect(canStartOperation(true, true)).toBe(false)
    })
})
