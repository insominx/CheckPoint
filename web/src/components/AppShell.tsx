import { NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useStore } from '../store'

const NAV_ITEMS: Array<{ to: string; label: string; needsClass: boolean; icon: ReactNode }> = [
	{
		to: '/', label: 'Overview', needsClass: false,
		icon: <Icon d="M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10" />,
	},
	{
		to: '/session', label: 'Session', needsClass: true,
		icon: <Icon d="M9 11l3 3 8-8M21 12a9 9 0 1 1-6.2-8.56" />,
	},
	{
		to: '/roster', label: 'Roster', needsClass: true,
		icon: <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
	},
	{
		to: '/history', label: 'History', needsClass: true,
		icon: <Icon d="M12 8v4l3 3M3.05 11a9 9 0 1 1 .5 4" />,
	},
	{
		to: '/settings', label: 'Settings', needsClass: true,
		icon: <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />,
	},
]

function Icon({ d }: { d: string }) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d={d} />
		</svg>
	)
}

export default function AppShell({ children }: { children: ReactNode }) {
	const { classes, selectedClass, inFlight, selectClass } = useStore()
	const navigate = useNavigate()

	return (
		<div className="app">
			<aside className="sidebar">
				<div className="sidebar-brand">
					<img src="/logo-64.png" alt="" />
					<span>CheckPoint</span>
				</div>

				<div className="sidebar-class">
					<label htmlFor="class-switcher">Class</label>
					<select
						id="class-switcher"
						className="select"
						disabled={inFlight !== null}
						value={selectedClass?.id ?? ''}
						onChange={async (e) => {
							await selectClass(e.target.value || undefined)
							if (!e.target.value) navigate('/')
						}}
					>
						<option value="">— none selected —</option>
						{classes.map((c) => (
							<option key={c.id} value={c.id}>{c.name}</option>
						))}
					</select>
				</div>

				<nav>
					{NAV_ITEMS.map((item) => (
						<NavLink
							key={item.to}
							to={item.to}
							end={item.to === '/'}
							className={({ isActive }) =>
								`nav-item ${isActive ? 'active' : ''} ${item.needsClass && !selectedClass ? 'disabled' : ''}`
							}
						>
							{item.icon}
							{item.label}
						</NavLink>
					))}
				</nav>

				<div className="sidebar-foot">
					Offline-first — data stays in this browser.
				</div>
			</aside>
			<main className="content">{children}</main>
		</div>
	)
}
