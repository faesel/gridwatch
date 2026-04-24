export interface LspServerData {
  name: string
  command: string
  args: string[]
  fileExtensions: Record<string, string>
  enabled: boolean
}
