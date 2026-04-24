import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import type { AllowedDirectory } from '../types/dirs'
import styles from './DirsPage.module.css'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function DirsPage({ refreshKey }: { refreshKey?: number }) {
  const [dirs, setDirs] = useState<AllowedDirectory[]>([])
  const [selected, setSelected] = useState<AllowedDirectory | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadDirs = useCallback(async () => {
    try {
      const data = await window.gridwatchAPI.getAllowedDirs()
      setDirs(data)
    } catch { /* ignore */ }
  }, [])

  const handleAdd = useCallback(async () => {
    setAdding(true)
    setError(null)
    try {
      const result = await window.gridwatchAPI.addAllowedDir()
      if (result.ok && result.directory) {
        await loadDirs()
        setSelected(result.directory)
      } else if (result.error && result.error !== 'Cancelled') {
        setError(result.error)
      }
    } catch { /* ignore */ }
    setAdding(false)
  }, [loadDirs])

  const handleRemove = useCallback(async (dirPath: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setRemoving(dirPath)
    setError(null)
    try {
      const result = await window.gridwatchAPI.removeAllowedDir(dirPath)
      if (result.ok) {
        await loadDirs()
        setSelected((prev) => (prev?.path === dirPath ? null : prev))
      } else if (result.error) {
        setError(result.error)
      }
    } catch { /* ignore */ }
    setRemoving(null)
  }, [loadDirs])

  useEffect(() => {
    loadDirs().finally(() => setLoading(false))
    const interval = setInterval(loadDirs, 30_000)
    return () => clearInterval(interval)
  }, [loadDirs])

  useEffect(() => { if (refreshKey) loadDirs() }, [refreshKey, loadDirs])

  // Keep selection in sync after reload
  useEffect(() => {
    if (selected) {
      const updated = dirs.find((d) => d.path === selected.path)
      if (updated) setSelected(updated)
      else setSelected(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirs])

  const filtered = useMemo(() =>
    dirs.filter((d) => d.path.toLowerCase().includes(search.toLowerCase())),
    [dirs, search],
  )

  return (
    <div className={styles.container}>
      {/* List panel */}
      <div className={styles.listPanel}>
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>ALLOWED DIRECTORIES</span>
          <span className={styles.listCount}>{dirs.length}</span>
          <button
            className={styles.addBtn}
            onClick={handleAdd}
            disabled={adding}
            title="Add directory"
          >
            {adding ? '…' : '+ ADD'}
          </button>
        </div>

        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search directories…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {error && (
          <div className={styles.errorBanner}>
            {error}
            <button
              className={styles.errorDismiss}
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >×</button>
          </div>
        )}

        <div className={styles.noticeBanner}>
          ⊟ Directories accessible to the Copilot agent during sessions
        </div>

        {loading && <div className={styles.loading}>LOADING...</div>}

        {filtered.map((d) => (
          <div
            key={d.path}
            className={`${styles.dirCard} ${selected?.path === d.path ? styles.dirCardActive : ''} ${!d.exists ? styles.dirCardMissing : ''}`}
            onClick={() => setSelected(d)}
          >
            <div className={styles.dirName}>{d.path}</div>
            <div className={styles.dirMeta}>
              {d.exists
                ? <span className={styles.existsBadge}>EXISTS</span>
                : <span className={styles.missingBadge}>NOT FOUND</span>
              }
              <span className={styles.dirDate}>{formatDate(d.addedAt)}</span>
            </div>
          </div>
        ))}

        {filtered.length === 0 && !loading && (
          <div className={styles.emptyState}>
            {search ? 'No directories match your search' : 'No allowed directories configured'}
          </div>
        )}
      </div>

      {/* Detail panel */}
      <div className={styles.detailPanel}>
        {selected ? (
          <>
            <div className={styles.detailHeader}>
              <div className={styles.detailTitle}>{selected.path}</div>
              {!selected.exists && <span className={styles.missingBadge}>NOT FOUND</span>}
              <button
                className={styles.openFolderBtn}
                onClick={() => void window.gridwatchAPI.openItemFolder('dirs', 'gridwatch-allowed-dirs.json').catch(() => {})}
                title="Show allowed-dirs config file"
                aria-label="Show allowed-dirs config file in folder"
              >⊞</button>
            </div>

            <div className={styles.actionBar}>
              <button
                className={styles.removeBtn}
                disabled={removing === selected.path}
                onClick={(e) => handleRemove(selected.path, e)}
              >
                {removing === selected.path ? '…' : '✕ REMOVE'}
              </button>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>DETAILS</div>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>Path</span>
                <code className={styles.fieldValue}>{selected.path}</code>
              </div>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>Status</span>
                <span className={styles.fieldValue}>
                  {selected.exists ? '✓ Directory exists' : '✗ Directory not found on disk'}
                </span>
              </div>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>Added</span>
                <span className={styles.fieldValue}>{formatDate(selected.addedAt)}</span>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.emptyDetail}>
            <div className={styles.emptyIcon}>⊟</div>
            <div className={styles.emptyLabel}>Select a directory to view its details</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(DirsPage)
