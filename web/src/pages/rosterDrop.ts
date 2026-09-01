export function pickRosterCsv(files: FileList | Iterable<File> | null | undefined): { file: File } | { error: string } {
	const list = files ? Array.from(files) : []
	if (list.length === 0) return { error: 'No file dropped.' }
	const file = list[0]
	const name = file.name.toLowerCase()
	const type = file.type
	const isCsv =
		name.endsWith('.csv') ||
		type === 'text/csv' ||
		type === 'application/csv' ||
		type === 'application/vnd.ms-excel'
	if (!isCsv) return { error: 'Please drop a CSV file.' }
	return { file }
}
