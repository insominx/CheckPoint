import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, createServer } from 'vite'

const manifest = new URL('../dist/manifest.webmanifest', import.meta.url)
try {
	await access(manifest)
} catch {
	await build()
}

const server = await createServer({
	server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
await server.listen()

const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url))
const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
	stdio: 'inherit',
	env: process.env,
})

const childResult = new Promise((resolve) => {
	child.once('error', () => resolve(1))
	child.once('exit', (code) => resolve(code ?? 1))
})

let serverClose
const closeServer = () => {
	serverClose ??= server.close()
	return serverClose
}

let stopping
const stop = (signal) => {
	if (!stopping) {
		if (child.exitCode === null && !child.killed) child.kill(signal)
		stopping = childResult.then(async (exitCode) => {
			await closeServer()
			return exitCode
		})
	}
	return stopping
}

let signalExitCode
let signalKeepAlive
const handleSignal = (signal, exitCode) => {
	signalExitCode = exitCode
	process.exitCode = exitCode
	signalKeepAlive ??= setInterval(() => {}, 1_000)
	void stop(signal).finally(() => {
		clearInterval(signalKeepAlive)
		process.exitCode = exitCode
	})
}

process.once('SIGINT', () => handleSignal('SIGINT', 130))
process.once('SIGTERM', () => handleSignal('SIGTERM', 143))

const exitCode = await childResult
await closeServer()
process.exitCode = signalExitCode ?? exitCode
