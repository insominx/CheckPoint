/** "Tue, Oct 20, 3:36 PM" — readable at a glance, including from across a room. */
export function formatDateTime(iso: string): string {
	return new Date(iso).toLocaleString(undefined, {
		weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
	})
}
