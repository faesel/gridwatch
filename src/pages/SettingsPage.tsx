import { useState, useEffect, useCallback, memo } from 'react'
import type { AllowedDirectory } from '../types/dirs'
import styles from './SettingsPage.module.css'

export interface AppSettings {
  zoom: number        // 0.8 – 1.4
  fontSize: number    // 10 – 16 (px, overrides body font-size)
  spacing: 'compact' | 'default' | 'comfortable'
  theme: 'grid' | 'programs'
  summaryMaxLength: number
  notesMaxLength: number
  skillFileMaxBytes: number
}

const SUMMARY_LIMIT_RANGE = { min: 100, max: 5_000, defaultValue: 1_000 } as const
const NOTES_LIMIT_RANGE = { min: 10_000, max: 500_000, defaultValue: 100_000 } as const
const SKILL_SIZE_LIMIT_RANGE = { min: 65_536, max: 2_097_152, defaultValue: 524_288 } as const

export const DEFAULT_SETTINGS: AppSettings = {
  zoom: 1.0,
  fontSize: 13,
  spacing: 'default',
  theme: 'grid',
  summaryMaxLength: SUMMARY_LIMIT_RANGE.defaultValue,
  notesMaxLength: NOTES_LIMIT_RANGE.defaultValue,
  skillFileMaxBytes: SKILL_SIZE_LIMIT_RANGE.defaultValue,
}

const STORAGE_KEY = 'gridwatch-settings'

async function saveApiKey(key: string): Promise<void> {
  try { await window.gridwatchAPI.saveToken(key) } catch { /* ignore */ }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  return Math.min(max, Math.max(min, rounded))
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as AppSettings
    return {
      ...merged,
      summaryMaxLength: clampNumber(
        merged.summaryMaxLength,
        SUMMARY_LIMIT_RANGE.min,
        SUMMARY_LIMIT_RANGE.max,
        DEFAULT_SETTINGS.summaryMaxLength,
      ),
      notesMaxLength: clampNumber(
        merged.notesMaxLength,
        NOTES_LIMIT_RANGE.min,
        NOTES_LIMIT_RANGE.max,
        DEFAULT_SETTINGS.notesMaxLength,
      ),
      skillFileMaxBytes: clampNumber(
        merged.skillFileMaxBytes,
        SKILL_SIZE_LIMIT_RANGE.min,
        SKILL_SIZE_LIMIT_RANGE.max,
        DEFAULT_SETTINGS.skillFileMaxBytes,
      ),
    }
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
  window.gridwatchAPI.setInputCaps({
    summaryMaxLength: s.summaryMaxLength,
    notesMaxLength: s.notesMaxLength,
    skillFileMaxBytes: s.skillFileMaxBytes,
  }).catch(() => {})
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

  const update = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch }
    onChange(next)
    saveSettings(next)
    applySettings(next)
  }

  const reset = () => {
    update({ ...DEFAULT_SETTINGS })
  }

  const updateSummaryLimit = (value: string) => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) return
    update({ summaryMaxLength: clampNumber(parsed, SUMMARY_LIMIT_RANGE.min, SUMMARY_LIMIT_RANGE.max, settings.summaryMaxLength) })
  }

  const updateNotesLimit = (value: string) => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) return
    update({ notesMaxLength: clampNumber(parsed, NOTES_LIMIT_RANGE.min, NOTES_LIMIT_RANGE.max, settings.notesMaxLength) })
  }

  const updateSkillSizeLimit = (value: string) => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) return
    update({ skillFileMaxBytes: clampNumber(parsed, SKILL_SIZE_LIMIT_RANGE.min, SKILL_SIZE_LIMIT_RANGE.max, settings.skillFileMaxBytes) })
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

      {/* Input Limits */}
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>LIMITS</div>
        <div className={styles.description}>
          These caps protect against unbounded disk writes from malformed renderer or IPC payloads. Defaults match prior releases.
          The 1MB HTTP response cap remains fixed as a hard security boundary.
        </div>

        <div className={styles.limitsGrid}>
          <div className={styles.limitRow}>
            <div className={styles.limitInfo}>
              <div className={styles.limitLabel}>Summary max length</div>
              <div className={styles.limitHint}>Range: {SUMMARY_LIMIT_RANGE.min.toLocaleString()}–{SUMMARY_LIMIT_RANGE.max.toLocaleString()} chars</div>
            </div>
            <div className={styles.limitInputWrap}>
              <input
                className={styles.limitInput}
                type="number"
                min={SUMMARY_LIMIT_RANGE.min}
                max={SUMMARY_LIMIT_RANGE.max}
                value={settings.summaryMaxLength}
                onChange={(e) => updateSummaryLimit(e.target.value)}
              />
              <span className={styles.limitUnit}>chars</span>
            </div>
          </div>

          <div className={styles.limitRow}>
            <div className={styles.limitInfo}>
              <div className={styles.limitLabel}>Notes max length</div>
              <div className={styles.limitHint}>Range: {NOTES_LIMIT_RANGE.min.toLocaleString()}–{NOTES_LIMIT_RANGE.max.toLocaleString()} chars</div>
            </div>
            <div className={styles.limitInputWrap}>
              <input
                className={styles.limitInput}
                type="number"
                min={NOTES_LIMIT_RANGE.min}
                max={NOTES_LIMIT_RANGE.max}
                value={settings.notesMaxLength}
                onChange={(e) => updateNotesLimit(e.target.value)}
              />
              <span className={styles.limitUnit}>chars</span>
            </div>
          </div>

          <div className={styles.limitRow}>
            <div className={styles.limitInfo}>
              <div className={styles.limitLabel}>Skill file max size</div>
              <div className={styles.limitHint}>
                Range: {formatBytes(SKILL_SIZE_LIMIT_RANGE.min)}–{formatBytes(SKILL_SIZE_LIMIT_RANGE.max)}
              </div>
            </div>
            <div className={styles.limitInputWrap}>
              <input
                className={styles.limitInput}
                type="number"
                min={Math.round(SKILL_SIZE_LIMIT_RANGE.min / 1024)}
                max={Math.round(SKILL_SIZE_LIMIT_RANGE.max / 1024)}
                value={Math.round(settings.skillFileMaxBytes / 1024)}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10)
                  if (Number.isNaN(parsed)) return
                  updateSkillSizeLimit(String(parsed * 1024))
                }}
              />
              <span className={styles.limitUnit}>KB</span>
            </div>
          </div>
        </div>
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
