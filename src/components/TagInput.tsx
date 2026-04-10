import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import styles from './TagInput.module.css'

interface Props {
  /** Tags already on the current item — excluded from suggestions */
  currentTags: string[]
  /** All known tags across all items — used for typeahead suggestions */
  allTags: string[]
  /** Called with the normalised tag string when a tag should be added */
  onAdd: (tag: string) => void
  className?: string
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

export default function TagInput({ currentTags, allTags, onAdd, className }: Props) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const suggestions = useMemo(() => {
    const normalised = normalize(value)
    if (!normalised) return []
    return allTags.filter(
      (t) => !currentTags.includes(t) && t.includes(normalised),
    )
  }, [allTags, currentTags, value])

  const commit = useCallback(
    (raw: string) => {
      const tag = normalize(raw)
      if (!tag) return
      onAdd(tag)
      setValue('')
      setOpen(false)
      setActiveIndex(-1)
    },
    [onAdd],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (activeIndex >= 0 && suggestions[activeIndex] !== undefined) {
        commit(suggestions[activeIndex])
      } else {
        commit(value)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  // Reset active index when suggestions change
  useEffect(() => {
    setActiveIndex(-1)
  }, [value])

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  // Close dropdown when clicking outside
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
        ref={inputRef}
        className={styles.input}
        placeholder="+ add tag"
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
        aria-controls={showDropdown ? 'tag-suggestions' : undefined}
        aria-activedescendant={
          activeIndex >= 0 ? `tag-suggestion-${activeIndex}` : undefined
        }
      />
      {showDropdown && (
        <ul
          ref={listRef}
          id="tag-suggestions"
          role="listbox"
          className={styles.dropdown}
        >
          {suggestions.map((tag, i) => (
            <li
              key={tag}
              id={`tag-suggestion-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`${styles.option} ${i === activeIndex ? styles.optionActive : ''}`}
              onMouseDown={(e) => {
                // Prevent input blur before click handler runs, which would close the dropdown prematurely
                e.preventDefault()
                commit(tag)
              }}
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
