import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { SkillData } from '../types/skill'
import type { CustomAgentData } from '../types/agent'
import TagInput from '../components/TagInput'
import RelationPicker from '../components/RelationPicker'
import styles from './SkillsPage.module.css'

// Strip YAML frontmatter before rendering markdown
function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
}

type DialogMode = 'create' | 'rename-folder' | 'duplicate' | 'delete' | null

function SkillsPage({ refreshKey, onNavigateToAgent }: { refreshKey?: number; onNavigateToAgent?: (agentName: string) => void }) {
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
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [showTagFilter, setShowTagFilter] = useState(false)

  // Relationship state
  const [agents, setAgents] = useState<CustomAgentData[]>([])
  const [localChildSkills, setLocalChildSkills] = useState<string[]>([])
  const [localLinkedAgents, setLocalLinkedAgents] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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
  }, [selected?.name])

  // Load custom agents once for relationship linking
  useEffect(() => {
    window.gridwatchAPI.getCustomAgents().then(setAgents).catch(() => { /* ignore */ })
  }, [])

  // Sync local relations when selected skill changes
  useEffect(() => {
    setLocalChildSkills(selected?.childSkills ?? [])
    setLocalLinkedAgents(selected?.linkedAgents ?? [])
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

  const hasVisibleSkills = filtered.length > 0
  const allVisibleSkillsEnabled = hasVisibleSkills && filtered.every((s) => s.enabled)

  // ── Relationship view model ──────────────────────────────────────────
  const filterActive = search.trim() !== '' || selectedTags.size > 0

  const nameToSkill = useMemo(() => {
    const m = new Map<string, SkillData>()
    for (const s of skills) m.set(s.name, s)
    return m
  }, [skills])

  const childrenOf = useCallback((s: SkillData): SkillData[] =>
    (s.childSkills ?? [])
      .map((n) => nameToSkill.get(n))
      .filter((c): c is SkillData => !!c)
  , [nameToSkill])

  // Names that are a resolved child of at least one skill — hidden from top level
  const childNameSet = useMemo(() => {
    const set = new Set<string>()
    for (const s of skills) {
      for (const c of (s.childSkills ?? [])) {
        if (nameToSkill.has(c)) set.add(c)
      }
    }
    return set
  }, [skills, nameToSkill])

  const topLevelSkills = useMemo(() => {
    const roots = skills.filter((s) => !childNameSet.has(s.name))
    // Safety net: surface any skills unreachable from roots (e.g. trapped in a
    // manually-edited cyclic gridwatch.json) so they never silently disappear.
    const reachable = new Set<string>()
    const visit = (s: SkillData) => {
      if (reachable.has(s.name)) return
      reachable.add(s.name)
      for (const c of childrenOf(s)) visit(c)
    }
    roots.forEach(visit)
    const orphans = skills.filter((s) => !reachable.has(s.name))
    return [...roots, ...orphans]
  }, [skills, childNameSet, childrenOf])

  const matchSkill = useCallback((s: SkillData): boolean => {
    if (selectedTags.size > 0) {
      const st = s.tags ?? []
      for (const tag of selectedTags) if (!st.includes(tag)) return false
    }
    if (!search) return true
    const q = search.toLowerCase()
    return s.displayName.toLowerCase().includes(q)
      || s.description.toLowerCase().includes(q)
      || s.name.toLowerCase().includes(q)
      || (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
  }, [selectedTags, search])

  // A node is visible while filtering if it matches or any descendant matches
  const isNodeVisible = useCallback((s: SkillData, seen: Set<string>): boolean => {
    if (matchSkill(s)) return true
    if (seen.has(s.name)) return false
    seen.add(s.name)
    return childrenOf(s).some((c) => isNodeVisible(c, seen))
  }, [matchSkill, childrenOf])

  const toggleExpand = (name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // Cycle detection: is `targetName` reachable from `rootName` via child links?
  const isDescendant = useCallback((rootName: string, targetName: string, seen: Set<string>): boolean => {
    const root = nameToSkill.get(rootName)
    if (!root) return false
    for (const cn of (root.childSkills ?? [])) {
      if (cn === targetName) return true
      if (!seen.has(cn)) {
        seen.add(cn)
        if (isDescendant(cn, targetName, seen)) return true
      }
    }
    return false
  }, [nameToSkill])

  const wouldCycle = useCallback((parentName: string, childName: string): boolean =>
    childName === parentName || isDescendant(childName, parentName, new Set())
  , [isDescendant])

  const childOptions = useMemo(() => {
    if (!selected) return []
    return skills
      .filter((s) => s.name !== selected.name
        && !localChildSkills.includes(s.name)
        && !wouldCycle(selected.name, s.name))
      .map((s) => ({ id: s.name, label: s.displayName }))
  }, [skills, selected, localChildSkills, wouldCycle])

  const agentOptions = useMemo(() =>
    agents
      .filter((a) => !localLinkedAgents.includes(a.name))
      .map((a) => ({ id: a.name, label: a.displayName || a.name }))
  , [agents, localLinkedAgents])

  // Skills that declare the currently-selected skill as a child
  const parentSkills = useMemo(() => {
    if (!selected) return []
    return skills.filter((s) => (s.childSkills ?? []).includes(selected.name))
  }, [skills, selected])

  const persistRelations = useCallback(async (children: string[], linked: string[]) => {
    if (!selected) return
    const name = selected.name
    const ok = await window.gridwatchAPI.setSkillRelations(name, children, linked)
    if (!ok) setActionError('Failed to save relationships')
    // Reconcile with what was actually persisted (the main process sanitises
    // out invalid/missing/cyclic entries), so the UI always reflects disk.
    try {
      const fresh = await window.gridwatchAPI.getSkills()
      setSkills(fresh)
      const updated = fresh.find((s) => s.name === name)
      if (updated) {
        setLocalChildSkills(updated.childSkills ?? [])
        setLocalLinkedAgents(updated.linkedAgents ?? [])
      }
    } catch { /* ignore */ }
  }, [selected])

  const addChild = (name: string) => {
    if (!selected || localChildSkills.includes(name) || name === selected.name) return
    if (wouldCycle(selected.name, name)) {
      setActionError('Cannot add child: would create a circular dependency')
      return
    }
    const next = [...localChildSkills, name]
    setLocalChildSkills(next)
    void persistRelations(next, localLinkedAgents)
  }

  const removeChild = (name: string) => {
    const next = localChildSkills.filter((n) => n !== name)
    setLocalChildSkills(next)
    void persistRelations(next, localLinkedAgents)
  }

  const addLinkedAgent = (name: string) => {
    if (!selected || localLinkedAgents.includes(name)) return
    const next = [...localLinkedAgents, name]
    setLocalLinkedAgents(next)
    void persistRelations(localChildSkills, next)
  }

  const removeLinkedAgent = (name: string) => {
    const next = localLinkedAgents.filter((n) => n !== name)
    setLocalLinkedAgents(next)
    void persistRelations(localChildSkills, next)
  }

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

  const handleToggleVisible = async () => {
    const visibleSkills = filtered
    if (visibleSkills.length === 0) return

    const shouldDisable = visibleSkills.every((s) => s.enabled)
    const skillsToToggle = shouldDisable
      ? visibleSkills.filter((s) => s.enabled)
      : visibleSkills.filter((s) => !s.enabled)

    if (skillsToToggle.length === 0) return

    const results = await Promise.all(
      skillsToToggle.map((skill) => window.gridwatchAPI.toggleSkill(skill.name))
    )
    const failed = results.find((result) => !result.ok)

    if (failed) {
      setActionError(failed.error ?? `Failed to ${shouldDisable ? 'disable' : 'enable'} all visible skills`)
    }

    await loadSkills()
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
    const html = DOMPurify.sanitize(marked.parse(body, { async: false }) as string, {
      FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'textarea', 'select', 'button'],
      FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
    })
    return <div className={styles.markdownView} dangerouslySetInnerHTML={{ __html: html }} />
  }

  const renderSkillCard = (skill: SkillData, depth: number, hasKids: boolean, open: boolean) => (
    <div
      className={`${styles.card} ${depth > 0 ? styles.childCard : ''} ${selected?.name === skill.name ? styles.cardActive : ''} ${!skill.enabled ? styles.cardDisabled : ''}`}
      onClick={() => handleSelectSkill(skill)}
    >
      <div className={styles.cardName}>
        {hasKids && (
          <button
            className={styles.parentToggle}
            onClick={(e) => toggleExpand(skill.name, e)}
            aria-label={open ? 'Collapse child skills' : 'Expand child skills'}
            aria-expanded={open}
          >
            {open ? '▼' : '▶'}
          </button>
        )}
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
  )

  const renderSkillNode = (skill: SkillData, depth: number, seen: Set<string>): React.ReactNode => {
    if (seen.has(skill.name)) return null // cycle guard
    const nextSeen = new Set(seen).add(skill.name)
    const kids = childrenOf(skill).filter((c) => !nextSeen.has(c.name))
    const visibleKids = filterActive ? kids.filter((c) => isNodeVisible(c, new Set())) : kids
    const hasKids = kids.length > 0
    // While filtering, force-expand parents that have a matching descendant
    const open = filterActive ? visibleKids.length > 0 : expanded.has(skill.name)
    return (
      <div key={skill.name}>
        {renderSkillCard(skill, depth, hasKids, open)}
        {hasKids && open && visibleKids.length > 0 && (
          <div className={styles.childGroup}>
            {visibleKids.map((c) => renderSkillNode(c, depth + 1, nextSeen))}
          </div>
        )}
      </div>
    )
  }

  const visibleTopLevel = filterActive
    ? topLevelSkills.filter((s) => isNodeVisible(s, new Set()))
    : topLevelSkills

  return (
    <div className={styles.page}>
      {/* ── List column ── */}
      <div className={`${styles.listColumn} ${!selected ? styles.listColumnFull : ''}`}>
        <div className={styles.toolbar}>
          <button className={styles.toolbarBtn} onClick={openCreateDialog}>+ NEW</button>
          <button className={styles.toolbarBtn} onClick={handleImport}>↓ IMPORT</button>
          {!loading && (
            <button
              className={`${styles.toolbarBtn} ${allVisibleSkillsEnabled ? styles.toolbarBtnDestructive : ''}`}
              onClick={handleToggleVisible}
              disabled={!hasVisibleSkills}
            >
              {allVisibleSkillsEnabled ? '○ DISABLE ALL' : '● ENABLE ALL'}
            </button>
          )}
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
          {!loading && visibleTopLevel.map((skill) => renderSkillNode(skill, 0, new Set()))}
        </div>
      </div>

      {/* ── Detail column ── */}
      {selected && (
        <div className={styles.detailColumn}>
          <div className={styles.detailHeader}>
            <div className={styles.detailTitleRow}>
              <div className={styles.detailTitle}>{selected.displayName}</div>
              <button
                className={styles.openFolderBtn}
                onClick={() => void window.gridwatchAPI.openItemFolder('skill', selected.name).catch(() => {})}
                title="Open skill folder"
                aria-label="Open skill folder"
              >⊞</button>
            </div>
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
              <TagInput
                currentTags={localTags}
                allTags={allTags}
                onAdd={(tag) => { addTag(tag) }}
              />
            </div>
          </div>

          <div className={styles.relationsSection}>
            {parentSkills.length > 0 && (
              <div className={styles.relationGroup}>
                <span className={styles.tagsSectionLabel}>PARENT SKILLS</span>
                <div className={styles.tagsRow}>
                  {parentSkills.map((parent) => (
                    <span
                      key={parent.name}
                      className={`${styles.relationChip} ${styles.relationChipClickable}`}
                      onClick={() => handleSelectSkill(parent)}
                      title={`Open ${parent.displayName}`}
                    >
                      ⬑ {parent.displayName}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.relationGroup}>
              <span className={styles.tagsSectionLabel}>CHILD SKILLS</span>
              <div className={styles.tagsRow}>
                {localChildSkills.map((name) => {
                  const child = nameToSkill.get(name)
                  return (
                    <span
                      key={name}
                      className={`${styles.relationChip} ${child ? '' : styles.relationChipMissing} ${child ? styles.relationChipClickable : ''}`}
                      onClick={child ? () => handleSelectSkill(child) : undefined}
                      title={child ? `Open ${child.displayName}` : 'Skill no longer exists'}
                    >
                      {child ? child.displayName : `${name} (missing)`}
                      <button
                        className={styles.tagRemove}
                        onClick={(e) => { e.stopPropagation(); removeChild(name) }}
                        aria-label={`Remove child skill ${name}`}
                      >×</button>
                    </span>
                  )
                })}
                <RelationPicker
                  options={childOptions}
                  onAdd={addChild}
                  placeholder="+ link skill"
                />
              </div>
            </div>

            <div className={styles.relationGroup}>
              <span className={styles.tagsSectionLabel}>LINKED AGENTS</span>
              <div className={styles.tagsRow}>
                {localLinkedAgents.map((name) => {
                  const agent = agents.find((a) => a.name === name)
                  return (
                    <span
                      key={name}
                      className={`${styles.relationChip} ${agent ? styles.relationChipClickable : styles.relationChipMissing}`}
                      onClick={agent && onNavigateToAgent ? () => onNavigateToAgent(name) : undefined}
                      title={agent ? `Open agent ${agent.displayName || agent.name}` : 'Agent no longer exists'}
                    >
                      {agent ? (agent.displayName || agent.name) : `${name} (missing)`}
                      <button
                        className={styles.tagRemove}
                        onClick={(e) => { e.stopPropagation(); removeLinkedAgent(name) }}
                        aria-label={`Remove linked agent ${name}`}
                      >×</button>
                    </span>
                  )
                })}
                <RelationPicker
                  options={agentOptions}
                  onAdd={addLinkedAgent}
                  placeholder="+ link agent"
                />
              </div>
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
