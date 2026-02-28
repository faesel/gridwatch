import { useState } from 'react'
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
const API_KEY_STORAGE_KEY = 'gridwatch-github-token'

export function loadApiKey(): string {
  try { return localStorage.getItem(API_KEY_STORAGE_KEY) || '' } catch { return '' }
}

export function saveApiKey(key: string): void {
  if (key) localStorage.setItem(API_KEY_STORAGE_KEY, key)
  else localStorage.removeItem(API_KEY_STORAGE_KEY)
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

export default function SettingsPage({ settings, onChange }: Props) {
  const [apiKey, setApiKey] = useState(() => loadApiKey())
  const [showKey, setShowKey] = useState(false)

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
            type={showKey ? 'text' : 'password'}
            placeholder="ghp_..."
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              saveApiKey(e.target.value)
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className={styles.apiKeyToggle}
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? '◉' : '◎'}
          </button>
          {apiKey && (
            <button
              className={styles.apiKeyClear}
              onClick={() => { setApiKey(''); saveApiKey('') }}
            >
              CLEAR
            </button>
          )}
        </div>
        {apiKey && <div className={styles.apiKeyStatus}>✓ TOKEN SAVED</div>}
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
