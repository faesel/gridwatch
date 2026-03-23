import { useState } from 'react'
import type { SessionSummary } from '../types/session'
import styles from './TagFilter.module.css'

interface Props {
  sessions: SessionSummary[]
  selectedTags: Set<string>
  onChange: (tags: Set<string>) => void
}

export default function TagFilter({ sessions, selectedTags, onChange }: Props) {
  const [open, setOpen] = useState(false)

  const allTags = Array.from(
    new Set(sessions.flatMap(s => s.tags ?? []))
  ).sort()

  if (allTags.length === 0) return null

  const toggle = (tag: string) => {
    const next = new Set(selectedTags)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    onChange(next)
  }

  return (
    <div className={styles.tagFilterRow}>
      <button
        className={`${styles.tagFilterToggle} ${selectedTags.size > 0 ? styles.tagFilterActive : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        ⊞ TAGS{selectedTags.size > 0 ? ` (${selectedTags.size})` : ''}
      </button>
      {open && (
        <div className={styles.tagFilterPanel}>
          {allTags.map(tag => (
            <button
              key={tag}
              className={`${styles.tagFilterChip} ${selectedTags.has(tag) ? styles.tagFilterChipSelected : ''}`}
              onClick={() => toggle(tag)}
              aria-pressed={selectedTags.has(tag)}
            >
              {selectedTags.has(tag) ? '☑ ' : '☐ '}{tag}
            </button>
          ))}
          {selectedTags.size > 0 && (
            <button className={styles.tagFilterClear} onClick={() => onChange(new Set())}>
              CLEAR
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function filterByTags(sessions: SessionSummary[], selectedTags: Set<string>): SessionSummary[] {
  if (selectedTags.size === 0) return sessions
  return sessions.filter(s =>
    (s.tags ?? []).some(t => selectedTags.has(t))
  )
}
