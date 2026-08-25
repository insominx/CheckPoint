import type { BusyKey, PickStatus } from '../store'

export function shouldAutoDraw(input: {
	ready: boolean
	classId?: string
	currentSessionClassId?: string
	inFlight: BusyKey | null
	lastAttemptedClass?: string
}): boolean {
	return Boolean(
		input.ready && input.classId &&
		input.currentSessionClassId !== input.classId &&
		input.inFlight === null && input.lastAttemptedClass !== input.classId,
	)
}

export function drawFailureMessage(status: PickStatus): string | null {
	if (status === 'blocked') return 'Student drawing is temporarily blocked by another operation.'
	if (status === 'error') return 'Student drawing failed.'
	if (status === 'no-class') return 'The selected class is no longer available.'
	return null
}

export function shouldCommitStudentInfo(input: {
	requestedClassId: string
	currentClassId?: string
	isMounted: boolean
}): boolean {
	return input.isMounted && input.requestedClassId === input.currentClassId
}
