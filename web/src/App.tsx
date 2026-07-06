import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Session from './pages/Session'
import History from './pages/History'
import Settings from './pages/Settings'
import Roster from './pages/Roster'
import AppShell from './components/AppShell'
import ErrorBoundary from './ErrorBoundary'
import { useStore } from './store'

export default function App() {
	const init = useStore((s) => s.init)

	useEffect(() => {
		init()
	}, [init])

	return (
		<AppShell>
			<ErrorBoundary>
				<Routes>
					<Route path="/" element={<Home />} />
					<Route path="/session" element={<Session />} />
					<Route path="/history" element={<History />} />
					<Route path="/settings" element={<Settings />} />
					<Route path="/roster" element={<Roster />} />
				</Routes>
			</ErrorBoundary>
		</AppShell>
	)
}
