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
  userMessages: UserMessage[];
  tags: string[];
  notes: string;
  rewindSnapshots: RewindSnapshot[];
  filesModified: string[];
  peakTokens: number;
  peakUtilisation: number;
  tokenHistory: TokenDataPoint[];
  compactions: CompactionEvent[];
  isResearch: boolean;
  isReview: boolean;
  researchReports: string[];
}
