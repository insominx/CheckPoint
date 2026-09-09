import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name)

async function createClassWithRoster(page: Page, name: string) {
	await page.goto('/')
	await page.getByPlaceholder(/New class name/).fill(name)
	await page.getByRole('button', { name: 'Create class' }).click()
	await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible()
	await page.locator('input[type="file"]').setInputFiles(fixture('roster.csv'))
	await expect(page.locator('table.table tbody tr')).toHaveCount(6)
}

test('removing a dropped student erases them from the roster and history', async ({ page }) => {
	await createClassWithRoster(page, 'Drop Student Class')

	await page.getByRole('link', { name: 'Session' }).click()
	const cards = page.locator('.student-card')
	await expect(cards).toHaveCount(5)

	const absentName = (await cards.first().locator('.name span').first().textContent())!.trim()
	await cards.first().getByRole('button', { name: 'Absent' }).click()
	const count = await cards.count()
	for (let i = 1; i < count; i++) {
		await cards.nth(i).getByRole('button', { name: 'Present' }).click()
	}
	await page.getByRole('button', { name: 'Save session' }).click()
	await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
	await expect(page.locator('.stat', { hasText: 'Waiting for recheck' }).locator('.value')).toHaveText('1')

	await page.getByRole('link', { name: 'Roster' }).click()
	const row = page.locator('table.table tbody tr', { hasText: absentName })
	await row.getByRole('button', { name: 'Remove' }).click()
	await expect(page.getByRole('dialog')).toContainText('erases their past attendance')
	await expect(page.getByRole('dialog')).toContainText('later CSV import')
	await page.getByRole('button', { name: 'Remove student' }).click()
	await expect(page.getByText(`Removed ${absentName}.`)).toBeVisible()
	await expect(page.locator('table.table tbody tr')).toHaveCount(5)
	await expect(page.locator('table.table tbody')).not.toContainText(absentName)

	await page.getByRole('link', { name: 'Overview' }).click()
	await expect(page.locator('.stat', { hasText: 'Students' }).locator('.value')).toHaveText('5')
	await expect(page.locator('.stat', { hasText: 'Waiting for recheck' }).locator('.value')).toHaveText('0')
	await expect(page.locator('.stat', { hasText: 'Absences recorded' }).locator('.value')).toHaveText('0')

	await page.getByRole('link', { name: 'History' }).click()
	await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
	await expect(page.locator('table.table tbody')).not.toContainText(absentName)
	await page.locator('table.table tbody tr.clickable').first().click()
	await expect(page.locator('.expand-row')).toBeVisible()
	await expect(page.locator('.expand-row')).not.toContainText(absentName)

	await page.getByRole('button', { name: 'Export absences CSV' }).click()
	await expect(page.getByText('No absences recorded yet — nothing to export.')).toBeVisible()

	await page.getByRole('link', { name: 'Session' }).click()
	await expect(page.locator('.student-card')).toHaveCount(5)
	await expect(page.locator('.cards')).not.toContainText(absentName)

	await page.getByRole('link', { name: 'Roster' }).click()
	await page.locator('input[type="file"]').setInputFiles(fixture('roster.csv'))
	await expect(page.locator('table.table tbody tr')).toHaveCount(6)
	await expect(page.getByRole('cell', { name: absentName })).toBeVisible()

	await page.getByRole('link', { name: 'Overview' }).click()
	await expect(page.locator('.stat', { hasText: 'Students' }).locator('.value')).toHaveText('6')
	await expect(page.locator('.stat', { hasText: 'Waiting for recheck' }).locator('.value')).toHaveText('0')
	await expect(page.locator('.stat', { hasText: 'Absences recorded' }).locator('.value')).toHaveText('0')
})

test('canceling remove leaves the roster unchanged', async ({ page }) => {
	await createClassWithRoster(page, 'Cancel Remove Class')
	const row = page.locator('table.table tbody tr', { hasText: 'Alice Anderson' })
	await row.getByRole('button', { name: 'Remove' }).click()
	await page.getByRole('button', { name: 'Cancel' }).click()
	await expect(page.getByRole('dialog')).toHaveCount(0)
	await expect(page.locator('table.table tbody tr')).toHaveCount(6)
	await expect(page.getByText('Alice Anderson')).toBeVisible()
})
