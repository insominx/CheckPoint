import { Link, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Session from './pages/Session'
import History from './pages/History'
import Settings from './pages/Settings'
import Roster from './pages/Roster'

export default function App() {
	return (
		<div>
			<nav style={{ display: 'flex', gap: 12, padding: 12, borderBottom: '1px solid #eee' }}>
				<Link to="/">Home</Link>
				<Link to="/session">Session</Link>
				<Link to="/history">History</Link>
				<Link to="/settings">Settings</Link>
				<Link to="/roster">Roster</Link>
			</nav>
			<Routes>
				<Route path="/" element={<Home />} />
				<Route path="/session" element={<Session />} />
				<Route path="/history" element={<History />} />
				<Route path="/settings" element={<Settings />} />
				<Route path="/roster" element={<Roster />} />
			</Routes>
		</div>
	)
}
