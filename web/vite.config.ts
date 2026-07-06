/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
	},
	plugins: [
		react(),
		VitePWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'CheckPoint',
				short_name: 'CheckPoint',
				description: 'Attendance spot-check app for teachers',
				theme_color: '#0b1017',
				background_color: '#0b1017',
				icons: [
					{
						src: 'logo-192.png',
						sizes: '192x192',
						type: 'image/png',
					},
					{
						src: 'logo-512.png',
						sizes: '512x512',
						type: 'image/png',
					},
				],
			},
		}),
	],
})
