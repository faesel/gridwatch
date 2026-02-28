import { useState, useEffect, useRef } from 'react'
import type { SessionData } from '../types/session'
import styles from './SessionsPage.module.css'

const PAGE_SIZE = 20

interface Props {
  sessions: SessionData[]
  onSessionRenamed: () => void
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay} days ago`
  const diffMo = Math.floor(diffDay / 30)
  return `${diffMo}mo ago`
}

function formatDuration(start: string, end: string): string {
  const diffMs = new Date(end).getTime() - new Date(start).getTime()
  if (diffMs < 0) return '—'
  const totalMin = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours === 0) return `${mins}m`
  return `${hours}h ${mins}m`
}

function getSessionStatus(session: SessionData): 'active' | 'today' | 'older' {
  const now = Date.now()
  const updated = new Date(session.updatedAt).getTime()
  const diffHr = (now - updated) / 3600000
  if (diffHr < 2) return 'active'
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  if (updated >= todayStart.getTime()) return 'today'
  return 'older'
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
}

function basename(p: string): string {
  return p ? p.split('/').pop() || p : ''
}

export default function SessionsPage({ sessions, onSessionRenamed }: Props) {
  const [selectedSession, setSelectedSession] = useState<SessionData | null>(null)
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [showTagFilter, setShowTagFilter] = useState(false)
  const [page, setPage] = useState(0)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [localTags, setLocalTags] = useState<string[]>([])
  const [localNotes, setLocalNotes] = useState('')
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [transfers, setTransfers] = useState<{ name: string; date: string; size: number }[]>([])
  const [expandedTransfer, setExpandedTransfer] = useState<string | null>(null)
  const [transferContent, setTransferContent] = useState<string | null>(null)
  const [copiedResume, setCopiedResume] = useState(false)

  // Sync localTags, localNotes, and transfers when selected session changes
  useEffect(() => {
    setLocalTags(selectedSession?.tags ?? [])
    setLocalNotes(selectedSession?.notes ?? '')
    setTagInput('')
    setTransfers([])
    setExpandedTransfer(null)
    setTransferContent(null)
    if (selectedSession) {
      window.gridwatchAPI.listTransfers(selectedSession.id).then(setTransfers)
    }
  }, [selectedSession?.id])

  // Keep selectedSession in sync when sessions prop updates (e.g. after rename)
  useEffect(() => {
    if (selectedSession) {
      const updated = sessions.find(s => s.id === selectedSession.id)
      if (updated && updated !== selectedSession) setSelectedSession(updated)
    }
  }, [sessions])

  const startRename = () => {
    setRenameValue(selectedSession?.summary || '')
    setIsRenaming(true)
  }

  const confirmRename = async () => {
    if (!selectedSession || !renameValue.trim()) return
    await window.gridwatchAPI.renameSession(selectedSession.id, renameValue.trim())
    setIsRenaming(false)
    onSessionRenamed()
  }

  const cancelRename = () => {
    setIsRenaming(false)
    setRenameValue('')
  }

  const addTag = async (tag: string) => {
    const trimmed = tag.trim().toLowerCase().replace(/\s+/g, '-')
    if (!trimmed || !selectedSession || localTags.includes(trimmed)) return
    const next = [...localTags, trimmed]
    setLocalTags(next)
    await window.gridwatchAPI.setTags(selectedSession.id, next)
    onSessionRenamed()
  }

  const removeTag = async (tag: string) => {
    if (!selectedSession) return
    const next = localTags.filter((t) => t !== tag)
    setLocalTags(next)
    await window.gridwatchAPI.setTags(selectedSession.id, next)
    onSessionRenamed()
  }

  const handleNotesChange = (value: string) => {
    setLocalNotes(value)
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)
    notesTimerRef.current = setTimeout(async () => {
      if (!selectedSession) return
      await window.gridwatchAPI.setNotes(selectedSession.id, value)
    }, 500)
  }

  const toggleTransfer = async (name: string) => {
    if (expandedTransfer === name) {
      setExpandedTransfer(null)
      setTransferContent(null)
      return
    }
    if (!selectedSession) return
    const content = await window.gridwatchAPI.readTransfer(selectedSession.id, name)
    setExpandedTransfer(name)
    setTransferContent(content)
  }

  const deleteTransfer = async (name: string) => {
    if (!selectedSession) return
    const ok = await window.gridwatchAPI.deleteTransfer(selectedSession.id, name)
    if (ok) {
      setTransfers((prev) => prev.filter((t) => t.name !== name))
      if (expandedTransfer === name) {
        setExpandedTransfer(null)
        setTransferContent(null)
      }
    }
  }

  const handleArchive = async () => {
    if (!selectedSession) return
    const result = await window.gridwatchAPI.archiveSession(selectedSession.id)
    if (result.ok) {
      setSelectedSession(null)
      setConfirm(null)
      onSessionRenamed()
    } else {
      setActionError(result.error || 'Archive failed')
      setConfirm(null)
    }
  }

  const handleDelete = async () => {
    if (!selectedSession) return
    const result = await window.gridwatchAPI.deleteSession(selectedSession.id)
    if (result.ok) {
      setSelectedSession(null)
      setConfirm(null)
      onSessionRenamed()
    } else {
      setActionError(result.error || 'Delete failed')
      setConfirm(null)
    }
  }

  // Collect all unique tags across sessions
  const allTags = Array.from(
    new Set(sessions.flatMap((s) => s.tags ?? []))
  ).sort()

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const clearTagFilter = () => setSelectedTags(new Set())

  const filtered = sessions.filter((s) => {
    // Tag filter: session must have ALL selected tags
    if (selectedTags.size > 0) {
      const sessionTags = s.tags ?? []
      for (const tag of selectedTags) {
        if (!sessionTags.includes(tag)) return false
      }
    }
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (s.summary || '').toLowerCase().includes(q) ||
      (s.repository || '').toLowerCase().includes(q) ||
      (s.cwd || '').toLowerCase().includes(q) ||
      (s.branch || '').toLowerCase().includes(q) ||
      (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
    )
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Reset to first page when search or tag filter changes
  useEffect(() => { setPage(0) }, [search, selectedTags])

  const totalCount = sessions.length
  const todayCount = sessions.filter((s) => isToday(s.createdAt)).length
  const uniqueRepos = new Set(sessions.map((s) => s.repository || s.cwd)).size

  const statusBadgeClass = (status: 'active' | 'today' | 'older') => {
    if (status === 'active') return styles.badgeActive
    if (status === 'today') return styles.badgeToday
    return styles.badgeOlder
  }

  const statusLabel = (status: 'active' | 'today' | 'older') => {
    if (status === 'active') return 'ACTIVE'
    if (status === 'today') return 'TODAY'
    return 'OLDER'
  }

  return (
    <div className={styles.page}>
      {/* Session list */}
      <div className={`${styles.listColumn} ${!selectedSession ? styles.listColumnFull : ''}`}>
        <div className={styles.searchWrap}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="SEARCH SESSIONS…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {allTags.length > 0 && (
            <button
              className={`${styles.tagFilterToggle} ${selectedTags.size > 0 ? styles.tagFilterActive : ''}`}
              onClick={() => setShowTagFilter((v) => !v)}
              aria-expanded={showTagFilter}
              aria-label="Filter by tags"
            >
              ⊞ TAGS{selectedTags.size > 0 ? ` (${selectedTags.size})` : ''}
            </button>
          )}
        </div>
        {showTagFilter && allTags.length > 0 && (
          <div className={styles.tagFilterPanel}>
            {allTags.map((tag) => (
              <button
                key={tag}
                className={`${styles.tagFilterChip} ${selectedTags.has(tag) ? styles.tagFilterChipSelected : ''}`}
                onClick={() => toggleTag(tag)}
                aria-pressed={selectedTags.has(tag)}
              >
                {selectedTags.has(tag) ? '☑ ' : '☐ '}{tag}
              </button>
            ))}
            {selectedTags.size > 0 && (
              <button className={styles.tagFilterClear} onClick={clearTagFilter}>
                CLEAR
              </button>
            )}
          </div>
        )}
        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <div className={styles.statValue}>{totalCount}</div>
            <div className={styles.statLabel}>TOTAL</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{todayCount}</div>
            <div className={styles.statLabel}>TODAY</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{uniqueRepos}</div>
            <div className={styles.statLabel}>REPOS</div>
          </div>
        </div>
        <div className={styles.cardList}>
          {paginated.length === 0 && (
            <div className={styles.empty}>NO SESSIONS FOUND</div>
          )}
          {paginated.map((session) => {
            const status = getSessionStatus(session)
            const isActive = selectedSession?.id === session.id
            return (
              <div
                key={session.id}
                className={`${styles.card} ${isActive ? styles.cardActive : ''}`}
                onClick={() => setSelectedSession(isActive ? null : session)}
              >
                <div className={styles.cardRow1}>
                  <div className={styles.cardSummary}>
                    {session.summary || session.lastUserMessage || 'UNTITLED SESSION'}
                  </div>
                  <span className={`${styles.badge} ${statusBadgeClass(status)}`}>
                    {statusLabel(status)}
                  </span>
                </div>
                <div className={styles.cardRow2}>
                  {session.repository || basename(session.cwd)}
                  {session.branch && (
                    <> · <span className={styles.cardBranch}>{session.branch}</span></>
                  )}
                </div>
                <div className={styles.cardRow3}>
                  <span>{formatRelativeTime(session.updatedAt)}</span>
                  <span>{session.turnCount} turns</span>
                  {session.peakUtilisation > 0 && (
                    <span className={styles.cardUtil}>
                      {session.peakUtilisation.toFixed(1)}% ctx
                    </span>
                  )}
                </div>
                {(session.tags ?? []).length > 0 && (
                  <div className={styles.cardTags}>
                    {session.tags.map((t) => (
                      <span key={t} className={styles.tagChip}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {totalPages > 1 && (
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >‹ PREV</button>
            <span className={styles.pageInfo}>
              {page + 1} / {totalPages}
            </span>
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >NEXT ›</button>
          </div>
        )}
      </div>

      {/* Session detail */}
      {selectedSession && (
        <div className={styles.detailColumn}>
          <div className={styles.detailHeader}>
            {isRenaming ? (
              <div className={styles.renameRow}>
                <input
                  className={styles.renameInput}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmRename()
                    if (e.key === 'Escape') cancelRename()
                  }}
                  autoFocus
                />
                <button className={styles.renameConfirm} onClick={confirmRename}>✓</button>
                <button className={styles.renameCancel} onClick={cancelRename}>✕</button>
              </div>
            ) : (
              <>
                <div className={styles.detailSummary}>
                  {selectedSession.summary || 'SESSION DETAIL'}
                </div>
                <div className={styles.detailActions}>
                  <button className={styles.renameBtn} onClick={startRename} title="Rename session">✎</button>
                  <button className={styles.archiveBtn} onClick={() => { setConfirm('archive'); setActionError(null) }} title="Archive session">⊟</button>
                  <button className={styles.deleteBtn} onClick={() => { setConfirm('delete'); setActionError(null) }} title="Delete session">⊗</button>
                  <button className={styles.closeBtn} onClick={() => setSelectedSession(null)}>×</button>
                </div>
              </>
            )}
          </div>

          {/* Error banner */}
          {actionError && (
            <div className={styles.errorBanner}>
              ⚠ {actionError}
              <button className={styles.errorDismiss} onClick={() => setActionError(null)}>×</button>
            </div>
          )}

          {/* Confirm action */}
          {confirm && (
            <div className={confirm === 'delete' ? styles.confirmDelete : styles.confirmArchive}>
              <span>
                {confirm === 'archive'
                  ? '⊟ ARCHIVE this session? It will be moved to session-state-archived/'
                  : '⊗ PERMANENTLY DELETE this session? This cannot be undone.'}
              </span>
              <div className={styles.confirmActions}>
                <button
                  className={confirm === 'delete' ? styles.confirmDeleteBtn : styles.confirmArchiveBtn}
                  onClick={confirm === 'archive' ? handleArchive : handleDelete}
                >
                  CONFIRM
                </button>
                <button className={styles.confirmCancelBtn} onClick={() => setConfirm(null)}>
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className={styles.metaGrid}>
            <span className={styles.metaKey}>ID</span>
            <span className={styles.metaVal}>{selectedSession.id}</span>

            <span className={styles.metaKey}>RESUME CMD</span>
            <span className={styles.metaVal}>
              <button
                className={styles.copyBtn}
                onClick={() => {
                  navigator.clipboard.writeText(`copilot --resume=${selectedSession.id}`)
                  setCopiedResume(true)
                  setTimeout(() => setCopiedResume(false), 1500)
                }}
              >
                {copiedResume ? '✓ Copied' : `copilot --resume=${selectedSession.id}`}
              </button>
            </span>

            <span className={styles.metaKey}>WORKING DIR</span>
            <span className={styles.metaVal}>{selectedSession.cwd}</span>

            {selectedSession.repository && (
              <>
                <span className={styles.metaKey}>REPOSITORY</span>
                <span className={styles.metaVal}>{selectedSession.repository}</span>
              </>
            )}
            {selectedSession.branch && (
              <>
                <span className={styles.metaKey}>BRANCH</span>
                <span className={styles.metaVal}>{selectedSession.branch}</span>
              </>
            )}

            <span className={styles.metaKey}>CREATED</span>
            <span className={styles.metaVal}>{new Date(selectedSession.createdAt).toLocaleString()}</span>

            <span className={styles.metaKey}>LAST ACTIVE</span>
            <span className={styles.metaVal}>{new Date(selectedSession.updatedAt).toLocaleString()}</span>

            <span className={styles.metaKey}>DURATION</span>
            <span className={styles.metaVal}>{formatDuration(selectedSession.createdAt, selectedSession.updatedAt)}</span>

            {selectedSession.copilotVersion && (
              <>
                <span className={styles.metaKey}>COPILOT</span>
                <span className={styles.metaVal}>{selectedSession.copilotVersion}</span>
              </>
            )}
          </div>

          {/* Tools */}
          {selectedSession.toolsUsed.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>TOOLS USED</div>
              <div className={styles.toolBadges}>
                {selectedSession.toolsUsed.map((tool) => (
                  <span key={tool} className={styles.toolBadge}>{tool}</span>
                ))}
              </div>
            </div>
          )}

          {/* Token bar */}
          {selectedSession.peakUtilisation > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                PEAK TOKEN UTILISATION — {selectedSession.peakUtilisation.toFixed(1)}%
              </div>
              <div className={styles.tokenBar}>
                <div
                  className={styles.tokenBarFill}
                  style={{ width: `${Math.min(100, selectedSession.peakUtilisation)}%` }}
                />
                <span className={styles.tokenBarLabel}>
                  {selectedSession.peakTokens.toLocaleString()} tokens
                </span>
              </div>
            </div>
          )}

          {/* Tags */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>TAGS</div>
            <div className={styles.tagsRow}>
              {localTags.map((t) => (
                <span key={t} className={styles.tagChipDetail}>
                  {t}
                  <button
                    className={styles.tagRemove}
                    onClick={() => removeTag(t)}
                    aria-label={`Remove tag ${t}`}
                  >×</button>
                </span>
              ))}
              <input
                className={styles.tagInput}
                placeholder="+ add tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addTag(tagInput)
                    setTagInput('')
                  }
                }}
              />
            </div>
          </div>

          {/* Notes */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>NOTES</div>
            <textarea
              className={styles.notesInput}
              placeholder="Add notes about this session..."
              value={localNotes}
              onChange={(e) => handleNotesChange(e.target.value)}
              rows={4}
              spellCheck={false}
            />
          </div>

          {/* Transferred context files */}
          {transfers.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                TRANSFERRED CONTEXT ({transfers.length})
                <span className={styles.infoTip} data-tip="Context files transferred from other sessions via the Transfer page. These contain plans, notes, and AI-generated summaries to help prime new sessions.">ⓘ</span>
              </div>
              {transfers.map((t) => (
                <div key={t.name} className={styles.transferItem}>
                  <div className={styles.transferHeader}>
                    <button
                      className={styles.transferName}
                      onClick={() => toggleTransfer(t.name)}
                    >
                      <span className={styles.transferChevron}>
                        {expandedTransfer === t.name ? '▾' : '▸'}
                      </span>
                      {t.name}
                    </button>
                    <span className={styles.transferDate}>
                      {new Date(t.date).toLocaleDateString()}
                    </span>
                    <button
                      className={styles.transferDelete}
                      onClick={() => deleteTransfer(t.name)}
                      aria-label={`Delete ${t.name}`}
                    >
                      ×
                    </button>
                  </div>
                  {expandedTransfer === t.name && transferContent && (
                    <pre className={styles.transferContent}>{transferContent}</pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Prompt history from events.jsonl */}
          {selectedSession.userMessages.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                PROMPT HISTORY ({selectedSession.userMessages.length})
                <span className={styles.infoTip} data-tip="Every message you typed in this session, parsed from events.jsonl. Shown newest first.">ⓘ</span>
              </div>
              {[...selectedSession.userMessages].reverse().map((msg, i) => (
                <div key={i} className={styles.rewindItem}>
                  <div className={styles.rewindMsg}>{msg}</div>
                </div>
              ))}
            </div>
          )}

          {/* Rewind snapshots */}
          {selectedSession.rewindSnapshots.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                REWIND HISTORY ({selectedSession.rewindSnapshots.length})
                <span className={styles.infoTip} data-tip="Checkpoint snapshots saved by Copilot CLI at key moments. Each captures the workspace state (files, branch) so you can rewind to that point.">ⓘ</span>
              </div>
              {selectedSession.rewindSnapshots.map((snap) => (
                <div key={snap.snapshotId} className={styles.rewindItem}>
                  <div className={styles.rewindTime}>
                    {snap.timestamp ? new Date(snap.timestamp).toLocaleString() : '—'}
                    {snap.gitBranch && ` · ${snap.gitBranch}`}
                    {` · ${snap.fileCount} files`}
                  </div>
                  <div className={styles.rewindMsg}>{snap.userMessage}</div>
                </div>
              ))}
            </div>
          )}

          {/* Files modified */}
          {selectedSession.filesModified.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                FILES MODIFIED ({selectedSession.filesModified.length})
              </div>
              {selectedSession.filesModified.slice(0, 20).map((f, i) => (
                <div key={i} className={styles.fileItem}>
                  <span className={styles.fileName}>{basename(f)}</span>
                  <span className={styles.filePath}> {f}</span>
                </div>
              ))}
              {selectedSession.filesModified.length > 20 && (
                <div className={styles.filePath}>
                  + {selectedSession.filesModified.length - 20} more…
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
