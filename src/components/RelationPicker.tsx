import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import styles from './TagInput.module.css'

export interface RelationOption {
  /** Canonical id committed on selection */
  id: string
  /** Human-readable label shown in the dropdown */
  label: string
}

interface Props {
  /** Selectable options — callers should pre-exclude already-linked ids */
  options: RelationOption[]
  /** Called with the canonical id when an option is chosen */
  onAdd: (id: string) => void
  placeholder?: string
  className?: string
}

/**
 * Typeahead that only allows selecting from a fixed set of existing options.
 * Unlike TagInput, free-typed values are never committed — the user can only
 * pick an option that actually exists.
 */
export default function RelationPicker({ options, onAdd, placeholder, className }: Props) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.id.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    )
  }, [options, value])

  const commit = useCallback(
    (option: RelationOption | undefined) => {
      if (!option) return
      onAdd(option.id)
      setValue('')
      setOpen(false)
      setActiveIndex(-1)
    },
    [onAdd],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0) commit(suggestions[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  useEffect(() => {
    setActiveIndex(-1)
  }, [value])

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const showDropdown = open && suggestions.length > 0

  return (
    <div ref={containerRef} className={`${styles.wrapper} ${className ?? ''}`}>
      <input
        className={styles.input}
        placeholder={placeholder ?? '+ add'}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-activedescendant={activeIndex >= 0 ? `relation-option-${activeIndex}` : undefined}
      />
      {showDropdown && (
        <ul ref={listRef} role="listbox" className={styles.dropdown}>
          {suggestions.map((option, i) => (
            <li
              key={option.id}
              id={`relation-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`${styles.option} ${i === activeIndex ? styles.optionActive : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                commit(option)
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
