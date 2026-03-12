export interface McpEnvVar {
  name: string
  isSecret: boolean
}

export interface McpServerData {
  name: string
  type: 'local' | 'remote'
  command?: string
  args?: string[]
  url?: string
  envVars: McpEnvVar[]
  toolCount?: number
  tools: string[]
  connectionTime?: number
  enabled: boolean
}
