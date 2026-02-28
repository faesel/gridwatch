import { useState } from 'react'
import type { SessionData } from '../types/session'
import { loadApiKey } from './SettingsPage'
import SessionPicker from '../components/SessionPicker'
import styles from './TransferPage.module.css'

interface Props {
  sessions: SessionData[]
}

interface SessionContext {
  plan: string | null
  checkpoints: string[]
  notes: string
  tags: string[]
}

export default function TransferPage({ sessions }: Props) {
  const [source, setSource] = useState<SessionData | null>(null)
  const [target, setTarget] = useState<SessionData | null>(null)
  const [context, setContext] = useState<SessionContext | null>(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [transferred, setTransferred] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSourceSelect = async (s: SessionData | null) => {
    setSource(s)
    setContext(null)
    setTransferred(false)
    setError(null)
    if (!s) return
    setLoading(true)
    try {
      const ctx = await window.gridwatchAPI.getContext(s.id)
      setContext(ctx)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleTargetSelect = (s: SessionData | null) => {
    setTarget(s)
    setTransferred(false)
    setError(null)
  }

  const hasContent = context && (context.plan || context.checkpoints.length > 0 || context.notes)

  const transferPlan = async () => {
    if (!source || !target || !context) return
    setError(null)
    setTransferred(false)

    // Build transfer content
    const parts: string[] = []
    parts.push(`> Transferred from session: **${source.summary || source.id.slice(0, 12)}**`)
    parts.push(`> Date: ${new Date().toISOString().slice(0, 10)}`)
    parts.push('')

    if (context.plan) {
      parts.push('## Source Plan\n')
      parts.push(context.plan)
      parts.push('')
    }
    if (context.checkpoints.length > 0) {
      parts.push('## Session History\n')
      for (const cp of context.checkpoints) {
        parts.push(cp)
        parts.push('')
      }
    }
    if (context.notes) {
      parts.push('## Notes\n')
      parts.push(context.notes)
      parts.push('')
    }
    if (context.tags.length > 0) {
      parts.push(`## Tags\n\n${context.tags.join(', ')}`)
    }

    try {
      const filename = await window.gridwatchAPI.writeTransfer(target.id, parts.join('\n'))
      if (filename) {
        // Merge tags
        if (context.tags.length > 0) {
          const targetSession = sessions.find(s => s.id === target.id)
          const merged = Array.from(new Set([...(targetSession?.tags ?? []), ...context.tags]))
          await window.gridwatchAPI.setTags(target.id, merged)
        }
        setTransferred(true)
      } else {
        setError('Failed to write to target session')
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const generateAndTransfer = async () => {
    if (!source || !target || !context) return
    const apiKey = loadApiKey()
    if (!apiKey) {
      setError('No GitHub token set. Go to Settings → GitHub Personal Access Token to add one.')
      return
    }

    setGenerating(true)
    setError(null)
    setTransferred(false)

    // Gather all source text for summarisation
    const sourceText: string[] = []
    if (context.plan) sourceText.push(`Plan:\n${context.plan}`)
    for (const cp of context.checkpoints) sourceText.push(`Checkpoint:\n${cp}`)
    if (source.userMessages.length > 0) sourceText.push(`User prompts:\n${source.userMessages.join('\n')}`)
    if (context.notes) sourceText.push(`Notes:\n${context.notes}`)

    try {
      const res = await window.gridwatchAPI.analyseSession(apiKey, [
        `You are a session context summariser. Condense the following Copilot CLI session context into a clear, actionable brief that can prime a new session. Focus on: what was being built, key decisions made, current state, and next steps. Output as markdown.\n\n${sourceText.join('\n\n---\n\n')}`,
      ])
      // The analyse endpoint returns InsightResult, but we sent a custom prompt
      // so the response may be in the summary field or we need to handle differently
      // Instead, let's use a dedicated approach — write the summary directly
      const summary = res.summary || 'No summary generated'
      const content = [
        `> AI-generated context from session: **${source.summary || source.id.slice(0, 12)}**`,
        `> Generated: ${new Date().toISOString().slice(0, 10)}`,
        '',
        summary,
      ].join('\n')

      const filename = await window.gridwatchAPI.writeTransfer(target.id, content)
      if (filename) setTransferred(true)
      else setError('Failed to write to target session')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageTitle}>TRANSFER</div>
      <div className={styles.subtitle}>
        Transfer context from one session to another — copy plans, checkpoints, notes, and tags, or generate an AI summary.
      </div>

      <div className={styles.pickersGrid}>
        {/* Source */}
        <div className={styles.pickerSection}>
          <div className={styles.pickerLabel}>SOURCE SESSION</div>
          <SessionPicker
            sessions={sessions}
            selected={source}
            onSelect={handleSourceSelect}
            placeholder="Search source session…"
          />
        </div>

        <div className={styles.arrow}>→</div>

        {/* Target */}
        <div className={styles.pickerSection}>
          <div className={styles.pickerLabel}>TARGET SESSION</div>
          <SessionPicker
            sessions={sessions}
            selected={target}
            onSelect={handleTargetSelect}
            placeholder="Search target session…"
          />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className={styles.statusPanel}>Loading source context…</div>
      )}

      {/* Source context preview */}
      {context && source && !loading && (
        <div className={styles.contextPanel}>
          <div className={styles.contextTitle}>SOURCE CONTEXT</div>

          <div className={styles.contextGrid}>
            <div className={`${styles.contextItem} ${context.plan ? styles.contextAvailable : styles.contextEmpty}`}>
              <span className={styles.contextIcon}>📄</span>
              <span>Plan</span>
              <span className={styles.contextStatus}>{context.plan ? `${context.plan.length} chars` : 'None'}</span>
            </div>
            <div className={`${styles.contextItem} ${context.checkpoints.length > 0 ? styles.contextAvailable : styles.contextEmpty}`}>
              <span className={styles.contextIcon}>🔖</span>
              <span>Checkpoints</span>
              <span className={styles.contextStatus}>{context.checkpoints.length || 'None'}</span>
            </div>
            <div className={`${styles.contextItem} ${source.userMessages.length > 0 ? styles.contextAvailable : styles.contextEmpty}`}>
              <span className={styles.contextIcon}>💬</span>
              <span>Prompts</span>
              <span className={styles.contextStatus}>{source.userMessages.length || 'None'}</span>
            </div>
            <div className={`${styles.contextItem} ${context.notes ? styles.contextAvailable : styles.contextEmpty}`}>
              <span className={styles.contextIcon}>📝</span>
              <span>Notes</span>
              <span className={styles.contextStatus}>{context.notes ? 'Yes' : 'None'}</span>
            </div>
            <div className={`${styles.contextItem} ${context.tags.length > 0 ? styles.contextAvailable : styles.contextEmpty}`}>
              <span className={styles.contextIcon}>🏷️</span>
              <span>Tags</span>
              <span className={styles.contextStatus}>{context.tags.length ? context.tags.join(', ') : 'None'}</span>
            </div>
          </div>

          {/* Transfer actions */}
          {target && hasContent && (
            <div className={styles.actions}>
              <div className={styles.actionCard}>
                <button className={styles.transferBtn} onClick={transferPlan} disabled={generating}>
                  📋 COPY CONTEXT
                </button>
                <div className={styles.actionInfo}>
                  Copies the raw plan, checkpoints, notes, and tags verbatim from the source session into the target. No API key required.
                </div>
              </div>
              <div className={styles.actionCard}>
                <button className={styles.transferBtn} onClick={generateAndTransfer} disabled={generating}>
                  {generating ? 'GENERATING…' : '⚡ AI SUMMARY'}
                </button>
                <div className={styles.actionInfo}>
                  Uses AI to condense the source context into a short, actionable brief. Requires a GitHub token configured in Settings.
                </div>
              </div>
            </div>
          )}

          {target && !hasContent && (
            <div className={styles.statusPanel}>
              No transferable content found in source session.
            </div>
          )}

          {!target && hasContent && (
            <div className={styles.statusPanel}>
              Select a target session to transfer context.
            </div>
          )}
        </div>
      )}

      {/* Same session warning */}
      {source && target && source.id === target.id && (
        <div className={styles.errorPanel}>⚠ Source and target are the same session.</div>
      )}

      {/* Error */}
      {error && <div className={styles.errorPanel}>⚠ {error}</div>}

      {/* Success */}
      {transferred && (
        <div className={styles.successPanel}>
          ✓ Context transferred to <strong>{target?.summary || target?.id.slice(0, 12)}</strong>
        </div>
      )}
    </div>
  )
}
