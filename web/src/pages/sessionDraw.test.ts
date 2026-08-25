import { describe, expect, it } from 'vitest'
import { drawFailureMessage, shouldAutoDraw, shouldCommitStudentInfo } from './sessionDraw'

describe('Session class-keyed auto draw', () => {
	it('starts once for a ready class with no draft', () => {
		expect(shouldAutoDraw({ ready: true, classId: 'A', inFlight: null })).toBe(true)
		expect(shouldAutoDraw({ ready: true, classId: 'A', inFlight: null, lastAttemptedClass: 'A' })).toBe(false)
	})

	it('does not draw over a restored class draft or during another operation', () => {
		expect(shouldAutoDraw({ ready: true, classId: 'A', currentSessionClassId: 'A', inFlight: null })).toBe(false)
		expect(shouldAutoDraw({ ready: true, classId: 'A', inFlight: 'save' })).toBe(false)
	})

	it('allows a fresh attempt after switching classes', () => {
		expect(shouldAutoDraw({ ready: true, classId: 'B', inFlight: null, lastAttemptedClass: 'A' })).toBe(true)
	})

	it('maps blocked and failed results to retryable copy', () => {
		expect(drawFailureMessage('blocked')).toMatch(/temporarily blocked/)
		expect(drawFailureMessage('error')).toMatch(/failed/)
		expect(drawFailureMessage('ok')).toBeNull()
	})

	it('commits student info only while mounted in its requested class', () => {
		expect(shouldCommitStudentInfo({ requestedClassId: 'A', currentClassId: 'B', isMounted: true })).toBe(false)
		expect(shouldCommitStudentInfo({ requestedClassId: 'A', currentClassId: 'A', isMounted: false })).toBe(false)
		expect(shouldCommitStudentInfo({ requestedClassId: 'A', currentClassId: 'A', isMounted: true })).toBe(true)
	})
})
