import { useState, useRef, useEffect } from 'react'
import type { SessionSummary } from '../types/session'
import styles from './SessionPicker.module.css'

interface Props {
  sessions: SessionSummary[]
  selected: SessionSummary | null
  onSelect: (session: SessionSummary | null) => void
  placeholder?: string
  /** Only show sessions that have user messages */
  requireMessages?: boolean
}

function label(s: SessionSummary): string {
  return s.summary || s.lastUserMessage || s.id.slice(0, 12)
}

export default function SessionPicker({ sessions, selected, onSelect, placeholder, requireMessages }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const pool = requireMessages ? sessions.filter((s) => s.userMessageCount > 0) : sessions

  const q = query.toLowerCase()
  const filtered = q
    ? pool.filter((s) => {
        const text = `${s.summary ?? ''} ${s.lastUserMessage ?? ''} ${s.id} ${(s.tags ?? []).join(' ')}`.toLowerCase()
        return text.includes(q)
      }).slice(0, 5)
    : pool.slice(0, 5)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const pick = (s: SessionSummary) => {
    onSelect(s)
    setQuery(label(s))
    setOpen(false)
  }

  const clear = () => {
    onSelect(null)
    setQuery('')
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { setOpen(true); e.preventDefault() }
      return
    }
    if (e.key === 'ArrowDown') {
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1))
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      setHighlightIdx((i) => Math.max(i - 1, 0))
      e.preventDefault()
    } else if (e.key === 'Enter' && filtered[highlightIdx]) {
      pick(filtered[highlightIdx])
      e.preventDefault()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <input
        className={styles.input}
        type="text"
        value={query}
        placeholder={placeholder ?? 'Search sessions…'}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setHighlightIdx(0)
          if (!e.target.value) onSelect(null)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoComplete="off"
      />
      {selected && (
        <button className={styles.clearBtn} onClick={clear} aria-label="Clear selection">×</button>
      )}
      {open && filtered.length > 0 && (
        <ul className={styles.dropdown}>
          {filtered.map((s, i) => (
            <li
              key={s.id}
              className={`${styles.option} ${i === highlightIdx ? styles.optionHighlight : ''} ${s.id === selected?.id ? styles.optionSelected : ''}`}
              onMouseDown={() => pick(s)}
              onMouseEnter={() => setHighlightIdx(i)}
            >
              <div className={styles.optionLabel}>{label(s)}</div>
              <div className={styles.optionMeta}>
                {s.userMessageCount} prompts · {s.createdAt.slice(0, 10)}
                {s.tags.length > 0 && ` · ${s.tags.join(', ')}`}
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && query && filtered.length === 0 && (
        <ul className={styles.dropdown}>
          <li className={styles.noResults}>No matching sessions</li>
        </ul>
      )}
    </div>
  )
}
