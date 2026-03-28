import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, safeStorage } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import https from 'node:https'
import type { SessionData, SessionSummary, SessionDetail, TokenDataPoint, RewindSnapshot, CompactionEvent, ContextCostItem } from '../src/types/session'
import type { SkillData, SkillFile } from '../src/types/skill'
import type { CustomAgentData } from '../src/types/agent'
import type { McpServerData, McpEnvVar, McpTool } from '../src/types/mcp'

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
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win?.show())

  // Set Content Security Policy
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = VITE_DEV_SERVER_URL
      ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: https://api.github.com https://models.inference.ai.azure.com; img-src 'self' data:; font-src 'self' data:"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://api.github.com https://models.inference.ai.azure.com; img-src 'self' data:; font-src 'self' data:"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    if (process.env.GRIDWATCH_DEVTOOLS === '1') {
      win.webContents.openDevTools()
    }
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// ── Security helpers ──────────────────────────────────────────────────────────

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidSessionId(id: string): boolean {
  return typeof id === 'string' && SESSION_ID_PATTERN.test(id)
}

function isPathWithin(filePath: string, parentDir: string): boolean {
  const resolved = path.resolve(filePath)
  const parent = path.resolve(parentDir)
  return resolved.startsWith(parent + path.sep) || resolved === parent
}

const MAX_TRANSFER_SIZE = 1_048_576 // 1 MB

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

// ── IPC response cache ────────────────────────────────────────────────────────
let sessionsCache: { data: SessionData[]; timestamp: number } | null = null
const CACHE_TTL = 15_000 // 15 seconds — aligned with renderer refresh

let logTokensCache: { data: { date: string; tokens: number; utilisation: number }[]; timestamp: number } | null = null
const LOG_TOKENS_CACHE_TTL = 15_000 // 15 seconds

let mcpServersCache: { data: McpServerData[]; timestamp: number } | null = null
const MCP_CACHE_TTL = 10_000 // 10 seconds

function invalidateSessionsCache() {
  sessionsCache = null
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
): { tokenHistory: TokenDataPoint[]; peakTokens: number; peakUtilisation: number; compactions: CompactionEvent[] } {
  const empty = { tokenHistory: [], peakTokens: 0, peakUtilisation: 0, compactions: [] }
  try {
    const sessionTime = new Date(createdAt).getTime()
    const files = fs.readdirSync(logDir).filter((f) => f.startsWith('process-') && f.endsWith('.log'))
    if (files.length === 0) return empty

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
    if (!bestFile) return empty

    const content = fs.readFileSync(path.join(logDir, bestFile), 'utf-8')
    const lines = content.split('\n')
    const tokenHistory: TokenDataPoint[] = []
    let peakTokens = 0
    let peakUtilisation = 0

    // Compaction tracking
    const compactions: CompactionEvent[] = []
    let pendingCompaction: { timestamp: string; triggerUtilisation: number; forced: boolean; summary?: string } | null = null

    for (const line of lines) {
      if (!line.includes('CompactionProcessor') && !line.includes('Utiliz') && !line.includes('Persisted checkpoint')) continue
      const tsMatch = line.match(/\[?([\d]{4}-[\d]{2}-[\d]{2}T[\d:\.]+Z)\]?/)
      const timestamp = tsMatch ? tsMatch[1] : new Date().toISOString()

      // Token utilisation line
      const parsed = parseTokenLine(line)
      if (parsed) {
        tokenHistory.push({ timestamp, tokens: parsed.tokens, utilisation: parsed.utilisation })
        if (parsed.tokens > peakTokens) peakTokens = parsed.tokens
        if (parsed.utilisation > peakUtilisation) peakUtilisation = parsed.utilisation
        continue
      }

      // Compaction started
      const startMatch = line.match(/Context at ([\d.]+)% utilization(\s*\(forced\))?\s*-\s*starting background compaction/)
      if (startMatch) {
        pendingCompaction = {
          timestamp,
          triggerUtilisation: parseFloat(startMatch[1]),
          forced: !!startMatch[2],
        }
        continue
      }

      // Persisted checkpoint summary (appears between compaction start and complete)
      const checkpointMatch = line.match(/Persisted checkpoint #\d+:\s*(.+)/)
      if (checkpointMatch && pendingCompaction) {
        pendingCompaction.summary = checkpointMatch[1].trim()
        continue
      }

      // Compaction completed with details
      const completeMatch = line.match(/Compaction complete - replaced (\d+) messages with summary \+ (\d+) new messages, saved ~(\d+) tokens/)
      if (completeMatch) {
        compactions.push({
          timestamp: pendingCompaction?.timestamp ?? timestamp,
          triggerUtilisation: pendingCompaction?.triggerUtilisation ?? 0,
          forced: pendingCompaction?.forced ?? false,
          messagesReplaced: parseInt(completeMatch[1], 10),
          newMessages: parseInt(completeMatch[2], 10),
          tokensSaved: parseInt(completeMatch[3], 10),
          summary: pendingCompaction?.summary,
        })
        pendingCompaction = null
        continue
      }

      // Background compaction completed (no details) — flush pending
      if (line.includes('Background compaction completed successfully') && pendingCompaction) {
        // Don't flush yet — wait for the "Compaction complete" detail line
      }
    }

    // Flush any unmatched start (compaction interrupted)
    if (pendingCompaction) {
      compactions.push({
        timestamp: pendingCompaction.timestamp,
        triggerUtilisation: pendingCompaction.triggerUtilisation,
        forced: pendingCompaction.forced,
        summary: pendingCompaction.summary,
      })
    }

    return { tokenHistory, peakTokens, peakUtilisation, compactions }
  } catch {
    return empty
  }
}

// ── Context cost estimation helpers ───────────────────────────────────────────

function estimateFileTokens(filePath: string): number {
  try {
    if (fs.existsSync(filePath)) {
      return Math.round(fs.readFileSync(filePath, 'utf-8').length / 4)
    }
  } catch { /* skip unreadable */ }
  return 0
}

function buildContextCost(
  projectRoot: string | undefined,
): { items: ContextCostItem[]; totalTokens: number } {
  const items: ContextCostItem[] = []

  // Instruction files — check gitRoot (or cwd) for .github/copilot-instructions.md
  if (projectRoot) {
    const instructionPath = path.join(projectRoot, '.github', 'copilot-instructions.md')
    const tokens = estimateFileTokens(instructionPath)
    if (tokens > 0) {
      items.push({ label: 'copilot-instructions.md', path: instructionPath, tokens })
    }
  }

  const totalTokens = items.reduce((sum, i) => sum + i.tokens, 0)
  return { items, totalTokens }
}

async function loadAllSessions(): Promise<SessionData[]> {
  // Return cached result if fresh enough
  if (sessionsCache && Date.now() - sessionsCache.timestamp < CACHE_TTL) {
    return sessionsCache.data
  }

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
        const userMessages: { content: string; model?: string; timestamp?: string }[] = []
        let hasCodeReviewAgent = false
        const agentTypesUsed = new Set<string>()

        const eventsFile = path.join(sessionDir, 'events.jsonl')
        if (fs.existsSync(eventsFile)) {
          const eventsContent = fs.readFileSync(eventsFile, 'utf-8')
          const allEvents: { type: string; data?: Record<string, unknown>; timestamp?: string }[] = []
          for (const line of eventsContent.split('\n')) {
            if (line.includes('"agent_type":"code-review"')) hasCodeReviewAgent = true
            const agentMatch = line.match(/"agent_type"\s*:\s*"([^"]+)"/)
            if (agentMatch) agentTypesUsed.add(agentMatch[1])
            if (!line.includes('session.start') && !line.includes('user.message') && !line.includes('tool.execution_start') && !line.includes('tool.execution_complete')) continue
            try {
              allEvents.push(JSON.parse(line))
            } catch {
              // skip malformed lines
            }
          }

          // Collect model info from tool.execution_complete events
          const toolModels: { timestamp: string; model: string }[] = []
          for (const event of allEvents) {
            if (event.type === 'session.start' && event.data?.copilotVersion) {
              copilotVersion = event.data.copilotVersion as string
            }
            if (event.type === 'user.message') {
              turnCount++
              const msg = (event.data?.content || event.data?.message) as string | undefined
              if (msg) {
                lastUserMessage = msg
                userMessages.push({ content: msg, timestamp: event.timestamp })
              }
            }
            if (event.type === 'tool.execution_start' && event.data?.toolName) {
              toolsUsed.add(event.data.toolName as string)
            }
            if (event.type === 'tool.execution_complete' && event.data?.model) {
              toolModels.push({ timestamp: event.timestamp || '', model: event.data.model as string })
            }
          }

          // Assign model to each user message from the first tool_complete after it
          for (const um of userMessages) {
            const found = toolModels.find(tc => tc.timestamp > (um.timestamp || ''))
            if (found) um.model = found.model
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
        let updatedAt: string = new Date(workspace.updated_at || workspace.updatedAt || createdAt).toISOString()

        // Use events.jsonl mtime if newer — workspace.yaml updated_at can be stale
        const evtsMtime = fs.existsSync(eventsFile) ? fs.statSync(eventsFile).mtime : null
        if (evtsMtime && evtsMtime.getTime() > new Date(updatedAt).getTime()) {
          updatedAt = evtsMtime.toISOString()
        }

        // Token history from log
        const { tokenHistory, peakTokens, peakUtilisation, compactions } = fs.existsSync(logDir)
          ? readLogTokenHistory(logDir, createdAt)
          : { tokenHistory: [], peakTokens: 0, peakUtilisation: 0, compactions: [] }

        // Attach checkpoint markdown content to compaction events
        const checkpointsDir = path.join(sessionDir, 'checkpoints')
        if (compactions.length > 0 && fs.existsSync(checkpointsDir)) {
          try {
            const cpFiles = fs.readdirSync(checkpointsDir)
              .filter(f => f.endsWith('.md') && f !== 'index.md')
              .sort()
            for (let ci = 0; ci < compactions.length && ci < cpFiles.length; ci++) {
              try {
                compactions[ci].checkpointContent = fs.readFileSync(
                  path.join(checkpointsDir, cpFiles[ci]), 'utf-8'
                )
              } catch { /* skip unreadable files */ }
            }
          } catch { /* ignore missing/unreadable checkpoints dir */ }
        }

        // Detect research sessions
        const firstUserMsg = userMessages[0]?.content ?? ''
        const isResearch = firstUserMsg.startsWith('Researching: ')

        // Detect review sessions (code-review agent used)
        const isReview = hasCodeReviewAgent

        const researchReports: string[] = (() => {
            try {
              const researchDir = path.join(sessionDir, 'research')
              if (!fs.existsSync(researchDir)) return []
              return fs.readdirSync(researchDir)
                .filter((f) => f.endsWith('.md'))
                .sort()
                .map((f) => path.join(researchDir, f))
            } catch { /* ignore */ }
            return []
          })()

        resolve({
          id: workspace.id || entry,
          cwd: workspace.cwd || '',
          gitRoot: workspace.git_root || undefined,
          repository: workspace.repository || undefined,
          branch: workspace.branch || undefined,
          summary: workspace.summary || undefined,
          summaryCount: parseInt(workspace.summary_count || workspace.summaryCount || '0', 10) || 0,
          createdAt,
          updatedAt,
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
          notes: (() => {
            try {
              const meta = path.join(sessionDir, 'gridwatch.json')
              if (fs.existsSync(meta)) {
                const d = JSON.parse(fs.readFileSync(meta, 'utf-8'))
                return typeof d.notes === 'string' ? d.notes : ''
              }
            } catch { /* ignore */ }
            return ''
          })(),
          rewindSnapshots,
          filesModified,
          peakTokens,
          peakUtilisation,
          tokenHistory,
          compactions,
          isResearch,
          isReview,
          agentTypes: Array.from(agentTypesUsed),
          userMessageCount: userMessages.length,
          researchReportCount: researchReports.length,
          researchReports,
          contextCost: buildContextCost(
            workspace.git_root || workspace.cwd || undefined,
          ),
        })
      } catch {
        resolve(null)
      }
    }))

    const results = await Promise.all(sessionPromises)
    const sessions = results.filter((s): s is SessionData => s !== null)
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    sessionsCache = { data: sessions, timestamp: Date.now() }
    return sessions
  } catch {
    return []
  }
}

ipcMain.handle('sessions:get-all', async (): Promise<SessionData[]> => loadAllSessions())

// ── IPC: sessions:get-summaries ───────────────────────────────────────────────
// Lightweight endpoint that strips expensive detail fields from the cached data.
// The renderer uses this for the 30-second auto-refresh cycle instead of get-all.

function toSummary(s: SessionData): SessionSummary {
  return {
    id: s.id,
    cwd: s.cwd,
    gitRoot: s.gitRoot,
    repository: s.repository,
    branch: s.branch,
    summary: s.summary,
    summaryCount: s.summaryCount,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    turnCount: s.turnCount,
    toolsUsed: s.toolsUsed,
    copilotVersion: s.copilotVersion,
    lastUserMessage: s.lastUserMessage,
    tags: s.tags,
    notes: s.notes,
    peakTokens: s.peakTokens,
    peakUtilisation: s.peakUtilisation,
    isResearch: s.isResearch,
    isReview: s.isReview,
    agentTypes: s.agentTypes,
    userMessageCount: s.userMessageCount,
    researchReportCount: s.researchReportCount,
  }
}

ipcMain.handle('sessions:get-summaries', async (): Promise<SessionSummary[]> => {
  const sessions = await loadAllSessions()
  return sessions.map(toSummary)
})

// ── IPC: sessions:get-detail ──────────────────────────────────────────────────
// Returns expensive detail fields for a single session, sourced from the cache.

ipcMain.handle('sessions:get-detail', async (_event, sessionId: string): Promise<SessionDetail | null> => {
  if (!isValidSessionId(sessionId)) return null
  const sessions = await loadAllSessions()
  const session = sessions.find(s => s.id === sessionId)
  if (!session) return null
  return {
    userMessages: session.userMessages,
    tokenHistory: session.tokenHistory,
    compactions: session.compactions,
    rewindSnapshots: session.rewindSnapshots,
    filesModified: session.filesModified,
    researchReports: session.researchReports,
    contextCost: session.contextCost,
  }
})

ipcMain.handle(
  'sessions:get-log-tokens',
  async (): Promise<{ date: string; tokens: number; utilisation: number }[]> => {
    if (logTokensCache && Date.now() - logTokensCache.timestamp < LOG_TOKENS_CACHE_TTL) {
      return logTokensCache.data
    }
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
      logTokensCache = { data: results, timestamp: Date.now() }
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
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// ── IPC: sessions:rename ──────────────────────────────────────────────────────

ipcMain.handle('sessions:rename', async (_event, sessionId: string, newSummary: string): Promise<boolean> => {
  invalidateSessionsCache()
  try {
    if (!isValidSessionId(sessionId)) return false
    const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId)
    const yamlPath = path.join(sessionDir, 'workspace.yaml')
    if (!fs.existsSync(yamlPath)) return false

    const raw = fs.readFileSync(yamlPath, 'utf-8')
    let updated: string
    if (/^summary:.*$/m.test(raw)) {
      updated = raw.replace(/^summary:.*$/m, `summary: ${newSummary}`)
    } else {
      updated = raw.trimEnd() + `\nsummary: ${newSummary}\n`
    }
    fs.writeFileSync(yamlPath, updated, 'utf-8')
    return true
  } catch {
    return false
  }
})

// ── IPC: sessions:archive ─────────────────────────────────────────────────────

ipcMain.handle('sessions:archive', async (_event, sessionId: string): Promise<{ ok: boolean; error?: string }> => {
  invalidateSessionsCache()
  try {
    if (!isValidSessionId(sessionId)) return { ok: false, error: 'Invalid session ID' }
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
  invalidateSessionsCache()
  try {
    if (!isValidSessionId(sessionId)) return { ok: false, error: 'Invalid session ID' }
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
  invalidateSessionsCache()
  try {
    if (!isValidSessionId(sessionId)) return false
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

// ── IPC: sessions:set-notes ───────────────────────────────────────────────────

ipcMain.handle('sessions:set-notes', async (_e, sessionId: string, notes: string): Promise<boolean> => {
  invalidateSessionsCache()
  try {
    if (!isValidSessionId(sessionId)) return false
    const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId)
    if (!fs.existsSync(sessionDir)) return false
    const metaFile = path.join(sessionDir, 'gridwatch.json')
    let existing: Record<string, unknown> = {}
    if (fs.existsSync(metaFile)) {
      try { existing = JSON.parse(fs.readFileSync(metaFile, 'utf-8')) } catch { /* ignore */ }
    }
    fs.writeFileSync(metaFile, JSON.stringify({ ...existing, notes }, null, 2), 'utf-8')
    return true
  } catch {
    return false
  }
})

// ── IPC: sessions:get-context ─────────────────────────────────────────────────

ipcMain.handle('sessions:get-context', async (_e, sessionId: string): Promise<{
  plan: string | null
  checkpoints: string[]
  notes: string
  tags: string[]
}> => {
  if (!isValidSessionId(sessionId)) return { plan: null, checkpoints: [], notes: '', tags: [] }
  const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId)
  const result = { plan: null as string | null, checkpoints: [] as string[], notes: '', tags: [] as string[] }
  if (!fs.existsSync(sessionDir)) return result

  // Read plan.md
  const planFile = path.join(sessionDir, 'plan.md')
  if (fs.existsSync(planFile)) {
    try { result.plan = fs.readFileSync(planFile, 'utf-8') } catch { /* ignore */ }
  }

  // Read checkpoint files
  const cpDir = path.join(sessionDir, 'checkpoints')
  if (fs.existsSync(cpDir)) {
    try {
      const files = fs.readdirSync(cpDir).filter(f => f.endsWith('.md') && f !== 'index.md').sort()
      for (const f of files) {
        try { result.checkpoints.push(fs.readFileSync(path.join(cpDir, f), 'utf-8')) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  // Read gridwatch.json
  const metaFile = path.join(sessionDir, 'gridwatch.json')
  if (fs.existsSync(metaFile)) {
    try {
      const d = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
      result.tags = Array.isArray(d.tags) ? d.tags : []
      result.notes = typeof d.notes === 'string' ? d.notes : ''
    } catch { /* ignore */ }
  }

  return result
})

// ── IPC: sessions:write-transfer ──────────────────────────────────────────────

ipcMain.handle('sessions:write-transfer', async (_e, sessionId: string, content: string): Promise<string | null> => {
  try {
    if (!isValidSessionId(sessionId)) return null
    if (typeof content !== 'string' || content.length > MAX_TRANSFER_SIZE) return null
    const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId)
    if (!fs.existsSync(sessionDir)) return null
    const now = new Date()
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `transfer-${stamp}.md`
    fs.writeFileSync(path.join(sessionDir, filename), content, 'utf-8')
    return filename
  } catch {
    return null
  }
})

// ── IPC: sessions:list-transfers ──────────────────────────────────────────────

ipcMain.handle('sessions:list-transfers', async (_e, sessionId: string): Promise<{ name: string; date: string; size: number }[]> => {
  try {
    if (!isValidSessionId(sessionId)) return []
    const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId)
    if (!fs.existsSync(sessionDir)) return []
    return fs.readdirSync(sessionDir)
      .filter(f => f.startsWith('transfer-') && f.endsWith('.md'))
      .sort().reverse()
      .map(f => {
        const stat = fs.statSync(path.join(sessionDir, f))
        return { name: f, date: stat.mtime.toISOString(), size: stat.size }
      })
  } catch {
    return []
  }
})

// ── IPC: sessions:read-transfer ───────────────────────────────────────────────

ipcMain.handle('sessions:read-transfer', async (_e, sessionId: string, filename: string): Promise<string | null> => {
  try {
    if (!isValidSessionId(sessionId)) return null
    const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId)
    const filePath = path.join(sessionDir, filename)
    if (!filename.startsWith('transfer-') || !isPathWithin(filePath, sessionDir)) return null
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
})

// ── IPC: sessions:delete-transfer ─────────────────────────────────────────────

ipcMain.handle('sessions:delete-transfer', async (_e, sessionId: string, filename: string): Promise<boolean> => {
  try {
    if (!isValidSessionId(sessionId)) return false
    const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId)
    const filePath = path.join(sessionDir, filename)
    if (!filename.startsWith('transfer-') || !isPathWithin(filePath, sessionDir)) return false
    if (!fs.existsSync(filePath)) return false
    fs.unlinkSync(filePath)
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
  if (typeof url !== 'string' || !(url.startsWith('https://') || url.startsWith('http://'))) {
    throw new Error('Only HTTP(S) URLs are allowed')
  }
  await shell.openExternal(url)
})

ipcMain.handle('app:show-in-folder', async (_e, filePath: string) => {
  if (typeof filePath !== 'string') throw new Error('Invalid path')
  shell.showItemInFolder(filePath)
})

// ── IPC: secure token storage ──────────────────────────────────────────────────

const TOKEN_FILE = path.join(os.homedir(), '.copilot', 'gridwatch-token.enc')

ipcMain.handle('app:save-token', async (_e, token: string): Promise<boolean> => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (!token) {
      if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE)
      return true
    }
    const encrypted = safeStorage.encryptString(token)
    const dir = path.dirname(TOKEN_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(TOKEN_FILE, encrypted)
    return true
  } catch {
    return false
  }
})

ipcMain.handle('app:load-token', async (): Promise<string> => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return ''
    if (!fs.existsSync(TOKEN_FILE)) return ''
    const encrypted = fs.readFileSync(TOKEN_FILE)
    return safeStorage.decryptString(encrypted)
  } catch {
    return ''
  }
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
    // Truncate each message and cap total to fit within ~6K tokens (leaving room for system prompt + response)
    const MAX_MSGS = 30
    const MAX_CHARS_PER_MSG = 300
    const MAX_TOTAL_CHARS = 5000
    const trimmed = messages.slice(0, MAX_MSGS).map(m => m.length > MAX_CHARS_PER_MSG ? m.slice(0, MAX_CHARS_PER_MSG) + '…' : m)
    let totalChars = 0
    const capped: string[] = []
    for (const m of trimmed) {
      if (totalChars + m.length > MAX_TOTAL_CHARS) break
      capped.push(m)
      totalChars += m.length
    }

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: INSIGHTS_SYSTEM_PROMPT },
          { role: 'user', content: `Here are the user prompts from this session (${capped.length} of ${messages.length}):\n\n${capped.map((m, i) => `${i + 1}. ${m}`).join('\n\n')}` },
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

// ── Skills IPC ────────────────────────────────────────────────────────────────

function isValidSkillName(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && name.length <= 100 && SKILL_NAME_PATTERN.test(name)
}

function parseSkillFrontmatter(raw: string): { displayName: string; description: string; license: string | undefined } {
  const result: { displayName: string; description: string; license: string | undefined } = { displayName: '', description: '', license: undefined }
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return result
  const block = match[1]
  const nameMatch = block.match(/^name:\s*(.+)$/m)
  const descMatch = block.match(/^description:\s*(.+)$/m)
  const licMatch = block.match(/^license:\s*(.+)$/m)
  if (nameMatch) result.displayName = nameMatch[1].trim()
  if (descMatch) result.description = descMatch[1].trim()
  if (licMatch) result.license = licMatch[1].trim()
  return result
}

function scanSkillDir(dirPath: string, enabled: boolean): SkillData | null {
  const skillName = path.basename(dirPath)
  const skillMdPath = path.join(dirPath, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) return null

  let frontmatter = { displayName: skillName, description: '', license: undefined as string | undefined }
  try {
    const raw = fs.readFileSync(skillMdPath, 'utf-8')
    frontmatter = parseSkillFrontmatter(raw)
    if (!frontmatter.displayName) frontmatter.displayName = skillName
  } catch { /* use defaults */ }

  const files: SkillFile[] = []
  let latestMtime = 0
  let earliestBirth = Date.now()
  try {
    for (const fname of fs.readdirSync(dirPath)) {
      const fpath = path.join(dirPath, fname)
      const stat = fs.statSync(fpath)
      if (!stat.isFile()) continue
      files.push({ name: fname, path: fpath, size: stat.size, modifiedAt: stat.mtime.toISOString() })
      if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs
      const birth = stat.birthtimeMs || stat.mtimeMs
      if (birth < earliestBirth) earliestBirth = birth
    }
  } catch { /* skip unreadable */ }

  let tags: string[] = []
  try {
    const metaFile = path.join(dirPath, 'gridwatch.json')
    if (fs.existsSync(metaFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
      if (Array.isArray(meta.tags)) tags = meta.tags
    }
  } catch { /* ignore */ }

  // Estimate token count from total text content (~4 chars per token)
  let totalChars = 0
  for (const f of files) {
    try {
      totalChars += fs.readFileSync(f.path, 'utf-8').length
    } catch { /* skip unreadable */ }
  }
  const estimatedTokens = Math.round(totalChars / 4)

  return {
    name: skillName,
    displayName: frontmatter.displayName,
    description: frontmatter.description,
    license: frontmatter.license,
    files,
    enabled,
    createdAt: new Date(earliestBirth).toISOString(),
    modifiedAt: latestMtime ? new Date(latestMtime).toISOString() : new Date().toISOString(),
    tags,
    estimatedTokens,
  }
}

ipcMain.handle('skills:get-all', async (): Promise<SkillData[]> => {
  const skills: SkillData[] = []
  const enabledDir = path.join(os.homedir(), '.copilot', 'skills')
  const disabledDir = path.join(os.homedir(), '.copilot', 'skills-disabled')

  for (const [dir, enabled] of [[enabledDir, true], [disabledDir, false]] as const) {
    if (!fs.existsSync(dir)) continue
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const skill = scanSkillDir(path.join(dir, entry.name), enabled)
        if (skill) skills.push(skill)
      }
    } catch { /* skip */ }
  }

  return skills.sort((a, b) => a.displayName.localeCompare(b.displayName))
})

ipcMain.handle('skills:get-file', async (_e, skillName: string, fileName: string): Promise<string | null> => {
  if (!isValidSkillName(skillName) || !fileName || typeof fileName !== 'string') return null
  const enabledDir = path.join(os.homedir(), '.copilot', 'skills')
  const disabledDir = path.join(os.homedir(), '.copilot', 'skills-disabled')

  for (const base of [enabledDir, disabledDir]) {
    const filePath = path.join(base, skillName, fileName)
    if (!isPathWithin(filePath, path.join(base, skillName))) return null
    if (fs.existsSync(filePath)) {
      try { return fs.readFileSync(filePath, 'utf-8') } catch { return null }
    }
  }
  return null
})

ipcMain.handle('skills:save-file', async (_e, skillName: string, fileName: string, content: string): Promise<boolean> => {
  if (!isValidSkillName(skillName) || !fileName || typeof content !== 'string') return false
  const enabledDir = path.join(os.homedir(), '.copilot', 'skills')
  const disabledDir = path.join(os.homedir(), '.copilot', 'skills-disabled')

  for (const base of [enabledDir, disabledDir]) {
    const skillDir = path.join(base, skillName)
    const filePath = path.join(skillDir, fileName)
    if (!isPathWithin(filePath, skillDir)) return false
    if (fs.existsSync(skillDir)) {
      try { fs.writeFileSync(filePath, content, 'utf-8'); return true } catch { return false }
    }
  }
  return false
})

ipcMain.handle('skills:create', async (_e, name: string, description: string): Promise<{ ok: boolean; error?: string }> => {
  if (!isValidSkillName(name)) return { ok: false, error: 'Invalid skill name. Use lowercase letters, numbers, and hyphens only.' }
  const skillDir = path.join(os.homedir(), '.copilot', 'skills', name)
  if (fs.existsSync(skillDir)) return { ok: false, error: 'A skill with this name already exists.' }
  const disabledDir = path.join(os.homedir(), '.copilot', 'skills-disabled', name)
  if (fs.existsSync(disabledDir)) return { ok: false, error: 'A disabled skill with this name already exists.' }

  const template = `---\nname: ${name}\ndescription: ${description || 'TODO: Add a description'}\n---\n\n# ${name}\n\nAdd your skill instructions here.\n`

  try {
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), template, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('skills:delete', async (_e, skillName: string): Promise<{ ok: boolean; error?: string }> => {
  if (!isValidSkillName(skillName)) return { ok: false, error: 'Invalid skill name' }
  const enabledDir = path.join(os.homedir(), '.copilot', 'skills', skillName)
  const disabledDir = path.join(os.homedir(), '.copilot', 'skills-disabled', skillName)
  const skillDir = fs.existsSync(enabledDir) ? enabledDir : fs.existsSync(disabledDir) ? disabledDir : null
  if (!skillDir) return { ok: false, error: 'Skill not found' }

  try {
    fs.rmSync(skillDir, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('skills:rename-folder', async (_e, skillName: string, newName: string): Promise<{ ok: boolean; error?: string }> => {
  if (!isValidSkillName(skillName)) return { ok: false, error: 'Invalid skill name' }
  if (!isValidSkillName(newName)) return { ok: false, error: 'Invalid new name. Use lowercase letters, numbers, and hyphens only.' }
  if (skillName === newName) return { ok: true }
  const enabledDir = path.join(os.homedir(), '.copilot', 'skills')
  const disabledDir = path.join(os.homedir(), '.copilot', 'skills-disabled')

  const srcEnabled = path.join(enabledDir, skillName)
  const srcDisabled = path.join(disabledDir, skillName)
  const srcDir = fs.existsSync(srcEnabled) ? srcEnabled : fs.existsSync(srcDisabled) ? srcDisabled : null
  if (!srcDir) return { ok: false, error: 'Skill not found' }

  const baseDir = path.dirname(srcDir)
  const destDir = path.join(baseDir, newName)
  if (fs.existsSync(destDir)) return { ok: false, error: `A skill named "${newName}" already exists` }
  const otherBase = baseDir === enabledDir ? disabledDir : enabledDir
  if (fs.existsSync(path.join(otherBase, newName))) return { ok: false, error: `A skill named "${newName}" already exists` }

  try {
    fs.renameSync(srcDir, destDir)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('skills:duplicate', async (_e, skillName: string, newName: string): Promise<{ ok: boolean; error?: string }> => {
  if (!isValidSkillName(skillName)) return { ok: false, error: 'Invalid source skill name' }
  if (!isValidSkillName(newName)) return { ok: false, error: 'Invalid new skill name. Use lowercase letters, numbers, and hyphens only.' }
  const enabledDir = path.join(os.homedir(), '.copilot', 'skills')
  const disabledDir = path.join(os.homedir(), '.copilot', 'skills-disabled')

  const srcDir = fs.existsSync(path.join(enabledDir, skillName)) ? path.join(enabledDir, skillName)
    : fs.existsSync(path.join(disabledDir, skillName)) ? path.join(disabledDir, skillName) : null
  if (!srcDir) return { ok: false, error: 'Source skill not found' }

  const destDir = path.join(enabledDir, newName)
  if (fs.existsSync(destDir)) return { ok: false, error: 'A skill with this name already exists' }

  try {
    fs.cpSync(srcDir, destDir, { recursive: true })
    // Update name in frontmatter of the new SKILL.md
    const skillMd = path.join(destDir, 'SKILL.md')
    if (fs.existsSync(skillMd)) {
      const raw = fs.readFileSync(skillMd, 'utf-8')
      const updated = raw.replace(/^(name:\s*).+$/m, `$1${newName}`)
      fs.writeFileSync(skillMd, updated, 'utf-8')
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('skills:set-tags', async (_e, skillName: string, tags: string[]): Promise<boolean> => {
  try {
    if (!isValidSkillName(skillName)) return false
    if (!Array.isArray(tags)) return false
    const enabledDir = path.join(os.homedir(), '.copilot', 'skills')
    const disabledDir = path.join(os.homedir(), '.copilot', 'skills-disabled')
    const skillDir = fs.existsSync(path.join(enabledDir, skillName)) ? path.join(enabledDir, skillName)
      : fs.existsSync(path.join(disabledDir, skillName)) ? path.join(disabledDir, skillName) : null
    if (!skillDir) return false
    const metaFile = path.join(skillDir, 'gridwatch.json')
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

ipcMain.handle('skills:toggle', async (_e, skillName: string): Promise<{ ok: boolean; error?: string }> => {
  if (!isValidSkillName(skillName)) return { ok: false, error: 'Invalid skill name' }
  const enabledDir = path.join(os.homedir(), '.copilot', 'skills')
  const disabledDir = path.join(os.homedir(), '.copilot', 'skills-disabled')

  const enabledPath = path.join(enabledDir, skillName)
  const disabledPath = path.join(disabledDir, skillName)

  try {
    if (fs.existsSync(enabledPath)) {
      // Disable: move to skills-disabled
      if (!fs.existsSync(disabledDir)) fs.mkdirSync(disabledDir, { recursive: true })
      fs.renameSync(enabledPath, disabledPath)
    } else if (fs.existsSync(disabledPath)) {
      // Enable: move back to skills
      if (!fs.existsSync(enabledDir)) fs.mkdirSync(enabledDir, { recursive: true })
      fs.renameSync(disabledPath, enabledPath)
    } else {
      return { ok: false, error: 'Skill not found' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('skills:export', async (_e, skillName: string): Promise<{ ok: boolean; filePath?: string; error?: string }> => {
  if (!isValidSkillName(skillName)) return { ok: false, error: 'Invalid skill name' }
  const enabledDir = path.join(os.homedir(), '.copilot', 'skills')
  const disabledDir = path.join(os.homedir(), '.copilot', 'skills-disabled')

  const srcDir = fs.existsSync(path.join(enabledDir, skillName)) ? path.join(enabledDir, skillName)
    : fs.existsSync(path.join(disabledDir, skillName)) ? path.join(disabledDir, skillName) : null
  if (!srcDir) return { ok: false, error: 'Skill not found' }

  if (!win) return { ok: false, error: 'No window available' }
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `${skillName}.zip`,
    filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
  })
  if (canceled || !filePath) return { ok: false, error: 'Export cancelled' }

  try {
    const { execSync } = require('child_process') as typeof import('child_process')
    execSync(`cd "${path.dirname(srcDir)}" && zip -r "${filePath}" "${skillName}"`)
    return { ok: true, filePath }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

ipcMain.handle('skills:import', async (): Promise<{ ok: boolean; name?: string; error?: string }> => {
  if (!win) return { ok: false, error: 'No window available' }

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import Skill',
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'Skill files', extensions: ['md'] }],
  })
  if (canceled || !filePaths.length) return { ok: false, error: 'Import cancelled' }

  const selected = filePaths[0]
  const stat = fs.statSync(selected)

  if (stat.isDirectory()) {
    // Import a folder — must contain SKILL.md
    const skillMdPath = path.join(selected, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) return { ok: false, error: 'Selected folder does not contain a SKILL.md file' }

    const skillName = path.basename(selected).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
    if (!skillName) return { ok: false, error: 'Could not derive a valid skill name from the folder' }

    const destDir = path.join(os.homedir(), '.copilot', 'skills', skillName)
    if (fs.existsSync(destDir)) return { ok: false, error: `A skill named "${skillName}" already exists` }

    try {
      fs.cpSync(selected, destDir, { recursive: true })
      return { ok: true, name: skillName }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  } else {
    // Import a single .md file — derive skill name from filename, copy as SKILL.md
    const baseName = path.basename(selected, path.extname(selected))
    const skillName = baseName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
    if (!skillName) return { ok: false, error: 'Could not derive a valid skill name from the filename' }

    const destDir = path.join(os.homedir(), '.copilot', 'skills', skillName)
    if (fs.existsSync(destDir)) return { ok: false, error: `A skill named "${skillName}" already exists` }

    try {
      fs.mkdirSync(destDir, { recursive: true })
      fs.copyFileSync(selected, path.join(destDir, 'SKILL.md'))
      return { ok: true, name: skillName }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }
})

app.whenReady().then(() => {
  // Set macOS dock icon (BrowserWindow icon prop is ignored on macOS)
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(process.env.VITE_PUBLIC ?? __dirname, 'icon.png')
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }
  createWindow()
})

// ── MCP IPC ──────────────────────────────────────────────────

const mcpConfigPath = path.join(os.homedir(), '.copilot', 'mcp-config.json')
const mcpDisabledPath = path.join(os.homedir(), '.copilot', 'gridwatch-mcp-disabled.json')

// Persistent cache for MCP tool lists — backed by disk file
const mcpToolsCachePath = path.join(os.homedir(), '.copilot', 'gridwatch-mcp-tools-cache.json')
const mcpToolsCache = new Map<string, { tools: McpTool[]; timestamp: number }>()
const MCP_TOOLS_CACHE_TTL = 300_000 // 5 minutes — tools rarely change
let mcpToolsCacheLoaded = false

function loadToolsCacheFromDisk(): void {
  if (mcpToolsCacheLoaded) return
  mcpToolsCacheLoaded = true
  try {
    if (fs.existsSync(mcpToolsCachePath)) {
      const data = JSON.parse(fs.readFileSync(mcpToolsCachePath, 'utf-8')) as Record<string, { tools: McpTool[]; timestamp: number }>
      for (const [k, v] of Object.entries(data)) {
        mcpToolsCache.set(k, v)
      }
    }
  } catch { /* ignore corrupt cache */ }
}

function saveToolsCacheToDisk(): void {
  try {
    const obj: Record<string, { tools: McpTool[]; timestamp: number }> = {}
    for (const [k, v] of mcpToolsCache) obj[k] = v
    fs.writeFileSync(mcpToolsCachePath, JSON.stringify(obj, null, 2), 'utf-8')
  } catch { /* ignore write errors */ }
}

// Track whether a background refresh is already in progress
let mcpToolsRefreshing = false

/** Spawn an MCP server and query its tool list via JSON-RPC over stdio */
function queryMcpTools(command: string, args: string[], env: Record<string, string>, timeoutMs = 15_000): Promise<McpTool[]> {
  return new Promise((resolve) => {
    const { spawn } = require('child_process') as typeof import('child_process')

    // Resolve ${VAR} env references from process.env
    const resolvedEnv: Record<string, string | undefined> = { ...process.env }
    for (const [k, v] of Object.entries(env)) {
      const match = /^\$\{(.+)\}$/.exec(v)
      resolvedEnv[k] = match ? (process.env[match[1]] ?? '') : v
    }

    let proc: import('child_process').ChildProcess
    try {
      proc = spawn(command, args, { env: resolvedEnv as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'ignore'] })
    } catch {
      return resolve([])
    }

    let buffer = ''
    let initDone = false
    const tools: McpTool[] = []
    const timer = setTimeout(() => { try { proc.kill() } catch {} resolve(tools) }, timeoutMs)

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          if (!initDone && msg.id === 1) {
            initDone = true
            const listReq = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n'
            proc.stdin?.write(listReq)
          } else if (msg.id === 2 && msg.result?.tools) {
            for (const t of msg.result.tools) {
              if (t.name) {
                tools.push({
                  name: t.name,
                  description: t.description ?? undefined,
                  inputSchema: t.inputSchema ?? undefined,
                })
              }
            }
            clearTimeout(timer)
            try { proc.kill() } catch {}
            resolve(tools)
          }
        } catch { /* not valid JSON yet */ }
      }
    })

    proc.on('error', () => { clearTimeout(timer); resolve(tools) })
    proc.on('exit', () => { clearTimeout(timer); resolve(tools) })

    const initReq = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gridwatch', version: '1.0' } }
    }) + '\n'
    proc.stdin?.write(initReq)
  })
}

function parseMcpEntry(name: string, def: unknown, enabled: boolean): McpServerData {
  const d = def as Record<string, unknown>
  const envObj = (d.env ?? {}) as Record<string, string>
  const envVars: McpEnvVar[] = Object.entries(envObj).map(([k, v]) => ({
    name: k,
    isSecret: /token|secret|key|password/i.test(k) || /^\$\{/.test(v),
  }))
  return {
    name,
    type: 'local',
    command: (d.command as string) ?? undefined,
    args: (d.args as string[]) ?? undefined,
    envVars,
    tools: [],
    enabled,
  }
}

ipcMain.handle('mcp:get-servers', async (): Promise<McpServerData[]> => {
  if (mcpServersCache && Date.now() - mcpServersCache.timestamp < MCP_CACHE_TTL) {
    return mcpServersCache.data
  }
  try {
    const servers: McpServerData[] = []

    // Read enabled local MCP servers from mcp-config.json
    const serverEnvs = new Map<string, Record<string, string>>()
    if (fs.existsSync(mcpConfigPath)) {
      const raw = fs.readFileSync(mcpConfigPath, 'utf-8')
      const config = JSON.parse(raw)
      const mcpServers = config.mcpServers ?? config.servers ?? {}
      for (const [name, def] of Object.entries(mcpServers)) {
        servers.push(parseMcpEntry(name, def, true))
        const d = def as Record<string, unknown>
        if (d.env) serverEnvs.set(name, d.env as Record<string, string>)
      }
    }

    // Read disabled local MCP servers from gridwatch-mcp-disabled.json
    if (fs.existsSync(mcpDisabledPath)) {
      try {
        const raw = fs.readFileSync(mcpDisabledPath, 'utf-8')
        const disabled = JSON.parse(raw) as Record<string, unknown>
        for (const [name, def] of Object.entries(disabled)) {
          servers.push(parseMcpEntry(name, def, false))
        }
      } catch { /* ignore malformed disabled file */ }
    }

    // Apply disk-cached tools immediately (non-blocking)
    loadToolsCacheFromDisk()
    const serversNeedingRefresh: { server: McpServerData; env: Record<string, string> }[] = []
    for (const server of servers) {
      if (server.enabled && server.type === 'local' && server.command) {
        const cached = mcpToolsCache.get(server.name)
        if (cached) {
          server.tools = cached.tools
          server.toolCount = cached.tools.length
        }
        // Schedule refresh if cache is stale or missing
        if (!cached || Date.now() - cached.timestamp > MCP_TOOLS_CACHE_TTL) {
          serversNeedingRefresh.push({ server, env: serverEnvs.get(server.name) ?? {} })
        }
      }
    }

    // Trigger background refresh for stale tools (doesn't block response)
    if (serversNeedingRefresh.length > 0 && !mcpToolsRefreshing) {
      mcpToolsRefreshing = true
      Promise.all(
        serversNeedingRefresh.map(async ({ server, env }) => {
          const tools = await queryMcpTools(server.command!, server.args ?? [], env)
          if (tools.length > 0) {
            mcpToolsCache.set(server.name, { tools: tools.sort((a, b) => a.name.localeCompare(b.name)), timestamp: Date.now() })
          }
        })
      ).then(() => {
        saveToolsCacheToDisk()
        mcpServersCache = null // invalidate so next poll picks up fresh tools
      }).finally(() => { mcpToolsRefreshing = false })
    }

    // Scan most recent log for remote servers and connection times
    const logsDir = path.join(os.homedir(), '.copilot', 'logs')
    if (fs.existsSync(logsDir)) {
      const logFiles = fs.readdirSync(logsDir)
        .filter(f => f.startsWith('process-') && f.endsWith('.log'))
        .sort().reverse()

      const connectionTimes = new Map<string, number>()
      const seenRemote = new Set<string>()

      // Only scan the most recent log for remote servers and connection times
      if (logFiles[0]) {
        const logContent = fs.readFileSync(path.join(logsDir, logFiles[0]), 'utf-8')

        const remoteRe = /Starting remote MCP client for (\S+) with url: (\S+)/g
        let m: RegExpExecArray | null
        while ((m = remoteRe.exec(logContent)) !== null) {
          if (!seenRemote.has(m[1])) {
            seenRemote.add(m[1])
            servers.push({ name: m[1], type: 'remote', url: m[2], envVars: [], tools: [], enabled: true })
          }
        }

        const ideRe = /Connected to IDE MCP server: (.+)/g
        while ((m = ideRe.exec(logContent)) !== null) {
          const ideName = `ide-${m[1].split('(')[0].trim().toLowerCase().replace(/\s+/g, '-')}`
          if (!seenRemote.has(ideName)) {
            seenRemote.add(ideName)
            servers.push({ name: ideName, type: 'remote', url: m[1].trim(), envVars: [], tools: [], enabled: true })
          }
        }

        const connRe = /MCP client for (\S+) connected, took (\d+)ms/g
        while ((m = connRe.exec(logContent)) !== null) {
          connectionTimes.set(m[1], parseInt(m[2], 10))
        }

        // Assign connection times
        for (const server of servers) {
          const ct = connectionTimes.get(server.name)
          if (ct !== undefined) server.connectionTime = ct
        }
      }

      // For remote/IDE servers, fall back to log scanning for tool names
      const remoteServers = servers.filter(s => s.type === 'remote' && s.tools.length === 0)
      if (remoteServers.length > 0) {
        const allToolNames = new Set<string>()
        for (const logFile of logFiles.slice(0, 10)) {
          const logContent = fs.readFileSync(path.join(logsDir, logFile), 'utf-8')
          for (const rs of remoteServers) {
            const escaped = rs.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const re = new RegExp(escaped + '-[a-zA-Z_]+', 'g')
            let tm: RegExpExecArray | null
            while ((tm = re.exec(logContent)) !== null) {
              allToolNames.add(tm[0])
            }
          }
        }
        for (const rs of remoteServers) {
          const prefix = rs.name + '-'
          const serverTools: McpTool[] = [...allToolNames]
            .filter(t => t.startsWith(prefix))
            .map(t => ({ name: t.slice(prefix.length) }))
            .sort((a, b) => a.name.localeCompare(b.name))
          rs.tools = serverTools
          rs.toolCount = serverTools.length
        }
      }
    }

    mcpServersCache = { data: servers, timestamp: Date.now() }
    return servers
  } catch {
    return []
  }
})

ipcMain.handle('mcp:show-config', async () => {
  if (fs.existsSync(mcpConfigPath)) {
    shell.showItemInFolder(mcpConfigPath)
  }
})

ipcMain.handle('mcp:toggle-server', async (_e, serverName: string): Promise<{ ok: boolean; enabled: boolean; error?: string }> => {
  try {
    // Read current config
    const configRaw = fs.existsSync(mcpConfigPath) ? fs.readFileSync(mcpConfigPath, 'utf-8') : '{}'
    const config = JSON.parse(configRaw)
    const configKey = config.mcpServers ? 'mcpServers' : 'servers'
    const mcpServers: Record<string, unknown> = config[configKey] ?? {}

    // Read disabled store
    const disabledRaw = fs.existsSync(mcpDisabledPath) ? fs.readFileSync(mcpDisabledPath, 'utf-8') : '{}'
    const disabled: Record<string, unknown> = JSON.parse(disabledRaw)

    if (serverName in mcpServers) {
      // Disable: move from config to disabled store
      disabled[serverName] = mcpServers[serverName]
      delete mcpServers[serverName]
      config[configKey] = mcpServers
      fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
      fs.writeFileSync(mcpDisabledPath, JSON.stringify(disabled, null, 2) + '\n', 'utf-8')
      mcpServersCache = null
      mcpToolsCache.delete(serverName)
      saveToolsCacheToDisk()
      return { ok: true, enabled: false }
    } else if (serverName in disabled) {
      // Enable: move from disabled store back to config
      mcpServers[serverName] = disabled[serverName]
      delete disabled[serverName]
      config[configKey] = mcpServers
      fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
      if (Object.keys(disabled).length === 0) {
        if (fs.existsSync(mcpDisabledPath)) fs.unlinkSync(mcpDisabledPath)
      } else {
        fs.writeFileSync(mcpDisabledPath, JSON.stringify(disabled, null, 2) + '\n', 'utf-8')
      }
      mcpServersCache = null
      mcpToolsCache.delete(serverName)
      saveToolsCacheToDisk()
      return { ok: true, enabled: true }
    }

    return { ok: false, enabled: false, error: 'Server not found' }
  } catch (err) {
    return { ok: false, enabled: false, error: (err as Error).message }
  }
})

// ── Agents IPC ──────────────────────────────────────────────────────────

ipcMain.handle('agents:get-all', async (): Promise<CustomAgentData[]> => {
  const agentsDir = path.join(os.homedir(), '.copilot', 'agents')
  if (!fs.existsSync(agentsDir)) return []

  const agents: CustomAgentData[] = []
  try {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.agent.md')) continue
      const filePath = path.join(agentsDir, entry.name)
      const agentId = entry.name.replace(/\.agent\.md$/, '')

      let displayName = agentId
      let description = ''
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
        if (fmMatch && jsyaml) {
          const fm = jsyaml.load(fmMatch[1]) || {}
          if (fm.name) displayName = fm.name
          if (fm.description) description = fm.description
        }
      } catch { /* skip parse errors */ }

      const stat = fs.statSync(filePath)
      agents.push({
        name: agentId,
        displayName,
        description,
        files: [{
          name: entry.name,
          path: filePath,
          size: stat.size,
          modifiedAt: new Date(stat.mtimeMs).toISOString(),
        }],
        createdAt: new Date(stat.birthtimeMs).toISOString(),
        modifiedAt: new Date(stat.mtimeMs).toISOString(),
      })
    }
  } catch { /* skip */ }

  return agents.sort((a, b) => a.displayName.localeCompare(b.displayName))
})

ipcMain.handle('agents:get-file', async (_e, agentName: string, fileName: string): Promise<string | null> => {
  if (typeof agentName !== 'string' || !agentName || typeof fileName !== 'string' || !fileName) return null
  const agentsDir = path.join(os.homedir(), '.copilot', 'agents')
  const expectedFile = `${agentName}.agent.md`
  if (fileName !== expectedFile) return null
  const filePath = path.join(agentsDir, expectedFile)
  if (!isPathWithin(filePath, agentsDir)) return null
  if (!fs.existsSync(filePath)) return null
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
})
