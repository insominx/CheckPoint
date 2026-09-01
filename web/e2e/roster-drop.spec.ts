import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name)

async function dropFile(target: Locator, filePath: string, mime = 'text/csv') {
	const name = path.basename(filePath)
	const content = await readFile(filePath, 'utf8')
	await target.evaluate(
		(el, payload) => {
			const dt = new DataTransfer()
			dt.items.add(new File([payload.content], payload.name, { type: payload.mime }))
			el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
			el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
			el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
		},
		{ name, content, mime },
	)
}

async function createEmptyClass(page: Page, name: string) {
	await page.goto('/')
	await page.getByPlaceholder(/New class name/).fill(name)
	await page.getByRole('button', { name: 'Create class' }).click()
	await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible()
	await expect(page.getByText('No students yet')).toBeVisible()
}

test('dropping a CSV on the empty roster imports students', async ({ page }) => {
	await createEmptyClass(page, 'Drop Class')
	const zone = page.locator('.empty.roster-drop')
	await zone.evaluate((el) => {
		const dt = new DataTransfer()
		dt.items.add(new File(['x'], 'roster.csv', { type: 'text/csv' }))
		el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
	})
	await expect(page.getByText('Drop to import')).toBeVisible()
	await dropFile(zone, fixture('roster.csv'))
	await expect(page.locator('table.table tbody tr')).toHaveCount(6)
})

test('dropping a CSV on an existing roster still imports', async ({ page }) => {
	await createEmptyClass(page, 'Update Drop Class')
	await dropFile(page.locator('.empty.roster-drop'), fixture('roster.csv'))
	await expect(page.locator('table.table tbody tr')).toHaveCount(6)
	await dropFile(page.locator('.table-wrap.roster-drop'), fixture('roster.csv'))
	await expect(page.getByText('Imported 6 students.').last()).toBeVisible()
	await expect(page.locator('table.table tbody tr')).toHaveCount(6)
})

test('dropping a non-CSV on the empty roster is rejected', async ({ page }) => {
	await createEmptyClass(page, 'Reject Drop Class')
	await page.locator('.empty.roster-drop').evaluate((el) => {
		const dt = new DataTransfer()
		dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
		el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
	})
	await expect(page.getByText('Please drop a CSV file.')).toBeVisible()
	await expect(page.getByText('No students yet')).toBeVisible()
})
