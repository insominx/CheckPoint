import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const expected = {
	name: 'CheckPoint',
	short_name: 'CheckPoint',
	theme_color: '#0b1017',
	background_color: '#0b1017',
	display: 'standalone',
	start_url: '/',
}

test('generated manifest is canonical and every icon is served in development', async ({ request }) => {
	const built = JSON.parse(await readFile(new URL('../dist/manifest.webmanifest', import.meta.url), 'utf8'))
	expect(built).toMatchObject(expected)
	expect(built.icons).toEqual([
		{ src: 'logo-192.png', sizes: '192x192', type: 'image/png' },
		{ src: 'logo-512.png', sizes: '512x512', type: 'image/png' },
	])

	const manifestResponse = await request.get('/manifest.webmanifest')
	expect(manifestResponse.ok()).toBeTruthy()
	const development = await manifestResponse.json()
	expect(development).toMatchObject(expected)
	for (const icon of development.icons as Array<{ src: string }>) {
		expect((await request.get(`/${icon.src.replace(/^\//, '')}`)).ok()).toBeTruthy()
	}
})
