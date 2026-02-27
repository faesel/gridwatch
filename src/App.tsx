import { useState, useEffect, Component } from 'react'
import type { ReactNode } from 'react'
import type { SessionData } from './types/session'
import styles from './App.module.css'
import logoWordmark from './assets/logo-wordmark.svg'
import SessionsPage from './pages/SessionsPage'
import TokensPage from './pages/TokensPage'
import ActivityPage from './pages/ActivityPage'
import SettingsPage, { loadSettings, applySettings } from './pages/SettingsPage'
import type { AppSettings } from './pages/SettingsPage'

// Error boundary to catch render errors in page components
interface EBState { error: Error | null }
class PageErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null }
  static getDerivedStateFromError(error: Error): EBState { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: '#ff6600', fontFamily: 'inherit' }}>
          <div style={{ fontSize: 14, letterSpacing: 2, marginBottom: 12 }}>RENDER ERROR</div>
          <pre style={{ fontSize: 11, color: '#c0e8ff', whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

interface NavItem {
  id: string
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'sessions', label: 'SESSIONS', icon: '◈' },
  { id: 'tokens', label: 'TOKENS', icon: '◬' },
  { id: 'activity', label: 'ACTIVITY', icon: '◫' },
  { id: 'settings', label: 'SETTINGS', icon: '⚙' },
]

function App() {
  const [activePage, setActivePage] = useState('sessions')
  const [sessions, setSessions] = useState<SessionData[]>([])
  const [loading, setLoading] = useState(true)
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    const s = loadSettings()
    applySettings(s)
    return s
  })

  const load = () => {
    window.gridwatchAPI.getSessions().then((data) => {
      setSessions(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [])

  const renderPage = () => {
    if (loading) {
      return <div className={styles.loading}>LOADING SESSIONS…</div>
    }
    switch (activePage) {
      case 'sessions': return <SessionsPage sessions={sessions} onSessionRenamed={load} />
      case 'tokens': return <TokensPage sessions={sessions} />
      case 'activity': return <ActivityPage sessions={sessions} />
      case 'settings': return <SettingsPage settings={appSettings} onChange={setAppSettings} />
      default: return null
    }
  }

  return (
    <div className={styles.app}>
      <div className={styles.titlebar}>
        <img src={logoWordmark} alt="GridWatch" />
      </div>
      <div className={styles.body}>
        <nav className={styles.sidebar}>
          <div className={styles.sidebarTop}>
            {NAV_ITEMS.filter((i) => i.id !== 'settings').map((item) => (
              <div
                key={item.id}
                className={`${styles.navItem} ${activePage === item.id ? styles.navItemActive : ''}`}
                onClick={() => setActivePage(item.id)}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                {item.label}
              </div>
            ))}
          </div>
          <div className={styles.sidebarBottom}>
            <div className={styles.sidebarFooter}>v0.5.2 — GRIDWATCH</div>
            <div
              className={`${styles.navItem} ${activePage === 'settings' ? styles.navItemActive : ''}`}
              onClick={() => setActivePage('settings')}
            >
              <span className={styles.navIcon}>⚙</span>
              SETTINGS
            </div>
          </div>
        </nav>
        <main className={styles.content}>
          <PageErrorBoundary key={activePage}>
            {renderPage()}
          </PageErrorBoundary>
        </main>
      </div>
    </div>
  )
}

export default App
