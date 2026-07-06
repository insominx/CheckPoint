import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/Dialog'

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<BrowserRouter>
			<ToastProvider>
				<ConfirmProvider>
					<App />
				</ConfirmProvider>
			</ToastProvider>
		</BrowserRouter>
	</StrictMode>,
)
