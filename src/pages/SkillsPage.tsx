import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { SkillData } from '../types/skill'
import styles from './SkillsPage.module.css'

// Strip YAML frontmatter before rendering markdown
function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
}

type DialogMode = 'create' | 'rename-folder' | 'duplicate' | 'delete' | null

function SkillsPage({ refreshKey }: { refreshKey?: number }) {
  const [skills, setSkills] = useState<SkillData[]>([])
  const [selected, setSelected] = useState<SkillData | null>(null)
  const [search, setSearch] = useState('')
  const [activeFile, setActiveFile] = useState('SKILL.md')
  const [fileContent, setFileContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [editorContent, setEditorContent] = useState('')
  const [unsaved, setUnsaved] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [dialogName, setDialogName] = useState('')
  const [dialogDesc, setDialogDesc] = useState('')
  const [dialogError, setDialogError] = useState('')
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [loading, setLoading] = useState(true)
  const [fileLoading, setFileLoading] = useState(false)

  // Tag state
  const [localTags, setLocalTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [showTagFilter, setShowTagFilter] = useState(false)

  const loadSkills = useCallback(async () => {
    try {
      const data = await window.gridwatchAPI.getSkills()
      setSkills(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadSkills().finally(() => setLoading(false))
    const interval = setInterval(loadSkills, 30_000)
    return () => clearInterval(interval)
  }, [loadSkills])

  // Refresh when parent triggers via refreshKey
  useEffect(() => { if (refreshKey) loadSkills() }, [refreshKey, loadSkills])

  // Load file content when selected skill or active file changes
  useEffect(() => {
    if (!selected) return
    setEditing(false)
    setUnsaved(false)
    setFileLoading(true)
    window.gridwatchAPI.getSkillFile(selected.name, activeFile).then((content) => {
      setFileContent(content ?? '')
      setEditorContent(content ?? '')
    }).catch(() => {
      setFileContent('')
      setEditorContent('')
    }).finally(() => setFileLoading(false))
  }, [selected?.name, activeFile])

  // Keep selected in sync with skills list
  useEffect(() => {
    if (selected) {
      const updated = skills.find((s) => s.name === selected.name)
      if (updated) setSelected(updated)
      else setSelected(null)
    }
  }, [skills])

  // Sync local tags when selected skill changes
  useEffect(() => {
    setLocalTags(selected?.tags ?? [])
    setTagInput('')
  }, [selected?.name])

  const addTag = async (tag: string) => {
    const trimmed = tag.trim().toLowerCase().replace(/\s+/g, '-')
    if (!trimmed || !selected || localTags.includes(trimmed)) return
    const next = [...localTags, trimmed]
    setLocalTags(next)
    await window.gridwatchAPI.setSkillTags(selected.name, next)
    setSkills(prev => prev.map(s => s.name === selected.name ? { ...s, tags: next } : s))
  }

  const removeTag = async (tag: string) => {
    if (!selected) return
    const next = localTags.filter((t) => t !== tag)
    setLocalTags(next)
    await window.gridwatchAPI.setSkillTags(selected.name, next)
    setSkills(prev => prev.map(s => s.name === selected.name ? { ...s, tags: next } : s))
  }

  const allTags = useMemo(() => Array.from(
    new Set(skills.flatMap((s) => s.tags ?? []))
  ).sort(), [skills])

  const totalEnabledTokens = useMemo(() =>
    skills.filter(s => s.enabled).reduce((sum, s) => sum + s.estimatedTokens, 0)
  , [skills])

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const clearTagFilter = () => setSelectedTags(new Set())

  const filtered = useMemo(() => skills.filter((s) => {
    if (selectedTags.size > 0) {
      const skillTags = s.tags ?? []
      for (const tag of selectedTags) {
        if (!skillTags.includes(tag)) return false
      }
    }
    if (!search) return true
    const q = search.toLowerCase()
    return s.displayName.toLowerCase().includes(q)
      || s.description.toLowerCase().includes(q)
      || s.name.toLowerCase().includes(q)
      || (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
  }), [skills, selectedTags, search])

  const handleSelectSkill = (skill: SkillData) => {
    if (unsaved && !confirm('You have unsaved changes. Discard?')) return
    setSelected(skill)
    setActiveFile('SKILL.md')
    setActionError(null)
  }

  const handleSelectFile = (fileName: string) => {
    if (unsaved && !confirm('You have unsaved changes. Discard?')) return
    setActiveFile(fileName)
  }

  const handleSave = async () => {
    if (!selected) return
    const ok = await window.gridwatchAPI.saveSkillFile(selected.name, activeFile, editorContent)
    if (ok) {
      setFileContent(editorContent)
      setUnsaved(false)
      loadSkills()
    } else {
      setActionError('Failed to save file')
    }
  }

  const handleToggle = async () => {
    if (!selected) return
    const result = await window.gridwatchAPI.toggleSkill(selected.name)
    if (result.ok) {
      await loadSkills()
    } else {
      setActionError(result.error ?? 'Toggle failed')
    }
  }

  const handleExport = async () => {
    if (!selected) return
    const result = await window.gridwatchAPI.exportSkill(selected.name)
    if (!result.ok) setActionError(result.error ?? 'Export failed')
  }

  const handleImport = async () => {
    const result = await window.gridwatchAPI.importSkill()
    if (result.ok) {
      await loadSkills()
      const imported = skills.find((s) => s.name === result.name)
      if (imported) setSelected(imported)
    } else if (result.error !== 'Import cancelled') {
      setActionError(result.error ?? 'Import failed')
    }
  }

  const handleDialogSubmit = async () => {
    setDialogError('')

    if (dialogMode === 'create') {
      if (!dialogName.trim()) { setDialogError('Name is required'); return }
      const result = await window.gridwatchAPI.createSkill(dialogName.trim(), dialogDesc.trim())
      if (result.ok) {
        await loadSkills()
        setDialogMode(null)
        // Select the newly created skill
        setTimeout(() => {
          setSelected((prev) => {
            const created = skills.find((s) => s.name === dialogName.trim())
            return created ?? prev
          })
        }, 100)
        // Refetch skills and select
        const refreshed = await window.gridwatchAPI.getSkills()
        setSkills(refreshed)
        const created = refreshed.find((s) => s.name === dialogName.trim())
        if (created) setSelected(created)
      } else {
        setDialogError(result.error ?? 'Failed to create skill')
      }
    }

    if (dialogMode === 'rename-folder') {
      if (!selected) return
      if (!dialogName.trim()) { setDialogError('Name is required'); return }
      const result = await window.gridwatchAPI.renameSkillFolder(selected.name, dialogName.trim())
      if (result.ok) {
        setDialogMode(null)
        const refreshed = await window.gridwatchAPI.getSkills()
        setSkills(refreshed)
        const renamed = refreshed.find((s) => s.name === dialogName.trim())
        if (renamed) setSelected(renamed)
      } else {
        setDialogError(result.error ?? 'Failed to rename skill folder')
      }
    }

    if (dialogMode === 'duplicate') {
      if (!selected) return
      if (!dialogName.trim()) { setDialogError('Name is required'); return }
      const result = await window.gridwatchAPI.duplicateSkill(selected.name, dialogName.trim())
      if (result.ok) {
        setDialogMode(null)
        const refreshed = await window.gridwatchAPI.getSkills()
        setSkills(refreshed)
        const dup = refreshed.find((s) => s.name === dialogName.trim())
        if (dup) setSelected(dup)
      } else {
        setDialogError(result.error ?? 'Failed to duplicate skill')
      }
    }

    if (dialogMode === 'delete') {
      if (!selected) return
      const result = await window.gridwatchAPI.deleteSkill(selected.name)
      if (result.ok) {
        setSelected(null)
        setDialogMode(null)
        await loadSkills()
      } else {
        setDialogError(result.error ?? 'Failed to delete skill')
      }
    }
  }

  const openCreateDialog = () => {
    setDialogMode('create')
    setDialogName('')
    setDialogDesc('')
    setDialogError('')
  }

  const openRenameFolderDialog = () => {
    if (!selected) return
    setDialogMode('rename-folder')
    setDialogName(selected.name)
    setDialogDesc('')
    setDialogError('')
  }

  const openDuplicateDialog = () => {
    if (!selected) return
    setDialogMode('duplicate')
    setDialogName(`${selected.name}-copy`)
    setDialogDesc('')
    setDialogError('')
  }

  const openDeleteDialog = () => {
    setDialogMode('delete')
    setDialogError('')
  }

  const renderMarkdown = (raw: string) => {
    const body = stripFrontmatter(raw)
    const html = DOMPurify.sanitize(marked.parse(body, { async: false }) as string)
    return <div className={styles.markdownView} dangerouslySetInnerHTML={{ __html: html }} />
  }

  return (
    <div className={styles.page}>
      {/* ── List column ── */}
      <div className={`${styles.listColumn} ${!selected ? styles.listColumnFull : ''}`}>
        <div className={styles.toolbar}>
          <button className={styles.toolbarBtn} onClick={openCreateDialog}>+ NEW</button>
          <button className={styles.toolbarBtn} onClick={handleImport}>↓ IMPORT</button>
        </div>
        <div className={styles.searchWrap}>
          <input
            className={styles.searchInput}
            placeholder="Search skills…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {allTags.length > 0 && (
          <button
            className={`${styles.tagFilterToggle} ${selectedTags.size > 0 ? styles.tagFilterActive : ''}`}
            onClick={() => setShowTagFilter(!showTagFilter)}
          >
            {selectedTags.size > 0 ? `▼ TAGS (${selectedTags.size})` : '▶ FILTER BY TAG'}
          </button>
        )}
        {showTagFilter && allTags.length > 0 && (
          <div className={styles.tagFilterPanel}>
            {allTags.map((tag) => (
              <button
                key={tag}
                className={`${styles.tagFilterChip} ${selectedTags.has(tag) ? styles.tagFilterChipSelected : ''}`}
                onClick={() => toggleTag(tag)}
                aria-pressed={selectedTags.has(tag)}
              >
                {selectedTags.has(tag) ? '☑ ' : '☐ '}{tag}
              </button>
            ))}
            {selectedTags.size > 0 && (
              <button className={styles.tagFilterClear} onClick={clearTagFilter}>
                CLEAR
              </button>
            )}
          </div>
        )}
        {!loading && totalEnabledTokens > 0 && (
          <div className={styles.tokenSummary} title="Total estimated tokens consumed by all enabled skills in each session">
            <span className={styles.tokenSummaryLabel}>ENABLED SKILLS COST</span>
            <span className={styles.tokenSummaryValue}>~{totalEnabledTokens.toLocaleString()} tokens</span>
          </div>
        )}
        <div className={styles.list}>
          {loading && <div className={styles.loading}>LOADING...</div>}
          {!loading && filtered.length === 0 && (
            <div className={styles.emptyState}>
              {skills.length === 0 ? 'NO SKILLS FOUND' : 'NO MATCHING SKILLS'}
            </div>
          )}
          {filtered.map((skill) => (
            <div
              key={skill.name}
              className={`${styles.card} ${selected?.name === skill.name ? styles.cardActive : ''} ${!skill.enabled ? styles.cardDisabled : ''}`}
              onClick={() => handleSelectSkill(skill)}
            >
              <div className={styles.cardName}>
                {skill.displayName}
                {!skill.enabled && <span className={styles.disabledBadge}>DISABLED</span>}
              </div>
              {skill.description && (
                <div className={styles.cardDesc}>{skill.description}</div>
              )}
              <div className={styles.cardMeta}>
                <span>{skill.files.length} file{skill.files.length !== 1 ? 's' : ''}</span>
                <span className={styles.tokenEstimate}>~{skill.estimatedTokens.toLocaleString()} tokens</span>
                {skill.usageCount != null && skill.usageCount > 0 && (
                  <span className={styles.usageStat}>{skill.usageCount} use{skill.usageCount !== 1 ? 's' : ''}</span>
                )}
              </div>
              {(skill.tags ?? []).length > 0 && (
                <div className={styles.cardTags}>
                  {skill.tags.map((t) => (
                    <span key={t} className={styles.tagChip}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Detail column ── */}
      {selected && (
        <div className={styles.detailColumn}>
          <div className={styles.detailHeader}>
            <div className={styles.detailTitle}>{selected.displayName}</div>
            {selected.description && (
              <div className={styles.detailDesc}>{selected.description}</div>
            )}
            <div className={styles.detailMeta}>
              {selected.license && <span>License: {selected.license}</span>}
              <span>Modified: {new Date(selected.modifiedAt).toLocaleDateString()}</span>
              {selected.lastUsed && <span>Last used: {new Date(selected.lastUsed).toLocaleDateString()}</span>}
              <span className={styles.tokenEstimate} title="Estimated tokens consumed in each session's context window">~{selected.estimatedTokens.toLocaleString()} tokens</span>
            </div>
          </div>

          <div className={styles.folderSection}>
            <span className={styles.folderLabel}>FOLDER</span>
            <span className={styles.folderValue}>{selected.name}</span>
            <button className={styles.folderRenameBtn} onClick={openRenameFolderDialog} title="Rename folder">✎</button>
          </div>

          <div className={styles.tagsSection}>
            <span className={styles.tagsSectionLabel}>TAGS</span>
            <div className={styles.tagsRow}>
              {localTags.map((t) => (
                <span key={t} className={styles.tagChipDetail}>
                  {t}
                  <button
                    className={styles.tagRemove}
                    onClick={() => removeTag(t)}
                    aria-label={`Remove tag ${t}`}
                  >×</button>
                </span>
              ))}
              <input
                className={styles.tagInput}
                placeholder="+ add tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addTag(tagInput)
                    setTagInput('')
                  }
                }}
              />
            </div>
          </div>

          {actionError && (
            <div className={styles.errorBanner}>
              <span>⚠ {actionError}</span>
              <button className={styles.errorDismiss} onClick={() => setActionError(null)}>×</button>
            </div>
          )}

          <div className={styles.detailActions}>
            <button
              className={`${styles.toggleBtn} ${selected.enabled ? styles.toggleBtnEnabled : styles.toggleBtnDisabled}`}
              onClick={handleToggle}
            >
              {selected.enabled ? '● ENABLED' : '○ DISABLED'}
            </button>
            <button className={styles.actionBtn} onClick={() => setEditing(!editing)}>
              {editing ? '◉ PREVIEW' : '✎ EDIT'}
            </button>
            <button className={styles.actionBtn} onClick={openDuplicateDialog}>⧉ DUPLICATE</button>
            <button className={styles.actionBtn} onClick={handleExport}>↑ EXPORT</button>
            <button className={styles.actionBtnDanger} onClick={openDeleteDialog}>✕ DELETE</button>
          </div>

          {/* File tabs */}
          <div className={styles.fileTabs}>
            {selected.files.map((f) => (
              <button
                key={f.name}
                className={`${styles.fileTab} ${activeFile === f.name ? styles.fileTabActive : ''}`}
                onClick={() => handleSelectFile(f.name)}
              >
                {f.name}
              </button>
            ))}
          </div>

          {/* Content */}
          {fileLoading ? (
            <div className={styles.loading}>LOADING...</div>
          ) : editing ? (
            <div className={styles.editorWrap}>
              {unsaved && (
                <div className={styles.unsavedBanner}>
                  <span>UNSAVED CHANGES</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className={styles.actionBtn} onClick={handleSave}>SAVE</button>
                    <button className={styles.actionBtn} onClick={() => { setEditorContent(fileContent); setUnsaved(false) }}>DISCARD</button>
                  </div>
                </div>
              )}
              <textarea
                ref={editorRef}
                className={styles.editorArea}
                value={editorContent}
                onChange={(e) => { setEditorContent(e.target.value); setUnsaved(e.target.value !== fileContent) }}
                spellCheck={false}
              />
            </div>
          ) : (
            <div className={styles.fileContent}>
              {(activeFile.endsWith('.md') || activeFile.endsWith('.markdown'))
                ? renderMarkdown(fileContent)
                : <pre style={{ color: 'var(--tron-text)', whiteSpace: 'pre-wrap', fontSize: 'calc(12 * var(--font-scale, 1) * 1px)' }}>{fileContent}</pre>
              }
            </div>
          )}
        </div>
      )}

      {/* ── Dialogs ── */}
      {dialogMode && (
        <div className={styles.confirmOverlay} onClick={() => setDialogMode(null)}>
          <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            {dialogMode === 'create' && (
              <>
                <div className={styles.confirmTitle}>CREATE NEW SKILL</div>
                <div className={styles.confirmText}>Skill name (lowercase, hyphens only):</div>
                <input
                  className={styles.confirmInput}
                  value={dialogName}
                  onChange={(e) => setDialogName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-skill-name"
                  autoFocus
                />
                <div className={styles.confirmText}>Description:</div>
                <textarea
                  className={styles.confirmTextarea}
                  value={dialogDesc}
                  onChange={(e) => setDialogDesc(e.target.value)}
                  placeholder="When should this skill be used?"
                />
                {dialogError && <div className={styles.confirmError}>⚠ {dialogError}</div>}
                <div className={styles.confirmActions}>
                  <button className={styles.confirmBtnCancel} onClick={() => setDialogMode(null)}>CANCEL</button>
                  <button className={styles.confirmBtnOk} onClick={handleDialogSubmit}>CREATE</button>
                </div>
              </>
            )}

            {dialogMode === 'rename-folder' && (
              <>
                <div className={styles.confirmTitle}>RENAME SKILL FOLDER</div>
                <div className={styles.confirmText}>
                  This changes the directory name that Copilot uses to reference this skill.
                  The display name in SKILL.md frontmatter is not affected.
                </div>
                <input
                  className={styles.confirmInput}
                  value={dialogName}
                  onChange={(e) => setDialogName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="skill-folder-name"
                  autoFocus
                />
                {dialogError && <div className={styles.confirmError}>⚠ {dialogError}</div>}
                <div className={styles.confirmActions}>
                  <button className={styles.confirmBtnCancel} onClick={() => setDialogMode(null)}>CANCEL</button>
                  <button className={styles.confirmBtnOk} onClick={handleDialogSubmit}>RENAME</button>
                </div>
              </>
            )}

            {dialogMode === 'duplicate' && (
              <>
                <div className={styles.confirmTitle}>DUPLICATE SKILL</div>
                <div className={styles.confirmText}>New skill name:</div>
                <input
                  className={styles.confirmInput}
                  value={dialogName}
                  onChange={(e) => setDialogName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="skill-name-copy"
                  autoFocus
                />
                {dialogError && <div className={styles.confirmError}>⚠ {dialogError}</div>}
                <div className={styles.confirmActions}>
                  <button className={styles.confirmBtnCancel} onClick={() => setDialogMode(null)}>CANCEL</button>
                  <button className={styles.confirmBtnOk} onClick={handleDialogSubmit}>DUPLICATE</button>
                </div>
              </>
            )}

            {dialogMode === 'delete' && (
              <>
                <div className={styles.confirmTitle}>DELETE SKILL</div>
                <div className={styles.confirmText}>
                  Are you sure you want to permanently delete <strong>{selected?.displayName}</strong>?
                  This cannot be undone.
                </div>
                {dialogError && <div className={styles.confirmError}>⚠ {dialogError}</div>}
                <div className={styles.confirmActions}>
                  <button className={styles.confirmBtnCancel} onClick={() => setDialogMode(null)}>CANCEL</button>
                  <button className={styles.confirmBtnDanger} onClick={handleDialogSubmit}>DELETE</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(SkillsPage)
