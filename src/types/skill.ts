export interface SkillFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

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
}
