import { useState, useEffect, useMemo, memo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { SessionSummary } from '../types/session'
import TagFilter, { filterByTags } from '../components/TagFilter'
import { useThemeColors } from '../hooks/useThemeColors'
import styles from './TokensPage.module.css'

interface Props {
  sessions: SessionSummary[]
}

interface LogTokenEntry {
  date: string
  tokens: number
  utilisation: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TooltipContent = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--tron-panel)',
      border: '1px solid var(--tron-border)',
      padding: '8px 12px',
      fontFamily: 'inherit',
      fontSize: 11,
    }}>
      <div style={{ color: 'var(--tron-text-dim)', marginBottom: 4 }}>{label}</div>
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        <div key={i} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </div>
      ))}
    </div>
  )
}

const basename = (path: string): string =>
  path.split('/').filter(Boolean).pop() || path

type TimeRange = '1D' | '1W' | '1M' | 'ALL'

function filterByRange<T extends { date: string }>(data: T[], range: TimeRange): T[] {
  if (range === 'ALL') return data
  const now = Date.now()
  const ms = range === '1D' ? 86400000 : range === '1W' ? 604800000 : 2592000000
  const cutoff = new Date(now - ms).toISOString().slice(0, 10)
  return data.filter((d) => d.date >= cutoff)
}

function TokensPage({ sessions }: Props) {
  const [logTokens, setLogTokens] = useState<LogTokenEntry[]>([])
  const [range, setRange] = useState<TimeRange>('1D')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const colors = useThemeColors()

  useEffect(() => {
    window.gridwatchAPI.getLogTokens()
      .then(setLogTokens)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => filterByTags(sessions, selectedTags), [sessions, selectedTags])
  const sessionsWithData = useMemo(() => filtered.filter((s) => s.peakTokens > 0), [filtered])
  const avgUtilisation = useMemo(() => sessionsWithData.length > 0
    ? sessionsWithData.reduce((sum, s) => sum + s.peakUtilisation, 0) / sessionsWithData.length
    : 0, [sessionsWithData])
  const maxTokens = useMemo(() => sessionsWithData.length > 0
    ? Math.max(...sessionsWithData.map((s) => s.peakTokens))
    : 0, [sessionsWithData])

  // Line chart data: one point per log file entry (by date)
  // Aggregate by date (multiple log files can share the same date), keeping peak tokens
  const lineData = useMemo(() => {
    const map = new Map<string, { tokens: number; utilisation: number }>()
    logTokens.forEach((entry) => {
      const existing = map.get(entry.date)
      if (!existing || entry.tokens > existing.tokens) {
        map.set(entry.date, { tokens: entry.tokens, utilisation: entry.utilisation })
      }
    })
    return filterByRange(
      Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, { tokens, utilisation }]) => ({ date, tokens, util: utilisation })),
      range,
    )
  }, [logTokens, range])

  const sortedSessions = useMemo(
    () => [...sessionsWithData].sort((a, b) => b.peakTokens - a.peakTokens),
    [sessionsWithData],
  )

  const hasData = lineData.length > 0

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.pageTitle}>TOKEN USAGE</div>
        <div className={styles.loading}>LOADING TOKEN DATA...</div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageTitle}>TOKEN USAGE</div>
      <TagFilter sessions={sessions} selectedTags={selectedTags} onChange={setSelectedTags} />

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{sessionsWithData.length}</div>
          <div className={styles.statLabel}>SESSIONS WITH DATA</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{avgUtilisation.toFixed(1)}%</div>
          <div className={styles.statLabel}>AVG PEAK UTILISATION</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{maxTokens.toLocaleString()}</div>
          <div className={styles.statLabel}>MAX TOKENS SEEN</div>
        </div>
      </div>

      {!hasData && (
        <div className={styles.empty}>NO TOKEN DATA AVAILABLE</div>
      )}

      {hasData && (
        <div className={styles.rangeRow}>
          {(['1D', '1W', '1M', 'ALL'] as TimeRange[]).map((r) => (
            <button
              key={r}
              className={`${styles.rangeBtn} ${range === r ? styles.rangeBtnActive : ''}`}
              onClick={() => setRange(r)}
            >{r}</button>
          ))}
        </div>
      )}

      {lineData.length > 0 && (
        <div className={styles.chartPanel}>
          <div className={styles.chartTitle}>PEAK TOKEN USAGE OVER TIME</div>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={lineData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid stroke={colors.border} strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: colors.textDim, fontSize: 10 }} />
              <YAxis tick={{ fill: colors.textDim, fontSize: 10 }} />
              <Tooltip content={<TooltipContent />} />
              <Line
                type="monotone"
                dataKey="tokens"
                name="Tokens"
                stroke={colors.cyan}
                strokeWidth={2}
                dot={{ fill: colors.orange, r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
          <div className={styles.contextNote}>Context window: 128,000 tokens</div>
        </div>
      )}

      {sortedSessions.length > 0 && (
        <div className={styles.chartPanel}>
          <div className={styles.chartTitle}>TOKEN USAGE BY SESSION</div>
          <table className={styles.sessionTable}>
            <thead>
              <tr className={styles.tableHeader}>
                <th className={styles.thLeft}>SUMMARY</th>
                <th className={styles.thLeft}>REPOSITORY</th>
                <th className={styles.thRight}>PEAK TOKENS</th>
                <th className={styles.thRight}>PEAK %</th>
                <th className={styles.thBar}></th>
              </tr>
            </thead>
            <tbody>
              {sortedSessions.map((s, i) => {
                  const pct = (s.peakTokens / 128000) * 100
                  const repo = s.repository || basename(s.cwd)
                  const summary = s.summary || s.lastUserMessage || '—'
                  return (
                    <tr
                      key={s.id}
                      className={styles.tableRow}
                      style={{ background: i % 2 === 1 ? 'color-mix(in srgb, var(--tron-cyan) 2%, transparent)' : undefined }}
                    >
                      <td className={styles.tdSummary}>{summary}</td>
                      <td className={styles.tdRepo}>{repo}</td>
                      <td className={styles.tdRight}>{s.peakTokens.toLocaleString()}</td>
                      <td className={styles.tdRight}>{s.peakUtilisation.toFixed(1)}%</td>
                      <td className={styles.tdBar}>
                        <div className={styles.miniBarTrack}>
                          <div
                            className={styles.miniBarFill}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default memo(TokensPage)
