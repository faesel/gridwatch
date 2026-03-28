import { ipcRenderer, contextBridge, webFrame } from 'electron'

contextBridge.exposeInMainWorld('gridwatchAPI', {
  getSessions: () => ipcRenderer.invoke('sessions:get-all'),
  getSessionSummaries: () => ipcRenderer.invoke('sessions:get-summaries'),
  getSessionDetail: (sessionId: string) => ipcRenderer.invoke('sessions:get-detail', sessionId),
  getLogTokens: () => ipcRenderer.invoke('sessions:get-log-tokens'),
  renameSession: (sessionId: string, newSummary: string) =>
    ipcRenderer.invoke('sessions:rename', sessionId, newSummary),
  archiveSession: (sessionId: string) =>
    ipcRenderer.invoke('sessions:archive', sessionId),
  deleteSession: (sessionId: string) =>
    ipcRenderer.invoke('sessions:delete', sessionId),
  setTags: (sessionId: string, tags: string[]) =>
    ipcRenderer.invoke('sessions:set-tags', sessionId, tags),
  setNotes: (sessionId: string, notes: string) =>
    ipcRenderer.invoke('sessions:set-notes', sessionId, notes),
  getContext: (sessionId: string) =>
    ipcRenderer.invoke('sessions:get-context', sessionId),
  writeTransfer: (sessionId: string, content: string) =>
    ipcRenderer.invoke('sessions:write-transfer', sessionId, content),
  listTransfers: (sessionId: string) =>
    ipcRenderer.invoke('sessions:list-transfers', sessionId),
  readTransfer: (sessionId: string, filename: string) =>
    ipcRenderer.invoke('sessions:read-transfer', sessionId, filename),
  deleteTransfer: (sessionId: string, filename: string) =>
    ipcRenderer.invoke('sessions:delete-transfer', sessionId, filename),
  setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
  getZoomFactor: () => webFrame.getZoomFactor(),
  checkForUpdate: () => ipcRenderer.invoke('app:check-for-update'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  showInFolder: (filePath: string) => ipcRenderer.invoke('app:show-in-folder', filePath),
  saveToken: (token: string) => ipcRenderer.invoke('app:save-token', token),
  loadToken: () => ipcRenderer.invoke('app:load-token'),
  analyseSession: (apiKey: string, messages: string[]) =>
    ipcRenderer.invoke('insights:analyse', apiKey, messages),

  // Skills
  getSkills: () => ipcRenderer.invoke('skills:get-all'),
  getSkillFile: (skillName: string, fileName: string) =>
    ipcRenderer.invoke('skills:get-file', skillName, fileName),
  saveSkillFile: (skillName: string, fileName: string, content: string) =>
    ipcRenderer.invoke('skills:save-file', skillName, fileName, content),
  createSkill: (name: string, description: string) =>
    ipcRenderer.invoke('skills:create', name, description),
  deleteSkill: (skillName: string) =>
    ipcRenderer.invoke('skills:delete', skillName),
  renameSkillFolder: (skillName: string, newName: string) =>
    ipcRenderer.invoke('skills:rename-folder', skillName, newName),
  duplicateSkill: (skillName: string, newName: string) =>
    ipcRenderer.invoke('skills:duplicate', skillName, newName),
  toggleSkill: (skillName: string) =>
    ipcRenderer.invoke('skills:toggle', skillName),
  exportSkill: (skillName: string) =>
    ipcRenderer.invoke('skills:export', skillName),
  importSkill: () => ipcRenderer.invoke('skills:import'),
  setSkillTags: (skillName: string, tags: string[]) =>
    ipcRenderer.invoke('skills:set-tags', skillName, tags),

  // MCP
  getMcpServers: () => ipcRenderer.invoke('mcp:get-servers'),
  showMcpConfig: () => ipcRenderer.invoke('mcp:show-config'),
  toggleMcpServer: (serverName: string) =>
    ipcRenderer.invoke('mcp:toggle-server', serverName),

  // Agents
  getCustomAgents: () => ipcRenderer.invoke('agents:get-all'),
  getAgentFile: (agentName: string, fileName: string) =>
    ipcRenderer.invoke('agents:get-file', agentName, fileName),
})
