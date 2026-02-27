import type { SessionData } from './session';

declare global {
  interface Window {
    gridwatchAPI: {
      getSessions: () => Promise<SessionData[]>;
      getLogTokens: () => Promise<{ date: string; tokens: number; utilisation: number }[]>;
      renameSession: (sessionId: string, newSummary: string) => Promise<boolean>;
      archiveSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
      deleteSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
      setTags: (sessionId: string, tags: string[]) => Promise<boolean>;
      setZoomFactor: (factor: number) => void;
      getZoomFactor: () => number;
    };
  }
  const __APP_VERSION__: string;
}

export {};
