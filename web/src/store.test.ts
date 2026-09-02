import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEntity } from './types'

const repo = vi.hoisted(() => ({
	listClasses: vi.fn(), getClass: vi.fn(), getEffectiveSettings: vi.fn(), createClass: vi.fn(),
	createClassFromDataset: vi.fn(), deleteClassCascade: vi.fn(), getClassDataset: vi.fn(), saveSessionWithLedger: vi.fn(),
	updateSettings: vi.fn(), getSettings: vi.fn(), replaceClassData: vi.fn(),
}))
const sheets = vi.hoisted(() => ({ exportClassToSheet: vi.fn(), fetchClassTabs: vi.fn() }))
const google = vi.hoisted(() => ({ getAccessToken: vi.fn(), normalizeAndValidateSpreadsheetId: vi.fn((id: string) => id) }))

vi.mock('./data/repository', () => repo)
vi.mock('./services/sheetsSync', () => sheets)
vi.mock('./services/sheetsClient', () => ({
	...google,
	SHEETS_AND_DRIVE_SCOPES: ['sheets', 'drive'],
}))

class MemoryStorage implements Storage {
	private values = new Map<string, string>()
	get length() { return this.values.size }
	clear() { this.values.clear() }
	getItem(key: string) { return this.values.get(key) ?? null }
	key(index: number) { return [...this.values.keys()][index] ?? null }
	removeItem(key: string) { this.values.delete(key) }
	setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const storage = new MemoryStorage()
vi.stubGlobal('localStorage', storage)

let useStore: typeof import('./store').useStore

const cls = (id: string) => ({ id, name: `Class ${id}` })
const draft = (classId: string, id = `draft-${classId}`): SessionEntity => ({
	id, classId, date: '2026-08-25T12:00:00Z', picks: [], carryoverIds: [], marks: {},
})
const dataset = () => ({ students: [], sessions: [], ledger: [], settings: undefined, cls: cls('A') })
const deferred = <T,>() => {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
	return { promise, resolve, reject }
}

beforeAll(async () => {
	useStore = (await import('./store')).useStore
})

beforeEach(() => {
	vi.clearAllMocks()
	storage.clear()
	repo.listClasses.mockResolvedValue([])
	repo.getEffectiveSettings.mockResolvedValue({ classId: 'A', defaultN: 5, neverSeenWeight: 2, cooldownWeight: 0.5 })
	repo.getClassDataset.mockResolvedValue(dataset())
	useStore.setState({
		ready: true, classes: [], selectedClass: undefined, currentN: 5,
		currentSession: undefined, inFlight: null,
	})
})

describe('selected class authority', () => {
	it('publishes ready only after the winning concurrent init restores its selection', async () => {
		const firstRestore = deferred<ReturnType<typeof cls>>()
		const secondRestore = deferred<ReturnType<typeof cls>>()
		storage.setItem('checkpoint_selected_class', 'A')
		storage.setItem('checkpoint_draft_session_A', JSON.stringify(draft('A')))
		repo.getClass
			.mockReturnValueOnce(firstRestore.promise)
			.mockReturnValueOnce(secondRestore.promise)

		const firstInit = useStore.getState().init()
		await vi.waitFor(() => expect(repo.getClass).toHaveBeenCalledTimes(1))
		const secondInit = useStore.getState().init()
		await vi.waitFor(() => expect(repo.getClass).toHaveBeenCalledTimes(2))
		firstRestore.resolve(cls('A'))
		await firstInit

		expect(useStore.getState()).toMatchObject({ ready: false, selectedClass: undefined, currentSession: undefined })
		secondRestore.resolve(cls('A'))
		await secondInit

		expect(useStore.getState()).toMatchObject({
			ready: true, selectedClass: cls('A'), currentSession: draft('A'),
		})
	})

	it('commits only the latest concurrent selection', async () => {
		const classA = deferred<ReturnType<typeof cls>>()
		const classB = deferred<ReturnType<typeof cls>>()
		const settingsA = deferred<{ classId: string; defaultN: number; neverSeenWeight: number; cooldownWeight: number }>()
		const settingsB = deferred<{ classId: string; defaultN: number; neverSeenWeight: number; cooldownWeight: number }>()
		storage.setItem('checkpoint_draft_session_A', JSON.stringify(draft('A')))
		storage.setItem('checkpoint_draft_session_B', JSON.stringify(draft('B')))
		repo.getClass.mockImplementation((id: string) => id === 'A' ? classA.promise : classB.promise)
		repo.getEffectiveSettings.mockImplementation((id: string) => id === 'A' ? settingsA.promise : settingsB.promise)

		const selectingA = useStore.getState().selectClass('A')
		classA.resolve(cls('A'))
		await vi.waitFor(() => expect(repo.getEffectiveSettings).toHaveBeenCalledWith('A'))
		const selectingB = useStore.getState().selectClass('B')
		classB.resolve(cls('B'))
		await vi.waitFor(() => expect(repo.getEffectiveSettings).toHaveBeenCalledWith('B'))
		settingsB.resolve({ classId: 'B', defaultN: 7, neverSeenWeight: 2, cooldownWeight: 0.5 })
		await selectingB
		settingsA.resolve({ classId: 'A', defaultN: 3, neverSeenWeight: 2, cooldownWeight: 0.5 })
		await selectingA

		expect(useStore.getState()).toMatchObject({
			selectedClass: cls('B'), currentN: 7, currentSession: draft('B'),
		})
		expect(storage.getItem('checkpoint_selected_class')).toBe('B')
		expect(repo.getEffectiveSettings).toHaveBeenCalledTimes(2)
	})

	it('fails closed and clears persisted scope when selection is missing', async () => {
		storage.setItem('checkpoint_selected_class', 'missing')
		repo.getClass.mockResolvedValue(undefined)
		await useStore.getState().selectClass('missing')
		expect(useStore.getState().selectedClass).toBeUndefined()
		expect(storage.getItem('checkpoint_selected_class')).toBeNull()
	})

	it('restores only the draft belonging to the resolved class', async () => {
		storage.setItem('checkpoint_draft_session_A', JSON.stringify(draft('A')))
		storage.setItem('checkpoint_draft_session_B', JSON.stringify(draft('A', 'wrong')))
		repo.getClass.mockImplementation(async (id: string) => cls(id))
		await useStore.getState().selectClass('A')
		expect(useStore.getState().currentSession?.id).toBe('draft-A')
		await useStore.getState().selectClass('B')
		expect(useStore.getState().currentSession).toBeUndefined()
	})

	it('does not autosave a session under another selected class', () => {
		useStore.setState({ selectedClass: cls('A'), currentSession: draft('B') })
		expect(storage.getItem('checkpoint_draft_session_A')).toBeNull()
		expect(storage.getItem('checkpoint_draft_session_B')).toBeNull()
	})

	it('ignores a pick completion after class identity drifts', async () => {
		const pending = deferred<ReturnType<typeof dataset>>()
		repo.getClassDataset.mockReturnValue(pending.promise)
		useStore.setState({ selectedClass: cls('A') })
		const result = useStore.getState().pickStudents()
		useStore.setState({ selectedClass: cls('B') })
		pending.resolve(dataset())
		await expect(result).resolves.toBe('blocked')
		expect(useStore.getState().currentSession).toBeUndefined()
	})
})

describe('exclusive operations', () => {
	it('rejects deletion before any side effect while an operation is in flight', async () => {
		storage.setItem('checkpoint_draft_session_A', JSON.stringify(draft('A')))
		useStore.setState({ selectedClass: cls('A'), inFlight: 'pick' })

		await expect(useStore.getState().deleteClass('A')).resolves.toEqual({
			ok: false, error: 'Another operation is already in progress.',
		})

		expect(repo.deleteClassCascade).not.toHaveBeenCalled()
		expect(repo.listClasses).not.toHaveBeenCalled()
		expect(storage.getItem('checkpoint_draft_session_A')).not.toBeNull()
	})

	it('blocks overlap and class switching until the owning operation releases', async () => {
		const pending = deferred<ReturnType<typeof dataset>>()
		repo.getClassDataset.mockReturnValue(pending.promise)
		useStore.setState({ selectedClass: cls('A') })
		const picking = useStore.getState().pickStudents()
		expect(useStore.getState().inFlight).toBe('pick')
		await expect(useStore.getState().exportToSheets()).resolves.toMatchObject({ ok: false })
		await useStore.getState().selectClass('B')
		expect(useStore.getState().selectedClass?.id).toBe('A')
		expect(google.getAccessToken).not.toHaveBeenCalled()
		pending.resolve(dataset())
		await expect(picking).resolves.toBe('ok')
		expect(useStore.getState().inFlight).toBeNull()
	})

	it('releases the slot when an operation throws', async () => {
		useStore.setState({ selectedClass: cls('A') })
		repo.getClassDataset.mockRejectedValue(new Error('db failed'))
		await expect(useStore.getState().pickStudents()).resolves.toBe('error')
		expect(useStore.getState().inFlight).toBeNull()
	})

	it('does not persist a replacement sheet id when export fails', async () => {
		useStore.setState({ selectedClass: cls('A') })
		repo.getClassDataset.mockResolvedValue({ ...dataset(), settings: { spreadsheetId: 'old-sheet' } })
		sheets.exportClassToSheet.mockRejectedValue(new Error('Google API error 403'))
		const result = await useStore.getState().exportToSheets()
		expect(result).toEqual({ ok: false, error: 'Google API error 403' })
		expect(repo.updateSettings).not.toHaveBeenCalled()
		expect(useStore.getState().inFlight).toBeNull()
	})

	it('keeps a newer immutable same-id draft when a captured save completes', async () => {
		const pending = deferred<void>()
		repo.saveSessionWithLedger.mockReturnValue(pending.promise)
		useStore.setState({ selectedClass: cls('A'), currentSession: draft('A', 'same') })
		const saving = useStore.getState().saveSession()
		useStore.getState().markStudent('student-1', { status: 'present' })
		pending.resolve()
		await expect(saving).resolves.toEqual({ ok: true, value: undefined })
		expect(useStore.getState().currentSession).toMatchObject({ id: 'same', marks: { 'student-1': { status: 'present' } } })
		expect(JSON.parse(storage.getItem('checkpoint_draft_session_A')!)).toMatchObject({
			id: 'same', marks: { 'student-1': { status: 'present' } },
		})
	})
})

describe('class files', () => {
	it('exports the requested class with its saved draft', async () => {
		storage.setItem('checkpoint_draft_session_A', JSON.stringify(draft('A')))
		repo.getClassDataset.mockResolvedValue({
			...dataset(),
			settings: {
				classId: 'A',
				defaultN: 8,
				neverSeenWeight: 3,
				cooldownWeight: 0.25,
				spreadsheetId: 'private-sheet',
			},
		})

		const result = await useStore.getState().exportClassFile('A')

		expect(result.ok).toBe(true)
		if (!result.ok) return
		const file = JSON.parse(result.value.json)
		expect(result.value.filename).toMatch(/^checkpoint-class-a-\d{4}-\d{2}-\d{2}\.json$/)
		expect(file.draftSession).toMatchObject({ id: 'draft-A', classId: 'A' })
		expect(file.settings).toEqual({ defaultN: 8, neverSeenWeight: 3, cooldownWeight: 0.25 })
		expect(file.settings).not.toHaveProperty('spreadsheetId')
		expect(useStore.getState().inFlight).toBeNull()
	})

	it('imports a backup as a newly remapped and selected class', async () => {
		const oldClass = cls('A')
		let importedClass: ReturnType<typeof cls> | undefined
		repo.createClassFromDataset.mockImplementation(async (data) => {
			importedClass = data.class
			return data.class
		})
		repo.listClasses.mockImplementation(async () => [oldClass, importedClass!])
		repo.getClass.mockImplementation(async (id) => id === importedClass?.id ? importedClass : undefined)
		repo.getEffectiveSettings.mockImplementation(async (id) => ({
			classId: id, defaultN: 6, neverSeenWeight: 2, cooldownWeight: 0.5,
		}))
		useStore.setState({ classes: [oldClass], selectedClass: oldClass })
		const json = JSON.stringify({
			format: 'checkpoint-class',
			version: 1,
			exportedAt: '2026-09-02T12:00:00.000Z',
			class: { id: 'source-class', name: 'Imported class' },
			settings: { defaultN: 6, neverSeenWeight: 2, cooldownWeight: 0.5 },
			students: [{ id: 'source-student', classId: 'source-class', displayName: 'Ada' }],
			sessions: [],
			ledger: [],
			draftSession: {
				id: 'source-draft',
				classId: 'source-class',
				date: '2026-09-02T12:00:00.000Z',
				picks: ['source-student'],
				marks: {},
			},
		})

		const result = await useStore.getState().importClassFile(json)

		expect(result.ok).toBe(true)
		expect(repo.createClassFromDataset).toHaveBeenCalledOnce()
		expect(repo.replaceClassData).not.toHaveBeenCalled()
		const inserted = repo.createClassFromDataset.mock.calls[0][0]
		expect(inserted.class.id).not.toBe('source-class')
		expect(inserted.students[0].id).not.toBe('source-student')
		expect(useStore.getState().classes).toHaveLength(2)
		expect(useStore.getState().selectedClass?.id).toBe(inserted.class.id)
		expect(JSON.parse(storage.getItem(`checkpoint_draft_session_${inserted.class.id}`)!)).toMatchObject({
			classId: inserted.class.id,
			picks: [inserted.students[0].id],
		})
	})

	it('rejects invalid files before writing anything', async () => {
		await expect(useStore.getState().importClassFile('{')).resolves.toMatchObject({ ok: false })
		expect(repo.createClassFromDataset).not.toHaveBeenCalled()
		expect(useStore.getState().inFlight).toBeNull()
	})
})
