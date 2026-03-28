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
  notes: string;
  peakTokens: number;
  peakUtilisation: number;
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
