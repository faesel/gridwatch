import { useState, useEffect, useCallback, memo } from 'react'
import type { AllowedDirectory } from '../types/dirs'
import type { AutoTagRule } from '../types/autotag'
import TagInput from '../components/TagInput'
import styles from './SettingsPage.module.css'

export interface AppSettings {
  zoom: number        // 0.8 – 1.4
  fontSize: number    // 10 – 16 (px, overrides body font-size)
  spacing: 'compact' | 'default' | 'comfortable'
  theme: 'grid' | 'programs'
}

export const DEFAULT_SETTINGS: AppSettings = {
  zoom: 1.0,
  fontSize: 13,
  spacing: 'default',
  theme: 'grid',
}

const STORAGE_KEY = 'gridwatch-settings'

async function saveApiKey(key: string): Promise<void> {
  try { await window.gridwatchAPI.saveToken(key) } catch { /* ignore */ }
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export function applySettings(s: AppSettings): void {
  // Use Electron's webFrame zoom — correctly scales viewport without clipping
  if (typeof window !== 'undefined' && window.gridwatchAPI?.setZoomFactor) {
    window.gridwatchAPI.setZoomFactor(s.zoom)
  }
  // Scale all font sizes via CSS variable (base is 13px, so scale = chosen/13)
  document.documentElement.style.setProperty('--font-scale', String(s.fontSize / 13))
  document.documentElement.setAttribute('data-density', s.spacing)
  document.documentElement.setAttribute('data-theme', s.theme ?? 'grid')
}

const ZOOM_PRESETS = [
  { label: 'XS', value: 0.8 },
  { label: 'SM', value: 0.9 },
  { label: 'MD', value: 1.0 },
  { label: 'LG', value: 1.1 },
  { label: 'XL', value: 1.2 },
  { label: '2XL', value: 1.35 },
]

const FONT_PRESETS = [
  { label: '10', value: 10 },
  { label: '11', value: 11 },
  { label: '12', value: 12 },
  { label: '13', value: 13 },
  { label: '14', value: 14 },
  { label: '15', value: 15 },
  { label: '16', value: 16 },
]

const SPACING_PRESETS: { label: string; value: AppSettings['spacing'] }[] = [
  { label: 'COMPACT', value: 'compact' },
  { label: 'DEFAULT', value: 'default' },
  { label: 'COMFORTABLE', value: 'comfortable' },
]

interface Props {
  settings: AppSettings
  onChange: (s: AppSettings) => void
}

function SettingsPage({ settings, onChange }: Props) {
  const [tokenInput, setTokenInput] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [dirs, setDirs] = useState<AllowedDirectory[]>([])
  const [addingDir, setAddingDir] = useState(false)
  const [removingDir, setRemovingDir] = useState<string | null>(null)
  const [dirError, setDirError] = useState<string | null>(null)

  const [rules, setRules] = useState<AutoTagRule[]>([])
  const [knownTags, setKnownTags] = useState<string[]>([])
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [pendingTags, setPendingTags] = useState<string[]>([])
  const [savingRule, setSavingRule] = useState(false)
  const [removingRule, setRemovingRule] = useState<string | null>(null)
  const [ruleError, setRuleError] = useState<string | null>(null)

  useEffect(() => { window.gridwatchAPI.hasToken().then(setHasToken) }, [])

  const loadDirs = useCallback(async () => {
    try {
      const data = await window.gridwatchAPI.getAllowedDirs()
      setDirs(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadDirs() }, [loadDirs])

  const handleAddDir = useCallback(async () => {
    setAddingDir(true)
    setDirError(null)
    try {
      const result = await window.gridwatchAPI.addAllowedDir()
      if (result.ok) {
        await loadDirs()
      } else if (result.error && result.error !== 'Cancelled') {
        setDirError(result.error)
      }
    } catch { /* ignore */ }
    setAddingDir(false)
  }, [loadDirs])

  const handleRemoveDir = useCallback(async (dirPath: string) => {
    setRemovingDir(dirPath)
    setDirError(null)
    try {
      const result = await window.gridwatchAPI.removeAllowedDir(dirPath)
      if (result.ok) {
        await loadDirs()
      } else if (result.error) {
        setDirError(result.error)
      }
    } catch { /* ignore */ }
    setRemovingDir(null)
  }, [loadDirs])

  const loadRules = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([
        window.gridwatchAPI.getAutoTagRules(),
        window.gridwatchAPI.getKnownTags(),
      ])
      setRules(r)
      setKnownTags(t)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadRules() }, [loadRules])

  const handlePickDir = useCallback(async () => {
    setRuleError(null)
    try {
      const result = await window.gridwatchAPI.pickAutoTagDirectory()
      if (result.ok && result.path) {
        setPendingPath(result.path)
        setPendingTags([])
      } else if (result.error && result.error !== 'Cancelled') {
        setRuleError(result.error)
      }
    } catch { /* ignore */ }
  }, [])

  const addPendingTag = useCallback((tag: string) => {
    setPendingTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]))
  }, [])

  const removePendingTag = useCallback((tag: string) => {
    setPendingTags((prev) => prev.filter((t) => t !== tag))
  }, [])

  const cancelRule = useCallback(() => {
    setPendingPath(null)
    setPendingTags([])
    setRuleError(null)
  }, [])

  const handleSaveRule = useCallback(async () => {
    if (!pendingPath) return
    if (pendingTags.length === 0) {
      setRuleError('Enter at least one tag')
      return
    }
    setSavingRule(true)
    setRuleError(null)
    try {
      const result = await window.gridwatchAPI.addAutoTagRule(pendingPath, pendingTags)
      if (result.ok) {
        setPendingPath(null)
        setPendingTags([])
        await loadRules()
      } else if (result.error) {
        setRuleError(result.error)
      }
    } catch { /* ignore */ }
    setSavingRule(false)
  }, [pendingPath, pendingTags, loadRules])

  const handleRemoveRule = useCallback(async (id: string) => {
    setRemovingRule(id)
    setRuleError(null)
    try {
      const result = await window.gridwatchAPI.removeAutoTagRule(id)
      if (result.ok) {
        await loadRules()
      } else if (result.error) {
        setRuleError(result.error)
      }
    } catch { /* ignore */ }
    setRemovingRule(null)
  }, [loadRules])

  const update = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch }
    onChange(next)
    saveSettings(next)
    applySettings(next)
  }

  const reset = () => {
    update({ ...DEFAULT_SETTINGS })
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageTitle}>SETTINGS</div>

      {/* UI Scale */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>UI SCALE</div>
        <div className={styles.description}>
          Scales the entire interface — fonts, spacing, and all elements together.
        </div>
        <div className={styles.presetRow}>
          {ZOOM_PRESETS.map((p) => (
            <button
              key={p.value}
              className={`${styles.presetBtn} ${settings.zoom === p.value ? styles.presetBtnActive : ''}`}
              onClick={() => update({ zoom: p.value })}
            >
              {p.label}
              <span className={styles.presetSub}>{Math.round(p.value * 100)}%</span>
            </button>
          ))}
        </div>
      </div>

      {/* Font Size */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>BASE FONT SIZE</div>
        <div className={styles.description}>
          Adjusts text size independently of the overall scale.
        </div>
        <div className={styles.presetRow}>
          {FONT_PRESETS.map((p) => (
            <button
              key={p.value}
              className={`${styles.presetBtn} ${settings.fontSize === p.value ? styles.presetBtnActive : ''}`}
              onClick={() => update({ fontSize: p.value })}
            >
              {p.label}px
            </button>
          ))}
        </div>
        <div className={styles.preview} style={{ fontSize: settings.fontSize }}>
          The quick brown fox — {settings.fontSize}px
        </div>
      </div>

      {/* Density / Spacing */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>DENSITY</div>
        <div className={styles.description}>
          Controls padding and spacing between elements.
        </div>
        <div className={styles.presetRow}>
          {SPACING_PRESETS.map((p) => (
            <button
              key={p.value}
              className={`${styles.presetBtn} ${styles.presetBtnWide} ${settings.spacing === p.value ? styles.presetBtnActive : ''}`}
              onClick={() => update({ spacing: p.value })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Theme */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>THEME</div>
        <div className={styles.description}>
          Choose your allegiance.
        </div>
        <div className={styles.themeRow}>
          <button
            className={`${styles.themeBtn} ${styles.themeBtnGrid} ${settings.theme === 'grid' ? styles.themeBtnActive : ''}`}
            onClick={() => update({ theme: 'grid' })}
          >
            <span className={styles.themeIcon}>◈</span>
            <span className={styles.themeLabel}>THE GRID</span>
            <span className={styles.themeSub}>Cyan / Blue</span>
          </button>
          <button
            className={`${styles.themeBtn} ${styles.themeBtnPrograms} ${settings.theme === 'programs' ? styles.themeBtnActive : ''}`}
            onClick={() => update({ theme: 'programs' })}
          >
            <span className={styles.themeIcon}>⬡</span>
            <span className={styles.themeLabel}>PROGRAMS</span>
            <span className={styles.themeSub}>Red / Crimson</span>
          </button>
        </div>
      </div>

      {/* GitHub Token for Insights */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>GITHUB PERSONAL ACCESS TOKEN</div>
        <div className={styles.description}>
          Required for the Insights tab. Uses GitHub Models API (free with Copilot subscription).
          Create a token at <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tron-cyan)' }}>github.com/settings/tokens</a> — no scopes needed.
        </div>
        <div className={styles.apiKeyRow}>
          <input
            className={styles.apiKeyInput}
            type="password"
            placeholder={hasToken ? '••••••••••••••••' : 'ghp_...'}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onBlur={() => {
              if (tokenInput) {
                saveApiKey(tokenInput)
                setTokenInput('')
                setHasToken(true)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tokenInput) {
                saveApiKey(tokenInput)
                setTokenInput('')
                setHasToken(true)
              }
            }}
            spellCheck={false}
            autoComplete="off"
          />
          {hasToken && (
            <button
              className={styles.apiKeyClear}
              onClick={() => { saveApiKey(''); setHasToken(false); setTokenInput('') }}
            >
              CLEAR
            </button>
          )}
        </div>
        {hasToken && <div className={styles.apiKeyStatus}>✓ TOKEN SAVED</div>}
      </div>

      {/* Trusted Directories */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>TRUSTED DIRECTORIES</div>
        <div className={styles.description}>
          Directories that Copilot CLI can access without prompting. Stored in <code style={{ color: 'var(--tron-cyan)', fontSize: 'inherit' }}>~/.copilot/config.json</code> under <code style={{ color: 'var(--tron-cyan)', fontSize: 'inherit' }}>trustedFolders</code>.
        </div>

        {dirError && (
          <div className={styles.dirError}>
            {dirError}
            <button
              className={styles.dirErrorDismiss}
              onClick={() => setDirError(null)}
              aria-label="Dismiss error"
            >×</button>
          </div>
        )}

        <div className={styles.dirList}>
          {dirs.length === 0 && (
            <div className={styles.dirEmpty}>No trusted directories configured</div>
          )}
          {dirs.map((d) => (
            <div key={d.path} className={styles.dirRow}>
              <span className={styles.dirPath} title={d.path}>{d.path}</span>
              <span className={d.exists ? styles.dirExists : styles.dirMissing}>
                {d.exists ? '✓' : '✗'}
              </span>
              <button
                className={styles.dirRemoveBtn}
                onClick={() => handleRemoveDir(d.path)}
                disabled={removingDir === d.path}
                title="Remove from trusted list"
                aria-label={`Remove ${d.path} from trusted directories`}
              >
                {removingDir === d.path ? '…' : '✕'}
              </button>
            </div>
          ))}
        </div>

        <button
          className={styles.dirAddBtn}
          onClick={handleAddDir}
          disabled={addingDir}
        >
          {addingDir ? 'ADDING…' : '+ ADD DIRECTORY'}
        </button>
      </div>

      {/* Auto-Tag Rules */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>AUTO-TAG RULES</div>
        <div className={styles.description}>
          Automatically apply tags to any session whose working directory falls under a chosen folder
          (including its subdirectories). Auto-tags appear on sessions with a dashed outline and a ⛓ marker, and
          can only be changed here. Matching is case-insensitive on macOS and Windows.
        </div>

        {ruleError && (
          <div className={styles.dirError}>
            {ruleError}
            <button
              className={styles.dirErrorDismiss}
              onClick={() => setRuleError(null)}
              aria-label="Dismiss error"
            >×</button>
          </div>
        )}

        <div className={styles.dirList}>
          {rules.length === 0 && !pendingPath && (
            <div className={styles.dirEmpty}>No auto-tag rules configured</div>
          )}
          {rules.map((rule) => (
            <div key={rule.id} className={styles.dirRow}>
              <span className={styles.dirPath} title={rule.path}>{rule.path}</span>
              <span className={styles.ruleTags}>
                {rule.tags.map((t) => (
                  <span key={t} className={styles.ruleTagChip}>{t}</span>
                ))}
              </span>
              <button
                className={styles.dirRemoveBtn}
                onClick={() => handleRemoveRule(rule.id)}
                disabled={removingRule === rule.id}
                title="Remove this rule"
                aria-label={`Remove auto-tag rule for ${rule.path}`}
              >
                {removingRule === rule.id ? '…' : '✕'}
              </button>
            </div>
          ))}
        </div>

        {pendingPath ? (
          <div className={styles.ruleEditor}>
            <div className={styles.dirPath} title={pendingPath}>{pendingPath}</div>
            <div className={styles.ruleTagsRow}>
              {pendingTags.map((t) => (
                <span key={t} className={styles.tagChipDetail}>
                  {t}
                  <button
                    className={styles.tagRemove}
                    onClick={() => removePendingTag(t)}
                    aria-label={`Remove tag ${t}`}
                  >×</button>
                </span>
              ))}
              <TagInput
                currentTags={pendingTags}
                allTags={knownTags}
                onAdd={addPendingTag}
              />
            </div>
            <div className={styles.ruleActions}>
              <button
                className={styles.dirAddBtn}
                onClick={handleSaveRule}
                disabled={savingRule || pendingTags.length === 0}
              >
                {savingRule ? 'SAVING…' : 'SAVE RULE'}
              </button>
              <button
                className={styles.ruleCancelBtn}
                onClick={cancelRule}
                disabled={savingRule}
              >
                CANCEL
              </button>
            </div>
          </div>
        ) : (
          <button
            className={styles.dirAddBtn}
            onClick={handlePickDir}
          >
            + ADD RULE
          </button>
        )}
      </div>

      {/* Reset */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>RESET</div>
        <div className={styles.description}>
          Restore all display settings to their defaults.
        </div>
        <button className={styles.resetBtn} onClick={reset}>
          RESTORE DEFAULTS
        </button>
      </div>
    </div>
  )
}

export default memo(SettingsPage)
