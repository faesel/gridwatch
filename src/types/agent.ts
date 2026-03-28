export interface CustomAgentData {
  name: string;
  displayName: string;
  description: string;
  files: { name: string; path: string; size: number; modifiedAt: string }[];
  createdAt: string;
  modifiedAt: string;
}
