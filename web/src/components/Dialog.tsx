import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export interface ConfirmOptions {
	title: string
	message: string
	confirmLabel?: string
	cancelLabel?: string
	danger?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/** Promise-based replacement for window.confirm, rendered as a proper modal. */
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): ConfirmFn {
	const ctx = useContext(ConfirmContext)
	if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
	return ctx
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
	const [options, setOptions] = useState<ConfirmOptions | null>(null)
	const resolver = useRef<(value: boolean) => void>(null)

	const confirm = useCallback<ConfirmFn>((opts) => {
		setOptions(opts)
		return new Promise<boolean>((resolve) => {
			resolver.current = resolve
		})
	}, [])

	const close = (value: boolean) => {
		setOptions(null)
		resolver.current?.(value)
		resolver.current = null
	}

	return (
		<ConfirmContext.Provider value={confirm}>
			{children}
			{options && (
				<div className="modal-overlay" onClick={() => close(false)}>
					<div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
						<h3>{options.title}</h3>
						<div className="modal-body">{options.message}</div>
						<div className="modal-actions">
							<button className="btn btn-ghost" onClick={() => close(false)} autoFocus>
								{options.cancelLabel ?? 'Cancel'}
							</button>
							<button
								className={`btn ${options.danger ? 'btn-danger' : 'btn-primary'}`}
								onClick={() => close(true)}
							>
								{options.confirmLabel ?? 'Confirm'}
							</button>
						</div>
					</div>
				</div>
			)}
		</ConfirmContext.Provider>
	)
}
