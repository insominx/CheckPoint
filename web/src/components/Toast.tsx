import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
	id: number
	kind: ToastKind
	message: string
}

interface ToastApi {
	success: (message: string) => void
	error: (message: string) => void
	info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
	const ctx = useContext(ToastContext)
	if (!ctx) throw new Error('useToast must be used within ToastProvider')
	return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<ToastItem[]>([])
	const nextId = useRef(1)

	const push = useCallback((kind: ToastKind, message: string) => {
		const id = nextId.current++
		setToasts((prev) => [...prev, { id, kind, message }])
		const ttl = kind === 'error' ? 7000 : 4000
		setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ttl)
	}, [])

	const api: ToastApi = {
		success: (m) => push('success', m),
		error: (m) => push('error', m),
		info: (m) => push('info', m),
	}

	return (
		<ToastContext.Provider value={api}>
			{children}
			<div className="toast-stack">
				{toasts.map((t) => (
					<div key={t.id} className={`toast ${t.kind}`} role="status">
						<span className="dot" />
						<span>{t.message}</span>
					</div>
				))}
			</div>
		</ToastContext.Provider>
	)
}
