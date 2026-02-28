export interface TokenDataPoint {
  timestamp: string;
  tokens: number;
  utilisation: number;
}

export interface RewindSnapshot {
  snapshotId: string;
  userMessage: string;
  timestamp: string;
  gitBranch?: string;
  fileCount: number;
}

export interface ContextComposition {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  compactions: number;
  subagents: number;
}

export interface SessionData {
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
  userMessages: string[];
  tags: string[];
  notes: string;
  rewindSnapshots: RewindSnapshot[];
  filesModified: string[];
  peakTokens: number;
  peakUtilisation: number;
  tokenHistory: TokenDataPoint[];
  contextComposition: ContextComposition;
}
