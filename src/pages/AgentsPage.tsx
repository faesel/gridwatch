import { useState, useMemo, memo } from 'react'
import type { SessionSummary } from '../types/session'
import styles from './AgentsPage.module.css'

interface AgentType {
  id: string
  displayName: string
  description: string
  badge: 'research' | 'review' | 'coding'
  sessions: SessionSummary[]
}

/** Build the fixed list of agent types from session data */
function buildAgentTypes(sessions: SessionSummary[]): AgentType[] {
  const research = sessions.filter(s => s.isResearch)
  const review = sessions.filter(s => s.isReview)
  const coding = sessions.filter(s => !s.isResearch && !s.isReview)

  return [
    {
      id: 'research',
      displayName: 'Research',
      description: 'Sessions handled by the Research agent, triggered when a prompt starts with "Researching:". Produces markdown research reports.',
      badge: 'research',
      sessions: research,
    },
    {
      id: 'code-review',
      displayName: 'Code Review',
      description: 'Sessions that invoked the code-review agent, detected via the agent_type field in events.jsonl.',
      badge: 'review',
      sessions: review,
    },
    {
      id: 'coding',
      displayName: 'Coding',
      description: 'Standard Copilot coding sessions — the default agent for writing, editing, and refactoring code.',
      badge: 'coding',
      sessions: coding,
    },
  ]
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

interface AgentsPageProps {
  sessions: SessionSummary[]
}

function AgentsPage({ sessions }: AgentsPageProps) {
  const [selected, setSelected] = useState<AgentType | null>(null)
  const [sessionSearch, setSessionSearch] = useState('')

  const agentTypes = useMemo(() => buildAgentTypes(sessions), [sessions])

  // Keep selection in sync when sessions update
  const syncedSelected = useMemo(() => {
    if (!selected) return null
    return agentTypes.find((a: AgentType) => a.id === selected.id) ?? null
  }, [agentTypes, selected?.id])

  const handleSelect = (agent: AgentType) => {
    setSelected(agent)
    setSessionSearch('')
  }

  const displayedAgent = syncedSelected

  const filteredSessions = useMemo(() => {
    if (!displayedAgent) return []
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
                {agent.badge === 'research' ? 'RESEARCH' : agent.badge === 'review' ? 'REVIEW' : 'CODING'}
              </span>
            </div>
            <div className={styles.agentMeta}>
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
                {displayedAgent.badge === 'research' ? 'RESEARCH' : displayedAgent.badge === 'review' ? 'REVIEW' : 'CODING'}
              </span>
            </div>

            <div className={styles.description}>{displayedAgent.description}</div>

            {/* Overview */}
            {stats && (
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

            {/* Sessions list */}
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
                  {sessionSearch ? `No sessions match "${sessionSearch}"` : 'No sessions for this agent type'}
                </div>
              )}

              {filteredSessions.map((s: SessionSummary) => (
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
            </div>
          </>
        ) : (
          <div className={styles.emptyDetail}>
            <div className={styles.emptyIcon}>◎</div>
            <div className={styles.emptyLabel}>Select an agent type to view its sessions</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(AgentsPage)
