export interface TokenDataPoint {
  timestamp: string;
  tokens: number;
  utilisation: number;
}

export interface CompactionEvent {
  timestamp: string;
  triggerUtilisation: number;
  forced: boolean;
  messagesReplaced?: number;
  newMessages?: number;
  tokensSaved?: number;
  summary?: string;
  checkpointContent?: string;
}

export interface RewindSnapshot {
  snapshotId: string;
  userMessage: string;
  timestamp: string;
  gitBranch?: string;
  fileCount: number;
}

export interface UserMessage {
  content: string;
  model?: string;
  timestamp?: string;
}

export interface ContextCostItem {
  label: string;
  path?: string;
  tokens: number;
}

export interface ContextCost {
  items: ContextCostItem[];
  totalTokens: number;
}

/** Lightweight session info for list views and cards — no expensive nested arrays. */
export interface SessionSummary {
  id: string;
  cwd: string;
  gitRoot?: string;
  repository?: string;
  branch?: string;
  summary?: string;
  summaryCount: number;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  toolsUsed: string[];
  copilotVersion?: string;
  lastUserMessage?: string;
  tags: string[];
  autoTags: string[];
  notes: string;
  /** True when the user has pinned this session to the top of the list. */
  pinned: boolean;
  peakTokens: number;
  peakUtilisation: number;
  /** Context-window size (denominator) seen on the peak utilisation log line, if known. */
  contextWindow?: number;
  /** First recorded token count / utilisation for the session ("Initial"), if known. */
  initialTokens?: number;
  initialUtilisation?: number;
  /** True when this session's process log was pruned by Copilot (so token data is unavailable). */
  tokenLogPruned: boolean;
  /** True when token stats came from a persisted gridwatch.json snapshot, not a live log. */
  tokenStatsCached?: boolean;
  isResearch: boolean;
  isReview: boolean;
  agentTypes: string[];
  userMessageCount: number;
  researchReportCount: number;
}

/** Expensive detail fields loaded on demand for a single session. */
export interface SessionDetail {
  userMessages: UserMessage[];
  tokenHistory: TokenDataPoint[];
  compactions: CompactionEvent[];
  rewindSnapshots: RewindSnapshot[];
  filesModified: string[];
  researchReports: string[];
  contextCost?: ContextCost;
}

/** Full session data — summary + detail combined. */
export interface SessionData extends SessionSummary, SessionDetail {}
