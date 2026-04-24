import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import type { LspServerData } from '../types/lsp'
import styles from './LspPage.module.css'

function LspPage({ refreshKey }: { refreshKey?: number }) {
  const [servers, setServers] = useState<LspServerData[]>([])
  const [selected, setSelected] = useState<LspServerData | null>(null)
  const [search, setSearch] = useState('')
  const [toggling, setToggling] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadServers = useCallback(async () => {
    try {
      const data = await window.gridwatchAPI.getLspServers()
      setServers(data)
    } catch { /* ignore */ }
  }, [])

  const handleToggle = useCallback(async (serverName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setToggling(serverName)
    try {
      const result = await window.gridwatchAPI.toggleLspServer(serverName)
      if (result.ok) await loadServers()
    } catch { /* ignore */ }
    setToggling(null)
  }, [loadServers])

  useEffect(() => {
    loadServers().finally(() => setLoading(false))
    const interval = setInterval(loadServers, 30_000)
    return () => clearInterval(interval)
  }, [loadServers])

  useEffect(() => { if (refreshKey) loadServers() }, [refreshKey, loadServers])

  // Keep selection in sync
  useEffect(() => {
    if (selected) {
      const updated = servers.find(s => s.name === selected.name)
      if (updated) setSelected(updated)
      else setSelected(null)
    }
  }, [servers])

  const filtered = useMemo(() => servers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.command.toLowerCase().includes(search.toLowerCase())
  ), [servers, search])

  const extensionCount = (s: LspServerData) => Object.keys(s.fileExtensions).length

  return (
    <div className={styles.container}>
      {/* List panel */}
      <div className={styles.listPanel}>
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>LSP SERVERS</span>
          <span className={styles.listCount}>{servers.length}</span>
        </div>

        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search servers…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div className={styles.noticeBanner}>
          ⚡ Copilot CLI uses these for code intelligence
        </div>

        {loading && <div className={styles.loading}>LOADING...</div>}

        {filtered.map(s => (
          <div
            key={s.name}
            className={`${styles.serverCard} ${selected?.name === s.name ? styles.serverCardActive : ''} ${!s.enabled ? styles.serverCardDisabled : ''}`}
            onClick={() => setSelected(s)}
          >
            <div className={styles.serverName}>{s.name}</div>
            <div className={styles.serverMeta}>
              {!s.enabled && <span className={styles.disabledBadge}>DISABLED</span>}
              <span className={styles.extCount}>{extensionCount(s)} extensions</span>
            </div>
          </div>
        ))}

        {filtered.length === 0 && !loading && (
          <div className={styles.emptyState}>
            {search ? 'No servers match your search' : 'No LSP servers configured'}
          </div>
        )}
      </div>

      {/* Detail panel */}
      <div className={styles.detailPanel}>
        {selected ? (
          <>
            <div className={styles.detailHeader}>
              <div className={styles.detailTitle}>{selected.name}</div>
              {!selected.enabled && <span className={styles.disabledBadge}>DISABLED</span>}
              <button
                className={styles.openFolderBtn}
                onClick={() => void window.gridwatchAPI.openItemFolder('lsp', selected.name).catch(() => {})}
                title="Open LSP config"
                aria-label="Open LSP config file location"
              >⊞</button>
            </div>

            <div className={styles.actionBar}>
              <button
                className={`${styles.toggleActionBtn} ${selected.enabled ? styles.toggleActionEnabled : styles.toggleActionDisabled}`}
                disabled={toggling === selected.name}
                onClick={(e) => handleToggle(selected.name, e)}
              >
                {selected.enabled ? '● ENABLED' : '○ DISABLED'}
              </button>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>CONNECTION</div>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>Command</span>
                <code className={styles.fieldValue}>{selected.command}</code>
              </div>
              {selected.args.length > 0 && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Arguments</span>
                  <code className={styles.fieldValue}>{selected.args.join(' ')}</code>
                </div>
              )}
            </div>

            {Object.keys(selected.fileExtensions).length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  FILE EXTENSIONS ({Object.keys(selected.fileExtensions).length})
                </div>
                {Object.entries(selected.fileExtensions).map(([ext, lang]) => (
                  <div key={ext} className={styles.fieldRow}>
                    <span className={styles.extLabel}>{ext}</span>
                    <span className={styles.extLang}>{lang}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className={styles.emptyDetail}>
            <div className={styles.emptyIcon}>⬡</div>
            <div className={styles.emptyLabel}>Select an LSP server to view its details</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(LspPage)
