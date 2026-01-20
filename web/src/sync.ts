/**
 * Pure functions for synchronization logic.
 * Extracted from store.ts for testability.
 */

/**
 * Determine if we should warn the user about a potential conflict.
 * Returns true if the remote timestamp is newer than the local timestamp,
 * meaning someone else may have modified the Sheet since our last export.
 */
export function shouldWarnAboutConflict(
    remoteTimestamp: string | undefined | null,
    localTimestamp: string | undefined | null,
): boolean {
    if (!remoteTimestamp || !localTimestamp) return false
    return remoteTimestamp > localTimestamp
}

/**
 * Determine if an operation is safe to proceed based on guard state.
 * Returns false if we should block the operation.
 */
export function canStartOperation(
    isOperationInProgress: boolean,
    hasExistingResult: boolean,
): boolean {
    if (isOperationInProgress) return false
    if (hasExistingResult) return false
    return true
}
