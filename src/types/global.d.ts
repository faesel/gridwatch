import type { SessionData, SessionSummary, SessionDetail } from './session';
import type { SkillData } from './skill';
import type { McpServerData } from './mcp';
import type { CustomAgentData } from './agent';

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
      getSessionSummaries: () => Promise<SessionSummary[]>;
      getSessionDetail: (sessionId: string) => Promise<SessionDetail | null>;
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
      writeTransfer: (sessionId: string, content: string) => Promise<string | null>;
      listTransfers: (sessionId: string) => Promise<{ name: string; date: string; size: number }[]>;
      readTransfer: (sessionId: string, filename: string) => Promise<string | null>;
      deleteTransfer: (sessionId: string, filename: string) => Promise<boolean>;
      setZoomFactor: (factor: number) => void;
      getZoomFactor: () => number;
      checkForUpdate: () => Promise<{ hasUpdate: boolean; latestVersion?: string; downloadUrl?: string }>;
      openExternal: (url: string) => Promise<void>;
      showInFolder: (filePath: string) => Promise<void>;
      saveToken: (token: string) => Promise<boolean>;
      loadToken: () => Promise<string>;
      analyseSession: (apiKey: string, messages: string[]) => Promise<InsightResult>;

      // Skills
      getSkills: () => Promise<SkillData[]>;
      getSkillFile: (skillName: string, fileName: string) => Promise<string | null>;
      saveSkillFile: (skillName: string, fileName: string, content: string) => Promise<boolean>;
      createSkill: (name: string, description: string) => Promise<{ ok: boolean; error?: string }>;
      deleteSkill: (skillName: string) => Promise<{ ok: boolean; error?: string }>;
      renameSkillFolder: (skillName: string, newName: string) => Promise<{ ok: boolean; error?: string }>;
      duplicateSkill: (skillName: string, newName: string) => Promise<{ ok: boolean; error?: string }>;
      toggleSkill: (skillName: string) => Promise<{ ok: boolean; error?: string }>;
      exportSkill: (skillName: string) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
      importSkill: () => Promise<{ ok: boolean; name?: string; error?: string }>;
      setSkillTags: (skillName: string, tags: string[]) => Promise<boolean>;

      // MCP
      getMcpServers: () => Promise<McpServerData[]>;
      showMcpConfig: () => Promise<void>;
      toggleMcpServer: (serverName: string) => Promise<{ ok: boolean; enabled: boolean; error?: string }>;

      // Agents
      getCustomAgents: () => Promise<CustomAgentData[]>;
      getAgentFile: (agentName: string, fileName: string) => Promise<string | null>;
    };
  }
  const __APP_VERSION__: string;
}

export {};
