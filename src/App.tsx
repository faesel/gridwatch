import { useState, useEffect, Component } from 'react'
import type { ReactNode } from 'react'
import type { SessionSummary } from './types/session'
import styles from './App.module.css'
import logoWordmark from './assets/logo-wordmark.svg'
import logoWordmarkPrograms from './assets/logo-wordmark-programs.svg'
import SessionsPage from './pages/SessionsPage'
import TokensPage from './pages/TokensPage'
import ActivityPage from './pages/ActivityPage'
import SettingsPage, { loadSettings, applySettings } from './pages/SettingsPage'
import InsightsPage from './pages/InsightsPage'
import TransferPage from './pages/TransferPage'
import SkillsPage from './pages/SkillsPage'
import McpPage from './pages/McpPage'
import LspPage from './pages/LspPage'
import AgentsPage from './pages/AgentsPage'
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
  { id: 'skills', label: 'SKILLS', icon: '✦' },
  { id: 'mcp', label: 'MCP', icon: '⧈' },
  { id: 'lsp', label: 'LSP', icon: '⬡' },
  { id: 'agents', label: 'AGENTS', icon: '◎' },
  { id: 'insights', label: 'INSIGHTS', icon: '⚡' },
  { id: 'transfer', label: 'TRANSFER', icon: '⇄' },
  { id: 'settings', label: 'SETTINGS', icon: '⚙' },
]

function App() {
  const [activePage, setActivePage] = useState('sessions')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [update, setUpdate] = useState<{ latestVersion: string; downloadUrl: string } | null>(null)
  const [platform, setPlatform] = useState<string>('darwin')
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    const s = loadSettings()
    applySettings(s)
    return s
  })

  const [refreshKey, setRefreshKey] = useState(0)

  const load = () => {
    setRefreshKey((k) => k + 1)
    window.gridwatchAPI.getSessionSummaries().then((data) => {
      setSessions(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    window.gridwatchAPI.getPlatform().then(setPlatform).catch(() => {})
  }, [])

  // Check for updates on startup
  useEffect(() => {
    window.gridwatchAPI.checkForUpdate().then((result) => {
      if (result.hasUpdate && result.latestVersion && result.downloadUrl) {
        setUpdate({ latestVersion: result.latestVersion, downloadUrl: result.downloadUrl })
      }
    }).catch(() => {})
  }, [])

  const renderPage = () => {
    if (loading) {
      return <div className={styles.loading}>LOADING SESSIONS…</div>
    }
    switch (activePage) {
      case 'sessions': return <SessionsPage sessions={sessions} onSessionRenamed={load} />
      case 'tokens': return <TokensPage sessions={sessions} />
      case 'activity': return <ActivityPage sessions={sessions} />
      case 'skills': return <SkillsPage refreshKey={refreshKey} />
      case 'mcp': return <McpPage refreshKey={refreshKey} />
      case 'lsp': return <LspPage refreshKey={refreshKey} />
      case 'agents': return <AgentsPage sessions={sessions} refreshKey={refreshKey} />
      case 'insights': return <InsightsPage sessions={sessions} />
      case 'transfer': return <TransferPage sessions={sessions} />
      case 'settings': return <SettingsPage settings={appSettings} onChange={setAppSettings} />
      default: return null
    }
  }

  return (
    <div className={styles.app}>
      <div className={`${styles.titlebar} ${platform !== 'darwin' ? styles.titlebarWindows : ''}`}>
        <img src={appSettings.theme === 'programs' ? logoWordmarkPrograms : logoWordmark} alt="GridWatch" />
        {platform !== 'darwin' && (
          <div className={styles.windowControls}>
            <button className={styles.windowControlBtn} onClick={() => window.gridwatchAPI.windowMinimize()} title="Minimise">
              <svg width="10" height="1" viewBox="0 0 10 1"><rect fill="currentColor" width="10" height="1" /></svg>
            </button>
            <button className={styles.windowControlBtn} onClick={() => window.gridwatchAPI.windowMaximize()} title="Maximise">
              <svg width="10" height="10" viewBox="0 0 10 10"><rect fill="none" stroke="currentColor" strokeWidth="1" x="0.5" y="0.5" width="9" height="9" /></svg>
            </button>
            <button className={`${styles.windowControlBtn} ${styles.windowControlBtnClose}`} onClick={() => window.gridwatchAPI.windowClose()} title="Close">
              <svg width="10" height="10" viewBox="0 0 10 10"><path fill="currentColor" d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4z" /></svg>
            </button>
          </div>
        )}
      </div>
      {update && (
        <div className={styles.updateBanner}>
          <span>⬆ GridWatch v{update.latestVersion} is available</span>
          <button
            className={styles.updateBtn}
            onClick={() => window.gridwatchAPI.openExternal(update.downloadUrl)}
          >DOWNLOAD</button>
          <button
            className={styles.updateDismiss}
            onClick={() => setUpdate(null)}
          >×</button>
        </div>
      )}
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
            <div className={styles.sidebarFooter}>
              <span>v{__APP_VERSION__} — GRIDWATCH</span>
              <button className={styles.refreshBtn} onClick={load} title="Refresh sessions">↻</button>
            </div>
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
