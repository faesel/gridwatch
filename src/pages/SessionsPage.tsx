import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
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
  const [typeFilter, setTypeFilter] = useState<'all' | 'research' | 'review' | 'coding'>('all')
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
  const [copiedTransfer, setCopiedTransfer] = useState<string | null>(null)
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set())
  const [overflowingMsgs, setOverflowingMsgs] = useState<Set<string>>(new Set())
  const msgRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const measureOverflow = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) {
      msgRefs.current.set(key, el)
      const isTruncated = el.scrollHeight > el.clientHeight + 1
      setOverflowingMsgs(prev => {
        if (isTruncated && !prev.has(key)) {
          const next = new Set(prev)
          next.add(key)
          return next
        }
        if (!isTruncated && prev.has(key)) {
          const next = new Set(prev)
          next.delete(key)
          return next
        }
        return prev
      })
    } else {
      msgRefs.current.delete(key)
    }
  }, [])

  // Sync localTags, localNotes, and transfers when selected session changes
  useEffect(() => {
    setLocalTags(selectedSession?.tags ?? [])
    setLocalNotes(selectedSession?.notes ?? '')
    setTagInput('')
    setTransfers([])
    setExpandedTransfer(null)
    setTransferContent(null)
    setExpandedMsgs(new Set())
    setOverflowingMsgs(new Set())
    if (selectedSession) {
      window.gridwatchAPI.listTransfers(selectedSession.id).then(setTransfers)
    }
  }, [selectedSession?.id])

  // Keep selectedSession in sync when sessions prop updates (e.g. after rename)
  useEffect(() => {
    if (selectedSession) {
      const updated = sessions.find(s => s.id === selectedSession.id)
      if (updated && updated.updatedAt !== selectedSession.updatedAt) setSelectedSession(updated)
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
  const allTags = useMemo(() => Array.from(
    new Set(sessions.flatMap((s) => s.tags ?? []))
  ).sort(), [sessions])

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const clearTagFilter = () => setSelectedTags(new Set())

  const filtered = useMemo(() => sessions.filter((s) => {
    // Type filter
    if (typeFilter === 'research' && !s.isResearch) return false
    if (typeFilter === 'review' && !s.isReview) return false
    if (typeFilter === 'coding' && (s.isResearch || s.isReview)) return false
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
  }), [sessions, selectedTags, search, typeFilter])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Reset to first page when search or filter changes
  useEffect(() => { setPage(0) }, [search, selectedTags, typeFilter])

  const totalCount = sessions.length
  const todayCount = useMemo(() => sessions.filter((s) => isToday(s.createdAt)).length, [sessions])
  const uniqueRepos = useMemo(() => new Set(sessions.map((s) => s.repository || s.cwd)).size, [sessions])

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
          <div className={styles.typeFilter}>
            {(['all', 'research', 'review', 'coding'] as const).map((t) => (
              <button
                key={t}
                className={`${styles.typeFilterBtn} ${typeFilter === t ? styles.typeFilterBtnActive : ''}`}
                onClick={() => setTypeFilter(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
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
                  {session.peakUtilisation > 0 && (
                    <span className={styles.cardUtil}>
                      {session.peakUtilisation.toFixed(1)}% ctx
                    </span>
                  )}
                  {session.isResearch && (
                    <span className={styles.researchBadge}>RESEARCH</span>
                  )}
                  {session.isReview && (
                    <span className={styles.reviewBadge}>REVIEW</span>
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
                  {selectedSession.isResearch && (
                    <span className={styles.researchBadgeDetail}>RESEARCH</span>
                  )}
                  {selectedSession.isReview && (
                    <span className={styles.reviewBadgeDetail}>REVIEW</span>
                  )}
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
              <div className={styles.sectionTitle}>TOKEN UTILISATION</div>
              <div className={styles.tokenBars}>
                {selectedSession.tokenHistory.length > 0 && (() => {
                  const first = selectedSession.tokenHistory[0]
                  return (
                    <div className={styles.tokenBarRow}>
                      <span className={styles.tokenBarRowLabel}>Initial</span>
                      <div className={styles.tokenBar} title={`Initial: ${first.utilisation.toFixed(1)}% — ${first.tokens.toLocaleString()} tokens`}>
                        <div
                          className={styles.tokenBarFillCurrent}
                          style={{ width: `${Math.min(100, first.utilisation)}%` }}
                        />
                        <span className={styles.tokenBarLabel}>
                          {first.utilisation.toFixed(1)}% · {first.tokens.toLocaleString()} tokens
                        </span>
                      </div>
                    </div>
                  )
                })()}
                <div className={styles.tokenBarRow}>
                  <span className={styles.tokenBarRowLabel}>Peak</span>
                  <div className={styles.tokenBar} title={`Peak: ${selectedSession.peakUtilisation.toFixed(1)}% — ${selectedSession.peakTokens.toLocaleString()} tokens`}>
                    <div
                      className={styles.tokenBarFillPeak}
                      style={{ width: `${Math.min(100, selectedSession.peakUtilisation)}%` }}
                    />
                    <span className={styles.tokenBarLabel}>
                      {selectedSession.peakUtilisation.toFixed(1)}% · {selectedSession.peakTokens.toLocaleString()} tokens
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Context cost breakdown */}
          {selectedSession.contextCost && selectedSession.contextCost.items.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                CONTEXT COST
                <span className={styles.contextCostTotal}>
                  ~{selectedSession.contextCost.totalTokens.toLocaleString()} tokens
                </span>
              </div>
              <div className={styles.contextCostList}>
                {selectedSession.contextCost.items.map((item, i) => (
                  <div key={i} className={styles.contextCostItem}>
                    <span className={styles.contextCostLabel}>{item.label}</span>
                    <span className={styles.contextCostTokens}>
                      ~{item.tokens.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compactions */}
          {(selectedSession.compactions ?? []).length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                COMPACTIONS ({selectedSession.compactions.length})
              </div>
              <div className={styles.compactionList}>
                {selectedSession.compactions.map((c, i) => (
                  <div key={i} className={styles.compactionItem}>
                    <div className={styles.compactionHeader}>
                      <span className={styles.compactionTime}>
                        {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className={styles.compactionTrigger}>
                        {c.triggerUtilisation > 0 ? `${c.triggerUtilisation.toFixed(1)}%` : '—'}
                        {c.forced && <span className={styles.compactionForced}> FORCED</span>}
                      </span>
                    </div>
                    {c.summary && (
                      <div className={styles.compactionSummary}>{c.summary}</div>
                    )}
                    {c.tokensSaved != null && (
                      <div className={styles.compactionStats}>
                        <span>{c.messagesReplaced} msgs → {c.newMessages} summary</span>
                        <span className={styles.compactionSaved}>−{c.tokensSaved.toLocaleString()} tokens</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

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
                      className={styles.transferCopy}
                      onClick={() => {
                        const transferPath = `~/.copilot/session-state/${selectedSession.id}/${t.name}`
                        const cmd = `Can you gain context using the transferred context file at ${transferPath}`
                        navigator.clipboard.writeText(cmd)
                        setCopiedTransfer(t.name)
                        setTimeout(() => setCopiedTransfer(null), 1500)
                      }}
                      aria-label={`Copy prompt for ${t.name}`}
                    >
                      {copiedTransfer === t.name ? '✓' : '⧉'}
                    </button>
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
              {[...selectedSession.userMessages].reverse().map((msg, i) => {
                const key = `prompt-${i}`
                const isExpanded = expandedMsgs.has(key)
                return (
                  <div key={i} className={styles.rewindItem}>
                    <div
                      ref={el => !isExpanded && measureOverflow(key, el)}
                      className={isExpanded ? styles.rewindMsgExpanded : styles.rewindMsg}
                    >
                      {msg.content}
                      {msg.model && (
                        <span className={`${styles.modelBadge} ${msg.model.includes('opus') ? styles.modelPremium : msg.model.includes('haiku') ? styles.modelFast : ''}`}>
                          {msg.model.replace('claude-', '').replace('gpt-', '')}
                        </span>
                      )}
                    </div>
                    {(isExpanded || overflowingMsgs.has(key)) && (
                      <button
                        className={styles.expandToggle}
                        onClick={() => setExpandedMsgs(prev => {
                          const next = new Set(prev)
                          isExpanded ? next.delete(key) : next.add(key)
                          return next
                        })}
                      >
                        {isExpanded ? '▾ Show less' : '▸ Show more'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Rewind snapshots */}
          {selectedSession.rewindSnapshots.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                REWIND HISTORY ({selectedSession.rewindSnapshots.length})
                <span className={styles.infoTip} data-tip="Checkpoint snapshots saved by Copilot CLI at key moments. Each captures the workspace state (files, branch) so you can rewind to that point.">ⓘ</span>
              </div>
              {selectedSession.rewindSnapshots.map((snap) => {
                const key = `rewind-${snap.snapshotId}`
                const isExpanded = expandedMsgs.has(key)
                return (
                  <div key={snap.snapshotId} className={styles.rewindItem}>
                    <div className={styles.rewindTime}>
                      {snap.timestamp ? new Date(snap.timestamp).toLocaleString() : '—'}
                      {snap.gitBranch && ` · ${snap.gitBranch}`}
                      {` · ${snap.fileCount} files`}
                    </div>
                    <div
                      ref={el => !isExpanded && measureOverflow(key, el)}
                      className={isExpanded ? styles.rewindMsgExpanded : styles.rewindMsg}
                    >{snap.userMessage}</div>
                    {(isExpanded || overflowingMsgs.has(key)) && (
                      <button
                        className={styles.expandToggle}
                        onClick={() => setExpandedMsgs(prev => {
                          const next = new Set(prev)
                          isExpanded ? next.delete(key) : next.add(key)
                          return next
                        })}
                      >
                        {isExpanded ? '▾ Show less' : '▸ Show more'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Research reports */}
          {(selectedSession.researchReports ?? []).length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                RESEARCH REPORTS ({selectedSession.researchReports.length})
                <span
                  className={styles.infoTip}
                  data-tip="Markdown reports generated by Copilot's research agent during this session."
                > ⓘ</span>
              </div>
              {selectedSession.researchReports.map((f, i) => (
                <div key={i} className={styles.fileItem}>
                  <span className={styles.fileName}>{basename(f).replace(/\.md$/, '')}</span>
                  <button
                    className={styles.openFileBtn}
                    onClick={() => window.gridwatchAPI.showInFolder(f)}
                    title="Show in folder"
                  >⊞</button>
                </div>
              ))}
            </div>
          )}

          {/* Files modified */}
          {selectedSession.filesModified.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                FILES MODIFIED ({selectedSession.filesModified.length})
                <span
                  className={styles.infoTip}
                  data-tip="Source files created or edited by Copilot during this session, tracked via rewind snapshots."
                > ⓘ</span>
              </div>
              {selectedSession.filesModified.slice(0, 20).map((f, i) => (
                <div key={i} className={styles.fileItem}>
                  <span className={styles.fileName}>{basename(f)}</span>
                  <span className={styles.filePath}> {f}</span>
                  <button
                    className={styles.openFileBtn}
                    onClick={() => window.gridwatchAPI.showInFolder(f)}
                    title="Show in folder"
                  >⊞</button>
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
