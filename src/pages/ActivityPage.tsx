import { useState, useMemo, memo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { SessionSummary } from '../types/session'
import TagFilter, { filterByTags } from '../components/TagFilter'
import { useThemeColors } from '../hooks/useThemeColors'
import styles from './ActivityPage.module.css'

interface Props {
  sessions: SessionSummary[]
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
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  )
}

const basename = (path: string): string =>
  path.split('/').filter(Boolean).pop() || path

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getCellColor(count: number): string {
  if (count === 0) return 'var(--tron-border)'
  if (count === 1) return 'color-mix(in srgb, var(--tron-blue) 35%, transparent)'
  if (count <= 3) return 'color-mix(in srgb, var(--tron-blue) 60%, transparent)'
  return 'var(--tron-cyan)'
}

function getCellShadow(count: number): string | undefined {
  if (count >= 4) return 'var(--tron-glow-cyan)'
  return undefined
}

function buildHeatmapCells(): Date[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Find the Monday of the current week so the grid always ends with today's week
  const dow = today.getDay() // 0=Sun
  const daysToMon = dow === 0 ? 6 : dow - 1
  const currentMonday = new Date(today)
  currentMonday.setDate(today.getDate() - daysToMon)

  // Start exactly 51 weeks before so the grid spans 52 weeks ending this week
  const start = new Date(currentMonday)
  start.setDate(start.getDate() - 51 * 7)

  const cells: Date[] = []
  const cur = new Date(start)
  while (cells.length < 52 * 7) {
    cells.push(new Date(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return cells
}

interface HeatmapTooltipState {
  text: string
  x: number
  y: number
}

function ActivityPage({ sessions }: Props) {
  const [tooltip, setTooltip] = useState<HeatmapTooltipState | null>(null)
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const colors = useThemeColors()

  const filtered = useMemo(() => filterByTags(sessions, selectedTags), [sessions, selectedTags])

  // ── Session count by day ──────────────────────────────────
  const sessionCountByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of filtered) {
      const day = (s.createdAt ?? '').slice(0, 10)
      if (day) map.set(day, (map.get(day) || 0) + 1)
    }
    return map
  }, [filtered])

  // ── Repo map ──────────────────────────────────────────────
  const repoMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of filtered) {
      const name = s.repository || basename(s.cwd || '')
      if (name) map.set(name, (map.get(name) || 0) + 1)
    }
    return map
  }, [filtered])

  // ── Tool map ──────────────────────────────────────────────
  const toolMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of filtered) {
      for (const tool of (s.toolsUsed ?? [])) {
        map.set(tool, (map.get(tool) || 0) + 1)
      }
    }
    return map
  }, [filtered])

  // ── Stats ─────────────────────────────────────────────────
  const totalSessions = filtered.length
  const activeDays = sessionCountByDay.size
  const [favRepo = '—'] = [...repoMap.entries()].sort(([, a], [, b]) => b - a).map(([k]) => k)
  const [favTool = '—'] = [...toolMap.entries()].sort(([, a], [, b]) => b - a).map(([k]) => k)

  // ── Heatmap ───────────────────────────────────────────────
  const cells = useMemo(() => buildHeatmapCells(), [])

  const monthLabels = useMemo(() => {
    const labels: { month: string; col: number }[] = []
    cells.forEach((date, i) => {
      if (date.getDate() === 1) {
        const col = Math.floor(i / 7)
        const month = date.toLocaleString('en', { month: 'short' }).toUpperCase()
        if (!labels.find((m) => m.col === col)) {
          labels.push({ month, col })
        }
      }
    })
    return labels
  }, [cells])

  // ── Top repos ─────────────────────────────────────────────
  const topRepos = useMemo(() => [...repoMap.entries()].sort(([, a], [, b]) => b - a).slice(0, 10), [repoMap])
  const maxRepoCount = topRepos[0]?.[1] || 1

  // ── Top tools ─────────────────────────────────────────────
  const topTools = useMemo(() => [...toolMap.entries()].sort(([, a], [, b]) => b - a).slice(0, 10), [toolMap])
  const maxToolCount = topTools[0]?.[1] || 1

  // ── Day of week chart ─────────────────────────────────────
  const dayOfWeekData = useMemo(() => {
    const dayCountMap = new Map<number, number>()
    for (const s of filtered) {
      const d = new Date(s.createdAt ?? Date.now())
      if (isNaN(d.getTime())) continue
      const day = (d.getDay() + 6) % 7 // 0=Mon…6=Sun
      dayCountMap.set(day, (dayCountMap.get(day) || 0) + 1)
    }
    return DAY_NAMES.map((name, i) => ({ name, count: dayCountMap.get(i) || 0 }))
  }, [filtered])

  return (
    <div className={styles.page}>
      <div className={styles.pageTitle}>ACTIVITY</div>
      <TagFilter sessions={sessions} selectedTags={selectedTags} onChange={setSelectedTags} />

      {/* ── Stats bar ─────────────────────────── */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{totalSessions}</div>
          <div className={styles.statLabel}>TOTAL SESSIONS</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{activeDays}</div>
          <div className={styles.statLabel}>ACTIVE DAYS</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue} title={favRepo}>{favRepo}</div>
          <div className={styles.statLabel}>FAVOURITE REPO</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue} title={favTool}>{favTool}</div>
          <div className={styles.statLabel}>MOST USED TOOL</div>
        </div>
      </div>

      {/* ── Activity Heatmap ──────────────────── */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>ACTIVITY HEATMAP</div>
        <div className={styles.heatmapScroll}>
          <div className={styles.heatmapOuter}>
            {/* Month labels */}
            <div className={styles.monthLabelsRow}>
              {monthLabels.map(({ month, col }) => (
                <div
                  key={col}
                  className={styles.monthLabel}
                  style={{ gridColumn: col + 1 }}
                >
                  {month}
                </div>
              ))}
            </div>

            {/* Day labels + grid */}
            <div className={styles.heatmapBody}>
              <div className={styles.dayLabels}>
                {DAY_LABELS.map((label, i) => (
                  <div key={i}>{label}</div>
                ))}
              </div>
              <div className={styles.heatmapGrid}>
                {cells.map((date, i) => {
                  const dateStr = date.toISOString().slice(0, 10)
                  const count = sessionCountByDay.get(dateStr) || 0
                  return (
                    <div
                      key={i}
                      className={styles.cell}
                      style={{
                        background: getCellColor(count),
                        boxShadow: getCellShadow(count),
                      }}
                      onMouseEnter={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setTooltip({
                          text: `${count} session${count !== 1 ? 's' : ''} — ${dateStr}`,
                          x: rect.left + rect.width / 2,
                          y: rect.top - 4,
                        })
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Top Repositories ──────────────────── */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>TOP REPOSITORIES</div>
        <div className={styles.rankedList}>
          {topRepos.length === 0 && (
            <div style={{ color: 'var(--tron-text-dim)', fontSize: 11, letterSpacing: 1 }}>NO DATA</div>
          )}
          {topRepos.map(([name, count], idx) => (
            <div key={name} className={styles.rankedRow}>
              <div
                className={styles.fillBar}
                style={{
                  width: `${(count / maxRepoCount) * 100}%`,
                  background: 'color-mix(in srgb, var(--tron-blue) 15%, transparent)',
                }}
              />
              <div className={`${styles.rankNum} ${idx === 0 ? styles.rankNumFirst : ''}`}>
                {idx + 1}
              </div>
              <div className={styles.rankedName}>{name}</div>
              <div className={styles.rankedCount}>{count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tool Usage ────────────────────────── */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>TOOL USAGE</div>
        <div className={styles.rankedList}>
          {topTools.length === 0 && (
            <div style={{ color: 'var(--tron-text-dim)', fontSize: 11, letterSpacing: 1 }}>NO DATA</div>
          )}
          {topTools.map(([tool, count], idx) => (
            <div key={tool} className={styles.rankedRow}>
              <div
                className={styles.fillBar}
                style={{
                  width: `${(count / maxToolCount) * 100}%`,
                  background: 'color-mix(in srgb, var(--tron-cyan) 10%, transparent)',
                }}
              />
              <div className={`${styles.rankNum} ${idx === 0 ? styles.rankNumFirst : ''}`}>
                {idx + 1}
              </div>
              <div className={styles.rankedName}>{tool}</div>
              <div className={styles.rankedCount}>{count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Sessions by Day of Week ───────────── */}
      <div className={styles.chartPanel}>
        <div className={styles.sectionTitle}>SESSIONS BY DAY OF WEEK</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dayOfWeekData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid stroke={colors.border} strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fill: colors.textDim, fontSize: 10 }} />
            <YAxis tick={{ fill: colors.textDim, fontSize: 10 }} allowDecimals={false} />
            <Tooltip content={<TooltipContent />} />
            <Bar dataKey="count" name="Sessions" fill={colors.blue} fillOpacity={0.8} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Heatmap tooltip (portal-style, fixed position) */}
      {tooltip && (
        <div
          className={styles.tooltip}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  )
}

export default memo(ActivityPage)
