import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import https from 'node:https'
import type { SessionData, TokenDataPoint, RewindSnapshot } from '../src/types/session'

// Must be set before app is ready so the OS picks it up for dock/taskbar tooltip
app.setName('GridWatch')

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let jsyaml: any
try {
  jsyaml = require('js-yaml')
} catch {
  jsyaml = null
}

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    title: 'GridWatch',
    icon: path.join(process.env.VITE_PUBLIC!, 'icon.png'),
    width: 1200,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
    },
  })

  win.once('ready-to-show', () => win?.show())

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    if (process.env.GRIDWATCH_DEVTOOLS === '1') {
      win.webContents.openDevTools()
    }
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// ── IPC: sessions:get-all ─────────────────────────────────────────────────────

function parseTokenLine(line: string): { tokens: number; utilisation: number } | null {
  // CompactionProcessor: Utilization 24.4% (31211/128000 tokens) below threshold 80%
  const m = line.match(/Utiliz[ae]tion\s+([\d.]+)%\s+\((\d+)\/(\d+)\s+tokens\)/)
  if (!m) return null
  return {
    utilisation: parseFloat(m[1]),
    tokens: parseInt(m[2], 10),
  }
}

function readLogTokenHistory(
  logDir: string,
  createdAt: string,
): { tokenHistory: TokenDataPoint[]; peakTokens: number; peakUtilisation: number } {
  try {
    const sessionTime = new Date(createdAt).getTime()
    const files = fs.readdirSync(logDir).filter((f) => f.startsWith('process-') && f.endsWith('.log'))
    if (files.length === 0) return { tokenHistory: [], peakTokens: 0, peakUtilisation: 0 }

    // Find log file whose timestamp is closest to session createdAt
    let bestFile = ''
    let bestDiff = Infinity
    for (const f of files) {
      const m = f.match(/process-(\d+)-\d+\.log/)
      if (!m) continue
      const ts = parseInt(m[1], 10)
      const diff = Math.abs(ts - sessionTime)
      if (diff < bestDiff) {
        bestDiff = diff
        bestFile = f
      }
    }
    if (!bestFile) return { tokenHistory: [], peakTokens: 0, peakUtilisation: 0 }

    const content = fs.readFileSync(path.join(logDir, bestFile), 'utf-8')
    const lines = content.split('\n')
    const tokenHistory: TokenDataPoint[] = []
    let peakTokens = 0
    let peakUtilisation = 0

    for (const line of lines) {
      if (!line.includes('CompactionProcessor') && !line.includes('Utiliz')) continue
      const parsed = parseTokenLine(line)
      if (!parsed) continue
      // Try to extract timestamp from log line prefix e.g. [2024-01-01T12:00:00.000Z]
      const tsMatch = line.match(/\[?([\d]{4}-[\d]{2}-[\d]{2}T[\d:\.]+Z)\]?/)
      const timestamp = tsMatch ? tsMatch[1] : new Date().toISOString()
      tokenHistory.push({ timestamp, tokens: parsed.tokens, utilisation: parsed.utilisation })
      if (parsed.tokens > peakTokens) peakTokens = parsed.tokens
      if (parsed.utilisation > peakUtilisation) peakUtilisation = parsed.utilisation
    }

    return { tokenHistory, peakTokens, peakUtilisation }
  } catch {
    return { tokenHistory: [], peakTokens: 0, peakUtilisation: 0 }
  }
}

ipcMain.handle('sessions:get-all', async (): Promise<SessionData[]> => {
  try {
    const sessionStateDir = path.join(os.homedir(), '.copilot', 'session-state')
    const logDir = path.join(os.homedir(), '.copilot', 'logs')

    if (!fs.existsSync(sessionStateDir)) return []

    const entries = fs.readdirSync(sessionStateDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)

    // Parse all sessions in parallel for faster I/O
    const sessionPromises = entries.map((entry) => new Promise<SessionData | null>((resolve) => {
      try {
        const sessionDir = path.join(sessionStateDir, entry)
        const workspaceFile = path.join(sessionDir, 'workspace.yaml')
        if (!fs.existsSync(workspaceFile)) return resolve(null)

        const yamlContent = fs.readFileSync(workspaceFile, 'utf-8')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let workspace: any = {}
        if (jsyaml) {
          workspace = jsyaml.load(yamlContent) || {}
        } else {
          // Minimal YAML key:value parser fallback
          for (const line of yamlContent.split('\n')) {
            const m = line.match(/^(\w+):\s*(.*)$/)
            if (m) workspace[m[1]] = m[2].trim()
          }
        }

        // Parse events.jsonl — only parse lines containing event types we care about
        let turnCount = 0
        const toolsUsed = new Set<string>()
        let copilotVersion: string | undefined
        let lastUserMessage: string | undefined
        const userMessages: string[] = []

        const eventsFile = path.join(sessionDir, 'events.jsonl')
        if (fs.existsSync(eventsFile)) {
          const eventsContent = fs.readFileSync(eventsFile, 'utf-8')
          for (const line of eventsContent.split('\n')) {
            if (!line.includes('session.start') && !line.includes('user.message') && !line.includes('tool.execution_start')) continue
            try {
              const event = JSON.parse(line)
              if (event.type === 'session.start' && event.data?.copilotVersion) {
                copilotVersion = event.data.copilotVersion
              }
              if (event.type === 'user.message') {
                turnCount++
                const msg = event.data?.content || event.data?.message
                if (msg) {
                  lastUserMessage = msg
                  userMessages.push(msg)
                }
              }
              if (event.type === 'tool.execution_start' && event.data?.toolName) {
                toolsUsed.add(event.data.toolName)
              }
            } catch {
              // skip malformed lines
            }
          }
        }

        // Rewind snapshots
        const rewindFile = path.join(sessionDir, 'rewind-snapshots', 'index.json')
        const rewindSnapshots: RewindSnapshot[] = []
        if (fs.existsSync(rewindFile)) {
          try {
            const rewindData = JSON.parse(fs.readFileSync(rewindFile, 'utf-8'))
            if (Array.isArray(rewindData.snapshots)) {
              for (const s of rewindData.snapshots) {
                rewindSnapshots.push({
                  snapshotId: s.snapshotId ?? '',
                  userMessage: s.userMessage ?? '',
                  timestamp: s.timestamp ?? '',
                  gitBranch: s.gitBranch,
                  fileCount: s.fileCount ?? 0,
                })
              }
            }
          } catch {
            // ignore
          }
        }

        // Files modified (from rewind snapshots filePathMap or snapshot files)
        const filesModified: string[] = []
        if (fs.existsSync(rewindFile)) {
          try {
            const rewindData = JSON.parse(fs.readFileSync(rewindFile, 'utf-8'))
            if (rewindData.filePathMap && typeof rewindData.filePathMap === 'object') {
              filesModified.push(...Object.values<string>(rewindData.filePathMap))
            }
          } catch {
            // ignore
          }
        }

        const createdAt: string = new Date(workspace.created_at || workspace.createdAt || Date.now()).toISOString()

        // Token history from log
        const { tokenHistory, peakTokens, peakUtilisation } = fs.existsSync(logDir)
          ? readLogTokenHistory(logDir, createdAt)
          : { tokenHistory: [], peakTokens: 0, peakUtilisation: 0 }

        resolve({
          id: workspace.id || entry,
          cwd: workspace.cwd || '',
          gitRoot: workspace.git_root || undefined,
          repository: workspace.repository || undefined,
          branch: workspace.branch || undefined,
          summary: workspace.summary || undefined,
          summaryCount: parseInt(workspace.summary_count || workspace.summaryCount || '0', 10) || 0,
          createdAt,
          updatedAt: new Date(workspace.updated_at || workspace.updatedAt || createdAt).toISOString(),
          turnCount,
          toolsUsed: Array.from(toolsUsed),
          copilotVersion,
          lastUserMessage,
          userMessages,
          tags: (() => {
            try {
              const meta = path.join(sessionDir, 'gridwatch.json')
              if (fs.existsSync(meta)) {
                const d = JSON.parse(fs.readFileSync(meta, 'utf-8'))
                return Array.isArray(d.tags) ? d.tags : []
              }
            } catch { /* ignore */ }
            return []
          })(),
          rewindSnapshots,
          filesModified,
          peakTokens,
          peakUtilisation,
          tokenHistory,
        })
      } catch {
        resolve(null)
      }
    }))

    const results = await Promise.all(sessionPromises)
    const sessions = results.filter((s): s is SessionData => s !== null)
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return sessions
  } catch {
    return []
  }
})

// ── IPC: sessions:get-log-tokens ──────────────────────────────────────────────

ipcMain.handle(
  'sessions:get-log-tokens',
  async (): Promise<{ date: string; tokens: number; utilisation: number }[]> => {
    try {
      const logDir = path.join(os.homedir(), '.copilot', 'logs')
      if (!fs.existsSync(logDir)) return []

      const files = fs
        .readdirSync(logDir)
        .filter((f) => f.startsWith('process-') && f.endsWith('.log'))

      const results: { date: string; tokens: number; utilisation: number }[] = []

      for (const f of files) {
        const m = f.match(/process-(\d+)-\d+\.log/)
        if (!m) continue
        const ts = parseInt(m[1], 10)
        const date = new Date(ts).toISOString().slice(0, 10)

        try {
          const content = fs.readFileSync(path.join(logDir, f), 'utf-8')
          let peakTokens = 0
          let peakUtilisation = 0
          for (const line of content.split('\n')) {
            if (!line.includes('CompactionProcessor') && !line.includes('Utiliz')) continue
            const parsed = parseTokenLine(line)
            if (!parsed) continue
            if (parsed.tokens > peakTokens) peakTokens = parsed.tokens
            if (parsed.utilisation > peakUtilisation) peakUtilisation = parsed.utilisation
          }
          if (peakTokens > 0) {
            results.push({ date, tokens: peakTokens, utilisation: peakUtilisation })
          }
        } catch {
          // skip
        }
      }

      results.sort((a, b) => a.date.localeCompare(b.date))
      return results
    } catch {
      return []
    }
  },
)

// ── Window lifecycle ──────────────────────────────────────────────────────────

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// ── IPC: sessions:rename ──────────────────────────────────────────────────────

ipcMain.handle('sessions:rename', async (_event, sessionId: string, newSummary: string): Promise<boolean> => {
  try {
    const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId)
    const yamlPath = path.join(sessionDir, 'workspace.yaml')
    if (!fs.existsSync(yamlPath)) return false

    const raw = fs.readFileSync(yamlPath, 'utf-8')
    const updated = raw.replace(/^summary:.*$/m, `summary: ${newSummary}`)
    fs.writeFileSync(yamlPath, updated, 'utf-8')
    return true
  } catch {
    return false
  }
})

// ── IPC: sessions:archive ─────────────────────────────────────────────────────

ipcMain.handle('sessions:archive', async (_event, sessionId: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId)
    if (!fs.existsSync(sessionDir)) return { ok: false, error: 'Session not found' }

    // Guard: refuse if session was active within last 2 minutes
    const yamlPath = path.join(sessionDir, 'workspace.yaml')
    if (fs.existsSync(yamlPath)) {
      const raw = fs.readFileSync(yamlPath, 'utf-8')
      const match = raw.match(/updated_at:\s*(.+)/)
      if (match) {
        const updatedAt = new Date(match[1].trim()).getTime()
        if (Date.now() - updatedAt < 2 * 60 * 1000) {
          return { ok: false, error: 'Cannot archive an active session' }
        }
      }
    }

    const archiveDir = path.join(os.homedir(), '.copilot', 'session-state-archived')
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true })

    const dest = path.join(archiveDir, sessionId)
    fs.renameSync(sessionDir, dest)
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
})

// ── IPC: sessions:delete ──────────────────────────────────────────────────────

ipcMain.handle('sessions:delete', async (_event, sessionId: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId)
    if (!fs.existsSync(sessionDir)) return { ok: false, error: 'Session not found' }

    // Guard: refuse if session was active within last 2 minutes
    const yamlPath = path.join(sessionDir, 'workspace.yaml')
    if (fs.existsSync(yamlPath)) {
      const raw = fs.readFileSync(yamlPath, 'utf-8')
      const match = raw.match(/updated_at:\s*(.+)/)
      if (match) {
        const updatedAt = new Date(match[1].trim()).getTime()
        if (Date.now() - updatedAt < 2 * 60 * 1000) {
          return { ok: false, error: 'Cannot delete an active session' }
        }
      }
    }

    fs.rmSync(sessionDir, { recursive: true, force: true })
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
})

// ── IPC: sessions:set-tags ────────────────────────────────────────────────────

ipcMain.handle('sessions:set-tags', async (_e, sessionId: string, tags: string[]): Promise<boolean> => {
  try {
    const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId)
    if (!fs.existsSync(sessionDir)) return false
    const metaFile = path.join(sessionDir, 'gridwatch.json')
    let existing: Record<string, unknown> = {}
    if (fs.existsSync(metaFile)) {
      try { existing = JSON.parse(fs.readFileSync(metaFile, 'utf-8')) } catch { /* ignore */ }
    }
    fs.writeFileSync(metaFile, JSON.stringify({ ...existing, tags }, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
})

// ── IPC: app:check-for-update ──────────────────────────────────────────────────

function checkForUpdate(): Promise<{ hasUpdate: boolean; latestVersion?: string; downloadUrl?: string }> {
  return new Promise((resolve) => {
    const pkgPath = path.join(process.env.APP_ROOT!, 'package.json')
    let currentVersion = '0.0.0'
    try {
      currentVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version
    } catch { /* ignore */ }

    const options = {
      hostname: 'api.github.com',
      path: '/repos/faesel/gridwatch/releases/latest',
      headers: { 'User-Agent': `GridWatch/${currentVersion}` },
    }

    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          const release = JSON.parse(data)
          const latestTag = (release.tag_name || '').replace(/^v/, '')
          if (!latestTag) return resolve({ hasUpdate: false })

          const current = currentVersion.split('.').map(Number)
          const latest = latestTag.split('.').map(Number)
          const hasUpdate = latest[0] > current[0] ||
            (latest[0] === current[0] && latest[1] > current[1]) ||
            (latest[0] === current[0] && latest[1] === current[1] && latest[2] > current[2])

          resolve({
            hasUpdate,
            latestVersion: latestTag,
            downloadUrl: release.html_url || `https://github.com/faesel/gridwatch/releases/tag/v${latestTag}`,
          })
        } catch {
          resolve({ hasUpdate: false })
        }
      })
    }).on('error', () => resolve({ hasUpdate: false }))
  })
}

ipcMain.handle('app:check-for-update', async () => checkForUpdate())

ipcMain.handle('app:open-external', async (_e, url: string) => {
  await shell.openExternal(url)
})

// ── IPC: insights:analyse ──────────────────────────────────────────────────

const INSIGHTS_SYSTEM_PROMPT = `You are an expert prompt engineering coach. You analyse prompts sent to GitHub Copilot CLI and provide actionable feedback.

You will receive an array of user messages from a single Copilot CLI session. Evaluate each prompt and the session overall.

Respond with ONLY valid JSON (no markdown fencing) in this exact structure:
{
  "overallScore": <1-10 integer>,
  "summary": "<2-3 sentence overall assessment>",
  "promptFeedback": [
    { "prompt": "<first 80 chars of the prompt>", "score": <1-10>, "feedback": "<1-2 sentence tip>" }
  ],
  "suggestions": ["<general tip 1>", "<general tip 2>", "<general tip 3>"]
}

Scoring guide:
- 9-10: Excellent — specific, includes context (file paths, errors, expected behaviour), right scope
- 7-8: Good — clear intent but could be more specific or include more context
- 5-6: Average — vague or overly broad, missing important context
- 3-4: Weak — ambiguous, could be interpreted multiple ways
- 1-2: Poor — single word or completely unclear

Focus on:
1. Specificity — does the prompt tell Copilot exactly what to do?
2. Context — are file paths, error messages, or constraints provided?
3. Scope — is the request appropriately sized (not too broad, not too trivial)?
4. Efficiency — could fewer turns achieve the same result?
5. Clarity — would another developer understand the intent?

Keep feedback concise and actionable. Max 5 suggestions.`

ipcMain.handle(
  'insights:analyse',
  async (_e, token: string, messages: string[]) => {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: INSIGHTS_SYSTEM_PROMPT },
          { role: 'user', content: `Here are the user prompts from this session:\n\n${messages.map((m, i) => `${i + 1}. ${m}`).join('\n\n')}` },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      })

      const req = https.request(
        {
          hostname: 'models.inference.ai.azure.com',
          path: '/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk: Buffer) => { data += chunk.toString() })
          res.on('end', () => {
            try {
              const json = JSON.parse(data)
              if (json.error) {
                reject(new Error(json.error.message || 'GitHub Models API error'))
                return
              }
              const content = json.choices?.[0]?.message?.content || ''
              // Strip markdown code fences if present
              const cleaned = content.replace(/^```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim()
              const result = JSON.parse(cleaned)
              resolve(result)
            } catch (err) {
              reject(new Error(`Failed to parse response: ${(err as Error).message}`))
            }
          })
        },
      )
      req.on('error', (err) => reject(new Error(`GitHub Models request failed: ${err.message}`)))
      req.write(body)
      req.end()
    })
  },
)

app.whenReady().then(() => {
  // Set macOS dock icon (BrowserWindow icon prop is ignored on macOS)
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(process.env.VITE_PUBLIC ?? __dirname, 'icon.png')
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }
  createWindow()
})
