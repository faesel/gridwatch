import { useState } from 'react'
import type { SessionData } from '../types/session'
import type { InsightResult } from '../types/global'
import { loadApiKey } from './SettingsPage'
import styles from './InsightsPage.module.css'

interface Props {
  sessions: SessionData[]
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function scoreColor(score: number): string {
  if (score >= 8) return '#00f5ff'   // cyan — great
  if (score >= 6) return '#0080ff'   // blue — good
  if (score >= 4) return '#ff6600'   // orange — average
  return '#ff2244'                   // red — poor
}

function scoreLabel(score: number): string {
  if (score >= 9) return 'EXCELLENT'
  if (score >= 7) return 'GOOD'
  if (score >= 5) return 'AVERAGE'
  if (score >= 3) return 'NEEDS WORK'
  return 'POOR'
}

export default function InsightsPage({ sessions }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const [result, setResult] = useState<InsightResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sessionsWithMessages = sessions.filter((s) => s.userMessages.length > 0)
  const selected = sessionsWithMessages.find((s) => s.id === selectedId) || null

  const analyse = async () => {
    if (!selected) return
    const apiKey = loadApiKey()
    if (!apiKey) {
      setError('No GitHub token set. Go to Settings → GitHub Personal Access Token to add one.')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await window.gridwatchAPI.analyseSession(apiKey, selected.userMessages)
      setResult(res)
    } catch (err) {
      setError((err as Error).message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageTitle}>INSIGHTS</div>
      <div className={styles.subtitle}>
        AI-powered prompt feedback — select a session and get actionable tips to improve your Copilot workflow.
      </div>

      {/* Session picker */}
      <div className={styles.pickerRow}>
        <select
          className={styles.picker}
          value={selectedId}
          onChange={(e) => { setSelectedId(e.target.value); setResult(null); setError(null) }}
        >
          <option value="">— SELECT A SESSION —</option>
          {sessionsWithMessages.map((s) => (
            <option key={s.id} value={s.id}>
              {truncate(s.summary || s.lastUserMessage || s.id.slice(0, 12), 60)}
              {' '}({s.userMessages.length} prompts)
            </option>
          ))}
        </select>
        <button
          className={styles.analyseBtn}
          onClick={analyse}
          disabled={!selected || loading}
        >
          {loading ? 'ANALYSING…' : '⚡ ANALYSE'}
        </button>
      </div>

      {/* Session preview */}
      {selected && !result && !loading && (
        <div className={styles.preview}>
          <div className={styles.previewTitle}>
            {selected.userMessages.length} PROMPTS IN THIS SESSION
          </div>
          {selected.userMessages.slice(0, 5).map((msg, i) => (
            <div key={i} className={styles.previewPrompt}>
              <span className={styles.promptNum}>{i + 1}.</span>
              {truncate(msg, 120)}
            </div>
          ))}
          {selected.userMessages.length > 5 && (
            <div className={styles.previewMore}>
              + {selected.userMessages.length - 5} more prompts…
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className={styles.loadingPanel}>
          <div className={styles.spinner} />
          <div className={styles.loadingText}>ANALYSING SESSION PROMPTS…</div>
          <div className={styles.loadingSubtext}>Sending {selected?.userMessages.length} prompts to OpenAI gpt-4o-mini</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className={styles.errorPanel}>
          ⚠ {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className={styles.results}>
          {/* Overall score */}
          <div className={styles.scoreCard}>
            <div className={styles.scoreRing} style={{ borderColor: scoreColor(result.overallScore) }}>
              <span className={styles.scoreNum} style={{ color: scoreColor(result.overallScore) }}>
                {result.overallScore}
              </span>
              <span className={styles.scoreMax}>/10</span>
            </div>
            <div className={styles.scoreInfo}>
              <div className={styles.scoreGrade} style={{ color: scoreColor(result.overallScore) }}>
                {scoreLabel(result.overallScore)}
              </div>
              <div className={styles.scoreSummary}>{result.summary}</div>
            </div>
          </div>

          {/* Per-prompt feedback */}
          {result.promptFeedback.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>PROMPT-BY-PROMPT FEEDBACK</div>
              {result.promptFeedback.map((pf, i) => (
                <div key={i} className={styles.feedbackCard}>
                  <div className={styles.feedbackHeader}>
                    <span className={styles.feedbackPrompt}>{pf.prompt}</span>
                    <span
                      className={styles.feedbackScore}
                      style={{ color: scoreColor(pf.score), borderColor: scoreColor(pf.score) }}
                    >
                      {pf.score}/10
                    </span>
                  </div>
                  <div className={styles.feedbackText}>{pf.feedback}</div>
                </div>
              ))}
            </div>
          )}

          {/* Suggestions */}
          {result.suggestions.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>SUGGESTIONS</div>
              {result.suggestions.map((s, i) => (
                <div key={i} className={styles.suggestionItem}>
                  <span className={styles.suggestionIcon}>▸</span>
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
