import type { SessionData } from './session';

export interface PromptFeedback {
  prompt: string;
  score: number;
  feedback: string;
}

export interface InsightResult {
  overallScore: number;
  summary: string;
  promptFeedback: PromptFeedback[];
  suggestions: string[];
}

declare global {
  interface Window {
    gridwatchAPI: {
      getSessions: () => Promise<SessionData[]>;
      getLogTokens: () => Promise<{ date: string; tokens: number; utilisation: number }[]>;
      renameSession: (sessionId: string, newSummary: string) => Promise<boolean>;
      archiveSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
      deleteSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
      setTags: (sessionId: string, tags: string[]) => Promise<boolean>;
      setNotes: (sessionId: string, notes: string) => Promise<boolean>;
      getContext: (sessionId: string) => Promise<{
        plan: string | null;
        checkpoints: string[];
        notes: string;
        tags: string[];
      }>;
      writePlan: (sessionId: string, content: string) => Promise<boolean>;
      setZoomFactor: (factor: number) => void;
      getZoomFactor: () => number;
      checkForUpdate: () => Promise<{ hasUpdate: boolean; latestVersion?: string; downloadUrl?: string }>;
      openExternal: (url: string) => Promise<void>;
      analyseSession: (apiKey: string, messages: string[]) => Promise<InsightResult>;
    };
  }
  const __APP_VERSION__: string;
}

export {};
