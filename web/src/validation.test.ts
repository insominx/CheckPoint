import { describe, it, expect } from 'vitest'
import { validateStudentRow, validateSessionRow, validateLedgerRow, validateMarkRow, isValidISODate } from './validation'

describe('validateStudentRow', () => {
    const classId = 'class-1'

    it('returns valid student for complete row', () => {
        const row = ['student-1', 'class-1', 'John', 'Doe', 'John Doe']
        const result = validateStudentRow(row, classId)
        expect(result).toEqual({
            id: 'student-1',
            classId: 'class-1',
            displayName: 'John Doe',
            firstName: 'John',
            lastName: 'Doe'
        })
    })

    it('uses provided classId when row classId is empty', () => {
        const row = ['student-1', '', '', '', 'John Doe']
        const result = validateStudentRow(row, classId)
        expect(result).toMatchObject({ id: 'student-1', classId: 'class-1', displayName: 'John Doe' })
    })

    it('returns null when id is missing', () => {
        const row = ['', 'class-1', '', '', 'John Doe']
        expect(validateStudentRow(row, classId)).toBeNull()
    })

    it('returns null when displayName is missing', () => {
        const row = ['student-1', 'class-1', '', '', '']
        expect(validateStudentRow(row, classId)).toBeNull()
    })

    it('returns null when classId does not match', () => {
        const row = ['student-1', 'other-class', '', '', 'John Doe']
        expect(validateStudentRow(row, classId)).toBeNull()
    })

    it('trims whitespace from values', () => {
        const row = ['  student-1  ', 'class-1', ' ', ' ', '  John Doe  ']
        const result = validateStudentRow(row, classId)
        expect(result?.id).toBe('student-1')
        expect(result?.displayName).toBe('John Doe')
    })
})

describe('validateSessionRow', () => {
    const classId = 'class-1'

    it('returns valid session for complete row', () => {
        const row = ['session-1', 'class-1', '2024-01-15T10:00:00Z', '', '']
        const result = validateSessionRow(row, classId)
        expect(result).not.toBeNull()
        expect(result?.id).toBe('session-1')
        expect(result?.date).toBe('2024-01-15T10:00:00Z')
    })

    it('returns null when id is missing', () => {
        const row = ['', 'class-1', '2024-01-15T10:00:00Z']
        expect(validateSessionRow(row, classId)).toBeNull()
    })

    it('returns null when date is invalid', () => {
        const row = ['session-1', 'class-1', 'not-a-date']
        expect(validateSessionRow(row, classId)).toBeNull()
    })

    it('returns null when classId does not match', () => {
        const row = ['session-1', 'other-class', '2024-01-15T10:00:00Z']
        expect(validateSessionRow(row, classId)).toBeNull()
    })
})

describe('validateLedgerRow', () => {
    const classId = 'class-1'

    it('returns valid ledger item for complete row', () => {
        const row = ['ledger-1', 'class-1', 'student-1', 'John Doe', '2024-01-15T10:00:00Z', 'session-1', 'excused', 'notes']
        const result = validateLedgerRow(row, classId)
        expect(result).not.toBeNull()
        expect(result?.id).toBe('ledger-1')
        expect(result?.studentId).toBe('student-1')
        expect(result?.reason).toBe('excused')
    })

    it('returns null when studentId is missing', () => {
        const row = ['ledger-1', 'class-1', '', 'John Doe', '2024-01-15T10:00:00Z']
        expect(validateLedgerRow(row, classId)).toBeNull()
    })

	it('returns null when date is invalid', () => {
		const row = ['ledger-1', 'class-1', 'student-1', 'John Doe', 'not-a-date']
		expect(validateLedgerRow(row, classId)).toBeNull()
	})

    it('parses reason correctly', () => {
        const row = ['ledger-1', 'class-1', 'student-1', '', '2024-01-15T10:00:00Z', '', 'UNEXCUSED']
        const result = validateLedgerRow(row, classId)
        expect(result?.reason).toBe('unexcused')
    })

    it('returns undefined reason for unknown values', () => {
        const row = ['ledger-1', 'class-1', 'student-1', '', '2024-01-15T10:00:00Z', '', 'unknown']
        const result = validateLedgerRow(row, classId)
        expect(result?.reason).toBeUndefined()
    })
})

describe('validateMarkRow', () => {
	it('returns valid mark for complete row', () => {
		const row = ['session-1', 'student-1', 'John Doe', 'absent', 'excused', '2024-01-15T10:00:00Z']
		const result = validateMarkRow(row)
		expect(result).not.toBeNull()
		expect(result?.sessionId).toBe('session-1')
		expect(result?.studentId).toBe('student-1')
		expect(result?.mark.status).toBe('absent')
		expect(result?.mark.reason).toBe('excused')
	})

	it('returns null when status is invalid', () => {
		const row = ['session-1', 'student-1', '', 'maybe', '', '2024-01-15T10:00:00Z']
		expect(validateMarkRow(row)).toBeNull()
	})

	it('returns null when markedAt is invalid', () => {
		const row = ['session-1', 'student-1', '', 'present', '', 'not-a-date']
		expect(validateMarkRow(row)).toBeNull()
	})
})

describe('isValidISODate', () => {
    it('returns true for valid ISO date', () => {
        expect(isValidISODate('2024-01-15T10:00:00Z')).toBe(true)
    })

    it('returns true for date-only string', () => {
        expect(isValidISODate('2024-01-15')).toBe(true)
    })

    it('returns false for empty string', () => {
        expect(isValidISODate('')).toBe(false)
    })

    it('returns false for invalid date', () => {
        expect(isValidISODate('not-a-date')).toBe(false)
    })
})
