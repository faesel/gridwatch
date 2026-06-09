export interface SkillFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export type OrchestrationMode = 'sequential' | 'parallel';

export interface OrchestrationChild {
  inputDir?: string;
  outputDir?: string;
  outputFile?: string;
}

export interface OrchestrationConfig {
  isOrchestrator: boolean;
  mode: OrchestrationMode;
  outputDir: string;
  runIdSource?: string;
  children: Record<string, OrchestrationChild>;
  finalOutput?: string;
  schemaVersion?: number;
  generatedHash?: string;
  generatedAt?: string;
}

/** Status of the generated managed block within an orchestrator's SKILL.md. */
export type OrchestrationStatus = 'none' | 'missing' | 'in-sync' | 'edited' | 'broken';

export interface SkillData {
  name: string;
  displayName: string;
  description: string;
  license?: string;
  files: SkillFile[];
  enabled: boolean;
  createdAt: string;
  modifiedAt: string;
  usageCount?: number;
  lastUsed?: string;
  tags: string[];
  childSkills: string[];
  linkedAgents: string[];
  estimatedTokens: number;
  orchestration?: OrchestrationConfig;
  /** Computed at load: relationship between the config and the SKILL.md managed block. */
  orchestrationStatus?: OrchestrationStatus;
}
