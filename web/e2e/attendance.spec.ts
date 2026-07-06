import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Golden path: create class → import roster → run a check with one absence →
 * the absent student carries over → marking present clears the carryover.
 */

const SHOT_DIR = path.join(__dirname, '.screenshots')
const shot = (page: Page, name: string) =>
	page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true })

test('core attendance loop with carryover recheck', async ({ page }) => {
	await page.goto('/')

	// --- Create a class ---
	await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
	await shot(page, '01-welcome')
	await page.getByPlaceholder(/New class name/).fill('E2E Class')
	await page.getByRole('button', { name: 'Create class' }).click()

	// Creation lands on the roster page with an import prompt
	await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible()
	await expect(page.getByText('No students yet')).toBeVisible()

	// --- Import the roster CSV ---
	await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, 'fixtures', 'roster.csv'))
	await expect(page.locator('table.table tbody tr')).toHaveCount(6)
	await shot(page, '02-roster')

	// --- First session: mark one absent, rest present ---
	await page.getByRole('link', { name: 'Session' }).click()
	const cards = page.locator('.student-card')
	await expect(cards).toHaveCount(5) // default N = 5

	const absentName = (await cards.first().locator('.name span').first().textContent())!.trim()
	await cards.first().getByRole('button', { name: 'Absent' }).click()
	await expect(cards.first().getByRole('button', { name: 'Absent' })).toHaveClass(/on/)

	// Draft autosave: marks survive a reload
	await page.reload()
	await expect(page.locator('.student-card').first().getByRole('button', { name: 'Absent' })).toHaveClass(/on/)

	const cardsAfterReload = page.locator('.student-card')
	const count = await cardsAfterReload.count()
	for (let i = 1; i < count; i++) {
		await cardsAfterReload.nth(i).getByRole('button', { name: 'Present' }).click()
	}
	await shot(page, '03-session-marked')
	await page.getByRole('button', { name: 'Save session' }).click()

	// --- Back on overview: one student waiting for recheck ---
	await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
	const recheckStat = page.locator('.stat', { hasText: 'Waiting for recheck' })
	await expect(recheckStat.locator('.value')).toHaveText('1')
	await shot(page, '04-overview-after-save')

	// --- Second session: the absent student carries over with a recheck badge ---
	await page.getByRole('button', { name: 'Start attendance check' }).click()
	const carryoverCard = page.locator('.student-card.carryover')
	await expect(carryoverCard).toHaveCount(1)
	await expect(carryoverCard).toContainText(absentName)
	await expect(carryoverCard.locator('.badge')).toHaveText('recheck')
	await expect(carryoverCard).toContainText('1 recorded absence')
	await shot(page, '05-carryover')

	// Mark everyone present and save
	const secondCards = page.locator('.student-card')
	const secondCount = await secondCards.count()
	for (let i = 0; i < secondCount; i++) {
		await secondCards.nth(i).getByRole('button', { name: 'Present' }).click()
	}
	await page.getByRole('button', { name: 'Save session' }).click()

	// --- Carryover cleared ---
	await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
	await expect(recheckStat.locator('.value')).toHaveText('0')

	// --- History shows both sessions; absence is recorded ---
	await page.getByRole('link', { name: 'History' }).click()
	await expect(page.locator('table.table tbody > tr')).toHaveCount(2)
	await shot(page, '06-history')
})
