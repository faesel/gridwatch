/** Tool permission entry from permissions-config.json */
export interface ProjectToolPermissions {
  projectPath: string      // key in permissions-config.json (project working directory)
  allowedTools: string[]   // e.g. ["shell(git)", "write", "mcp-server(tool)"]
}
