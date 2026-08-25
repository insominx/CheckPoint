import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const fixture = (name: string) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name)

async function createClassWithRoster(page: import('@playwright/test').Page, name: string, roster: string) {
	await page.goto('/')
	await page.getByPlaceholder(/New class name/).fill(name)
	await page.getByRole('button', { name: 'Create class' }).click()
	await page.locator('input[type="file"]').setInputFiles(fixture(roster))
	await expect(page.locator('table.table tbody tr')).toHaveCount(roster === 'roster-b.csv' ? 5 : 6)
}

test('mounted Session follows class scope and restores the new class draft', async ({ page }) => {
	await createClassWithRoster(page, 'Class A', 'roster.csv')
	await createClassWithRoster(page, 'Class B', 'roster-b.csv')

	await page.locator('#class-switcher').selectOption({ label: 'Class A' })
	await page.getByRole('link', { name: 'Session' }).click()
	await expect(page.locator('.student-card')).toHaveCount(5)
	await expect(page.getByText('Beryl Baker')).toHaveCount(0)

	await page.locator('#class-switcher').selectOption({ label: 'Class B' })
	await expect(page.getByText('Beryl Baker')).toBeVisible()
	await expect(page.getByText('Drawing students…')).toHaveCount(0)
	await expect(page.locator('.student-card')).toHaveCount(5)

	await page.reload()
	await expect(page.locator('#class-switcher')).toHaveValue(/.+/)
	await expect(page.getByText('Beryl Baker')).toBeVisible()
	await expect(page.getByText('Drawing students…')).toHaveCount(0)
})
