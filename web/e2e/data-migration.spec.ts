import { expect, test } from '@playwright/test'

test('v2 defaultN values migrate to settings and new classes get atomic settings', async ({ page }) => {
	await page.goto('/logo-64.png')
	await page.evaluate(async () => {
		await new Promise<void>((resolve, reject) => {
			// Dexie maps declared version 2 to native IndexedDB version 20.
			const request = indexedDB.open('CheckPointDB', 20)
			request.onupgradeneeded = () => {
				const db = request.result
				db.createObjectStore('classes', { keyPath: 'id' }).createIndex('name', 'name')
				db.createObjectStore('students', { keyPath: 'id' }).createIndex('classId', 'classId')
				db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('classId', 'classId')
				db.createObjectStore('ledger', { keyPath: 'id' }).createIndex('classId', 'classId')
				db.createObjectStore('settings', { keyPath: 'classId' })
			}
			request.onerror = () => reject(request.error)
			request.onsuccess = () => {
				const db = request.result
				const transaction = db.transaction(['classes', 'settings'], 'readwrite')
				transaction.objectStore('classes').put({ id: 'legacy-only', name: 'Legacy Only', defaultN: 7 })
				transaction.objectStore('classes').put({ id: 'settings-wins', name: 'Settings Wins', defaultN: 3 })
				transaction.objectStore('settings').put({
					classId: 'settings-wins', defaultN: 9, neverSeenWeight: 4, cooldownWeight: 0.25,
					spreadsheetId: 'linked-sheet', lastExportedAt: '2026-08-20T00:00:00Z',
				})
				transaction.oncomplete = () => { db.close(); resolve() }
				transaction.onerror = () => reject(transaction.error)
			}
		})
	})
	const seeded = await page.evaluate(async () => {
		const request = indexedDB.open('CheckPointDB')
		const db = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result) })
		const get = db.transaction('settings').objectStore('settings').get('settings-wins')
		const value = await new Promise<unknown>((resolve) => { get.onsuccess = () => resolve(get.result) })
		db.close()
		return value
	})
	expect(seeded).toEqual(expect.objectContaining({ defaultN: 9, neverSeenWeight: 4, cooldownWeight: 0.25 }))

	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

	const migrated = await page.evaluate(async () => {
		const request = indexedDB.open('CheckPointDB')
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(request.error)
		})
		const transaction = db.transaction(['classes', 'settings'])
		const classesRequest = transaction.objectStore('classes').getAll()
		const settingsRequest = transaction.objectStore('settings').getAll()
		const values = await Promise.all([
			new Promise<unknown[]>((resolve) => { classesRequest.onsuccess = () => resolve(classesRequest.result) }),
			new Promise<unknown[]>((resolve) => { settingsRequest.onsuccess = () => resolve(settingsRequest.result) }),
		])
		db.close()
		return { classes: values[0], settings: values[1] }
	})

	expect(migrated.classes).toEqual(expect.arrayContaining([
		{ id: 'legacy-only', name: 'Legacy Only' },
		{ id: 'settings-wins', name: 'Settings Wins' },
	]))
	expect(migrated.settings).toEqual(expect.arrayContaining([
		expect.objectContaining({ classId: 'legacy-only', defaultN: 7, neverSeenWeight: 2, cooldownWeight: 0.5 }),
		expect.objectContaining({ classId: 'settings-wins', defaultN: 9, neverSeenWeight: 4, cooldownWeight: 0.25, spreadsheetId: 'linked-sheet' }),
	]))

	await page.getByPlaceholder(/New class name/).fill('Atomic Class')
	await page.getByRole('button', { name: 'Create class' }).click()
	const created = await page.evaluate(async () => {
		const request = indexedDB.open('CheckPointDB')
		const db = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result) })
		const tx = db.transaction(['classes', 'settings'])
		const classesRequest = tx.objectStore('classes').getAll()
		const classes = await new Promise<Array<{ id: string; name: string }>>((resolve) => { classesRequest.onsuccess = () => resolve(classesRequest.result) })
		const atomic = classes.find((value) => value.name === 'Atomic Class')
		const settings = await new Promise<unknown>((resolve) => {
			const get = tx.objectStore('settings').get(atomic!.id)
			get.onsuccess = () => resolve(get.result)
		})
		db.close()
		return { atomic, settings }
	})
	expect(created.atomic).toEqual(expect.objectContaining({ name: 'Atomic Class' }))
	expect(created.settings).toEqual(expect.objectContaining({ defaultN: 5, neverSeenWeight: 2, cooldownWeight: 0.5 }))
})

test('concurrent partial settings updates retain both values', async ({ page }) => {
	await page.goto('/logo-64.png')
	const settings = await page.evaluate(async () => {
		const repository = await import('/src/data/repository.ts')
		const cls = await repository.createClass('Concurrent settings')
		await Promise.all([
			repository.updateSettings(cls.id, { defaultN: 7 }),
			repository.updateSettings(cls.id, { cooldownWeight: 0.25 }),
		])
		return repository.getSettings(cls.id)
	})

	expect(settings).toEqual(expect.objectContaining({ defaultN: 7, cooldownWeight: 0.25 }))
})
