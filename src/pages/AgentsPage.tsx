import { useState, useMemo, useEffect, memo } from 'react'
import { marked } from 'marked'
import type { SessionSummary } from '../types/session'
import type { CustomAgentData } from '../types/agent'
import styles from './AgentsPage.module.css'

const MAX_VISIBLE_SESSIONS = 5

interface BuiltInAgent {
  kind: 'built-in'
  id: string
  displayName: string
  description: string
  badge: 'research' | 'review' | 'coding'
  sessions: SessionSummary[]
}

interface CustomAgent {
  kind: 'custom'
  id: string
  displayName: string
  description: string
  badge: 'custom'
  sessions: SessionSummary[]
  data: CustomAgentData
}

type AgentType = BuiltInAgent | CustomAgent

/** Build the fixed list of built-in agent types from session data */
function buildBuiltInAgents(sessions: SessionSummary[]): BuiltInAgent[] {
  const research = sessions.filter(s => s.isResearch)
  const review = sessions.filter(s => s.isReview)
  const coding = sessions.filter(s => !s.isResearch && !s.isReview)

  return [
    {
      kind: 'built-in',
      id: 'research',
      displayName: 'Research',
      description: 'Sessions handled by the Research agent, triggered when a prompt starts with "Researching:". Produces markdown research reports.',
      badge: 'research',
      sessions: research,
    },
    {
      kind: 'built-in',
      id: 'code-review',
      displayName: 'Code Review',
      description: 'Sessions that invoked the code-review agent, detected via the agent_type field in events.jsonl.',
      badge: 'review',
      sessions: review,
    },
    {
      kind: 'built-in',
      id: 'coding',
      displayName: 'Coding',
      description: 'Standard Copilot coding sessions — the default agent for writing, editing, and refactoring code.',
      badge: 'coding',
      sessions: coding,
    },
  ]
}

/** Build custom agent entries from the agents directory scan, linking matching sessions */
function buildCustomAgents(customAgents: CustomAgentData[], sessions: SessionSummary[]): CustomAgent[] {
  return customAgents.map(agent => {
    const name = agent.name.toLowerCase()
    const displayName = agent.displayName.toLowerCase()
    const matched = sessions.filter(s =>
      (s.agentTypes ?? []).some(t => {
        const tLower = t.toLowerCase()
        return tLower === name || tLower === displayName
      })
    )
    return {
      kind: 'custom',
      id: `custom-${agent.name}`,
      displayName: agent.displayName,
      description: agent.description || 'Custom agent — no description provided.',
      badge: 'custom' as const,
      sessions: matched,
      data: agent,
    }
  })
}

/** Format a date as a relative "N days ago" string */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function badgeLabel(badge: AgentType['badge']): string {
  switch (badge) {
    case 'research': return 'RESEARCH'
    case 'review': return 'REVIEW'
    case 'coding': return 'CODING'
    case 'custom': return 'CUSTOM'
  }
}

/** Strip YAML frontmatter before rendering markdown */
function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
}

function renderMarkdown(raw: string) {
  const body = stripFrontmatter(raw)
  const html = marked.parse(body, { async: false }) as string
  return <div className={styles.markdownView} dangerouslySetInnerHTML={{ __html: html }} />
}

interface AgentsPageProps {
  sessions: SessionSummary[]
  refreshKey: number
}

function AgentsPage({ sessions, refreshKey }: AgentsPageProps) {
  const [selected, setSelected] = useState<AgentType | null>(null)
  const [sessionSearch, setSessionSearch] = useState('')
  const [customAgents, setCustomAgents] = useState<CustomAgentData[]>([])
  const [activeFile, setActiveFile] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [showAllSessions, setShowAllSessions] = useState(false)

  useEffect(() => {
    window.gridwatchAPI.getCustomAgents()
      .then(setCustomAgents)
      .catch(() => setCustomAgents([]))
  }, [refreshKey])

  // Load file content when a custom agent file is selected
  useEffect(() => {
    if (!selected || selected.kind !== 'custom' || !activeFile) {
      setFileContent('')
      return
    }
    setFileLoading(true)
    window.gridwatchAPI.getAgentFile(selected.data.name, activeFile)
      .then((content) => setFileContent(content ?? ''))
      .catch(() => setFileContent(''))
      .finally(() => setFileLoading(false))
  }, [selected?.kind === 'custom' ? selected.data.name : null, activeFile])

  const agentTypes = useMemo(() => {
    const builtIn = buildBuiltInAgents(sessions)
    const custom = buildCustomAgents(customAgents, sessions)
    return [...builtIn, ...custom]
  }, [sessions, customAgents])

  // Keep selection in sync when sessions/agents update
  const syncedSelected = useMemo(() => {
    if (!selected) return null
    return agentTypes.find((a: AgentType) => a.id === selected.id) ?? null
  }, [agentTypes, selected?.id])

  const handleSelect = (agent: AgentType) => {
    setSelected(agent)
    setSessionSearch('')
    setShowAllSessions(false)
    if (agent.kind === 'custom' && agent.data.files.length > 0) {
      const agentMd = agent.data.files.find(f => f.name === 'AGENT.md')
      setActiveFile(agentMd ? agentMd.name : agent.data.files[0].name)
    } else {
      setActiveFile('')
    }
  }

  const displayedAgent = syncedSelected

  const filteredSessions = useMemo(() => {
    if (!displayedAgent || displayedAgent.sessions.length === 0) return []
    const q = sessionSearch.toLowerCase()
    return displayedAgent.sessions
      .filter((s: SessionSummary) =>
        !q ||
        (s.summary ?? '').toLowerCase().includes(q) ||
        (s.repository ?? '').toLowerCase().includes(q) ||
        (s.branch ?? '').toLowerCase().includes(q)
      )
      .sort((a: SessionSummary, b: SessionSummary) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [displayedAgent?.sessions, sessionSearch])

  // Stats derived from the selected agent's sessions
  const stats = useMemo(() => {
    if (!displayedAgent || displayedAgent.sessions.length === 0) return null
    const sorted = [...displayedAgent.sessions].sort(
      (a: SessionSummary, b: SessionSummary) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    const totalTurns = displayedAgent.sessions.reduce((sum: number, s: SessionSummary) => sum + s.turnCount, 0)
    const totalMessages = displayedAgent.sessions.reduce((sum: number, s: SessionSummary) => sum + s.userMessageCount, 0)
    const totalReports = displayedAgent.sessions.reduce((sum: number, s: SessionSummary) => sum + s.researchReportCount, 0)
    return {
      count: displayedAgent.sessions.length,
      lastUsed: sorted[0].updatedAt,
      totalTurns,
      totalMessages,
      totalReports,
      avgTurns: Math.round(totalTurns / displayedAgent.sessions.length),
    }
  }, [displayedAgent?.sessions])

  return (
    <div className={styles.container}>
      {/* ── List panel ── */}
      <div className={styles.listPanel}>
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>AGENTS</span>
          <span className={styles.listCount}>{agentTypes.length}</span>
        </div>

        {agentTypes.map((agent: AgentType) => (
          <div
            key={agent.id}
            className={`${styles.agentCard} ${displayedAgent?.id === agent.id ? styles.agentCardActive : ''}`}
            onClick={() => handleSelect(agent)}
          >
            <div className={styles.agentCardRow}>
              <span className={styles.agentName}>{agent.displayName}</span>
              <span className={`${styles.typeBadge} ${styles[`badge_${agent.badge}`]}`}>
                {badgeLabel(agent.badge)}
              </span>
            </div>
            <div className={styles.agentMeta}>
              {agent.kind === 'built-in' ? (
                <>
                  <span className={styles.sessionCount}>{agent.sessions.length} sessions</span>
                  {agent.sessions.length > 0 && (
                    <span className={styles.lastUsed}>
                      {relativeTime(
                        agent.sessions.reduce((a: SessionSummary, b: SessionSummary) =>
                          new Date(b.updatedAt) > new Date(a.updatedAt) ? b : a
                        ).updatedAt
                      )}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className={styles.sessionCount}>{agent.data.files.length} files</span>
                  <span className={styles.lastUsed}>{relativeTime(agent.data.modifiedAt)}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Detail panel ── */}
      <div className={styles.detailPanel}>
        {displayedAgent ? (
          <>
            <div className={styles.detailHeader}>
              <div className={styles.detailTitle}>{displayedAgent.displayName}</div>
              <span className={`${styles.typeBadge} ${styles[`badge_${displayedAgent.badge}`]}`}>
                {badgeLabel(displayedAgent.badge)}
              </span>
            </div>

            <div className={styles.description}>{displayedAgent.description}</div>

            {/* Overview for built-in agents */}
            {displayedAgent.kind === 'built-in' && stats && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>OVERVIEW</div>
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Sessions</span>
                  <span className={styles.fieldValue}>{stats.count}</span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Last used</span>
                  <span className={styles.fieldValue}>{relativeTime(stats.lastUsed)}</span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Total turns</span>
                  <span className={styles.fieldValue}>{stats.totalTurns.toLocaleString()}</span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Total messages</span>
                  <span className={styles.fieldValue}>{stats.totalMessages.toLocaleString()}</span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Avg turns/session</span>
                  <span className={styles.fieldValue}>{stats.avgTurns}</span>
                </div>
                {displayedAgent.badge === 'research' && stats.totalReports > 0 && (
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>Research reports</span>
                    <span className={styles.fieldValue}>{stats.totalReports}</span>
                  </div>
                )}
              </div>
            )}

            {/* Overview for custom agents */}
            {displayedAgent.kind === 'custom' && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>DETAILS</div>
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Folder</span>
                  <span className={styles.fieldValue}>{displayedAgent.data.name}</span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Created</span>
                  <span className={styles.fieldValue}>{relativeTime(displayedAgent.data.createdAt)}</span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Last modified</span>
                  <span className={styles.fieldValue}>{relativeTime(displayedAgent.data.modifiedAt)}</span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Files</span>
                  <span className={styles.fieldValue}>{displayedAgent.data.files.length}</span>
                </div>
              </div>
            )}

            {/* File viewer for custom agents */}
            {displayedAgent.kind === 'custom' && displayedAgent.data.files.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  FILES ({displayedAgent.data.files.length})
                </div>

                <div className={styles.fileTabs}>
                  {displayedAgent.data.files.map((f) => (
                    <button
                      key={f.name}
                      className={`${styles.fileTab} ${activeFile === f.name ? styles.fileTabActive : ''}`}
                      onClick={() => setActiveFile(f.name)}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>

                {fileLoading ? (
                  <div className={styles.emptyState}>LOADING…</div>
                ) : fileContent ? (
                  <div className={styles.fileContent}>
                    {(activeFile.endsWith('.md') || activeFile.endsWith('.markdown'))
                      ? renderMarkdown(fileContent)
                      : <pre className={styles.codeBlock}>{fileContent}</pre>
                    }
                  </div>
                ) : (
                  <div className={styles.emptyState}>No content</div>
                )}
              </div>
            )}

            {/* Sessions list */}
            {displayedAgent.sessions.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  SESSIONS ({displayedAgent.sessions.length})
                </div>

                {displayedAgent.sessions.length > 6 && (
                  <input
                    className={styles.searchInput}
                    type="text"
                    placeholder="Filter sessions…"
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                  />
                )}

                {filteredSessions.length === 0 && (
                  <div className={styles.emptyState}>
                    {sessionSearch ? `No sessions match "${sessionSearch}"` : 'No sessions for this agent'}
                  </div>
                )}

                {(showAllSessions ? filteredSessions : filteredSessions.slice(0, MAX_VISIBLE_SESSIONS)).map((s: SessionSummary) => (
                  <div key={s.id} className={styles.sessionRow}>
                    <div className={styles.sessionRowTop}>
                      <span className={styles.sessionSummary}>
                        {s.summary || s.lastUserMessage || s.id.slice(0, 8)}
                      </span>
                      <span className={styles.sessionTime}>{relativeTime(s.updatedAt)}</span>
                    </div>
                    <div className={styles.sessionRowMeta}>
                      {s.repository && (
                        <span className={styles.sessionRepo}>{s.repository}</span>
                      )}
                      <span className={styles.sessionTurns}>{s.turnCount} turns</span>
                      {s.researchReportCount > 0 && (
                        <span className={styles.reportsBadge}>{s.researchReportCount} reports</span>
                      )}
                    </div>
                  </div>
                ))}

                {filteredSessions.length > MAX_VISIBLE_SESSIONS && (
                  <button
                    className={styles.showMoreBtn}
                    onClick={() => setShowAllSessions(v => !v)}
                  >
                    {showAllSessions
                      ? 'SHOW LESS'
                      : `SHOW ALL ${filteredSessions.length} SESSIONS`
                    }
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className={styles.emptyDetail}>
            <div className={styles.emptyIcon}>◎</div>
            <div className={styles.emptyLabel}>Select an agent to view details</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(AgentsPage)
