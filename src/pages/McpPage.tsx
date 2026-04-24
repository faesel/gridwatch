import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import type { McpServerData, McpTool } from '../types/mcp'
import styles from './McpPage.module.css'

/** Group tools by category prefix (e.g. jira_, confluence_) */
function groupTools(tools: McpTool[]): Map<string, McpTool[]> {
  const groups = new Map<string, McpTool[]>()
  for (const tool of tools) {
    const sep = tool.name.indexOf('_')
    const category = sep > 0 ? tool.name.slice(0, sep) : 'general'
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category)!.push(tool)
  }
  return groups
}

/** Humanise a snake_case tool name */
function humanise(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Format a tool's display name (strip category prefix) */
function displayName(tool: McpTool): string {
  const sep = tool.name.indexOf('_')
  return humanise(sep > 0 ? tool.name.slice(sep + 1) : tool.name)
}

function McpPage({ refreshKey }: { refreshKey?: number }) {
  const [servers, setServers] = useState<McpServerData[]>([])
  const [selected, setSelected] = useState<McpServerData | null>(null)
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [toolSearch, setToolSearch] = useState('')
  const [toggling, setToggling] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedTool, setExpandedTool] = useState<string | null>(null)

  const loadServers = useCallback(async () => {
    try {
      const data = await window.gridwatchAPI.getMcpServers()
      setServers(data)
    } catch { /* ignore */ }
  }, [])

  const handleToggle = useCallback(async (serverName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setToggling(serverName)
    try {
      const result = await window.gridwatchAPI.toggleMcpServer(serverName)
      if (result.ok) await loadServers()
    } catch { /* ignore */ }
    setToggling(null)
  }, [loadServers])

  useEffect(() => {
    loadServers().finally(() => setLoading(false))
    const interval = setInterval(loadServers, 30_000)
    return () => clearInterval(interval)
  }, [loadServers])

  useEffect(() => { if (refreshKey) loadServers() }, [refreshKey, loadServers])

  // Keep selection in sync
  useEffect(() => {
    if (selected) {
      const updated = servers.find(s => s.name === selected.name)
      if (updated) setSelected(updated)
      else setSelected(null)
    }
  }, [servers])

  // Reset tool UI when selection changes
  useEffect(() => {
    setExpandedGroups(new Set())
    setToolSearch('')
    setExpandedTool(null)
  }, [selected?.name])

  // Group tools by category, filtered by tool search
  const toolGroups = useMemo(() => {
    if (!selected) return new Map<string, McpTool[]>()
    const tools = toolSearch
      ? selected.tools.filter(t => t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
          (t.description ?? '').toLowerCase().includes(toolSearch.toLowerCase()))
      : selected.tools
    return groupTools(tools)
  }, [selected?.tools, toolSearch])

  const filtered = useMemo(() => servers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.command ?? '').toLowerCase().includes(search.toLowerCase())
  ), [servers, search])

  const localServers = useMemo(() => filtered.filter(s => s.type === 'local'), [filtered])
  const remoteServers = useMemo(() => filtered.filter(s => s.type === 'remote'), [filtered])

  return (
    <div className={styles.container}>
      {/* List panel */}
      <div className={styles.listPanel}>
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>MCP SERVERS</span>
          <span className={styles.listCount}>{servers.length}</span>
        </div>

        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search servers…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div className={styles.noticeBanner}>
          ⚡ Changes take effect in new sessions
        </div>

        {loading && <div className={styles.loading}>LOADING...</div>}

        {localServers.length > 0 && (
          <>
            <div className={styles.groupLabel}>LOCAL</div>
            {localServers.map(s => (
              <div
                key={s.name}
                className={`${styles.serverCard} ${selected?.name === s.name ? styles.serverCardActive : ''} ${!s.enabled ? styles.serverCardDisabled : ''}`}
                onClick={() => setSelected(s)}
              >
                <div className={styles.serverName}>{s.name}</div>
                <div className={styles.serverMeta}>
                  <span className={styles.typeBadge}>LOCAL</span>
                  {!s.enabled && <span className={styles.disabledBadge}>DISABLED</span>}
                  {s.toolCount !== undefined && s.toolCount > 0 && (
                    <span className={styles.toolCount}>{s.toolCount} tools</span>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {remoteServers.length > 0 && (
          <>
            <div className={styles.groupLabel}>REMOTE</div>
            {remoteServers.map(s => (
              <div
                key={s.name}
                className={`${styles.serverCard} ${selected?.name === s.name ? styles.serverCardActive : ''}`}
                onClick={() => setSelected(s)}
              >
                <div className={styles.serverName}>{s.name}</div>
                <div className={styles.serverMeta}>
                  <span className={`${styles.typeBadge} ${styles.typeBadgeRemote}`}>REMOTE</span>
                  {s.toolCount !== undefined && (
                    <span className={styles.toolCount}>{s.toolCount} tools</span>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {filtered.length === 0 && (
          <div className={styles.emptyState}>
            {search ? 'No servers match your search' : 'No MCP servers configured'}
          </div>
        )}
      </div>

      {/* Detail panel */}
      <div className={styles.detailPanel}>
        {selected ? (
          <>
            <div className={styles.detailHeader}>
              <div className={styles.detailTitle}>{selected.name}</div>
              <span className={`${styles.typeBadge} ${selected.type === 'remote' ? styles.typeBadgeRemote : ''}`}>
                {selected.type.toUpperCase()}
              </span>
              {!selected.enabled && <span className={styles.disabledBadge}>DISABLED</span>}
              <button
                className={styles.openFolderBtn}
                onClick={() => void window.gridwatchAPI.openItemFolder('mcp', selected.name).catch(() => {})}
                title="Open MCP config"
                aria-label="Open MCP config file location"
              >⊞</button>
            </div>

            {selected.type === 'local' && (
              <div className={styles.actionBar}>
                <button
                  className={`${styles.toggleActionBtn} ${selected.enabled ? styles.toggleActionEnabled : styles.toggleActionDisabled}`}
                  disabled={toggling === selected.name}
                  onClick={(e) => handleToggle(selected.name, e)}
                >
                  {selected.enabled ? '● ENABLED' : '○ DISABLED'}
                </button>
              </div>
            )}

            <div className={styles.section}>
              <div className={styles.sectionTitle}>CONNECTION</div>
              {selected.command && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Command</span>
                  <code className={styles.fieldValue}>{selected.command}</code>
                </div>
              )}
              {selected.args && selected.args.length > 0 && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Arguments</span>
                  <code className={styles.fieldValue}>{selected.args.join(' ')}</code>
                </div>
              )}
              {selected.url && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>URL</span>
                  <code className={styles.fieldValue}>{selected.url}</code>
                </div>
              )}
              {selected.connectionTime !== undefined && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Last connect</span>
                  <span className={styles.fieldValue}>
                    {selected.connectionTime >= 1000
                      ? `${(selected.connectionTime / 1000).toFixed(1)}s`
                      : `${selected.connectionTime}ms`}
                  </span>
                </div>
              )}
            </div>

            {selected.envVars.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>ENVIRONMENT VARIABLES</div>
                {selected.envVars.map(env => (
                  <div key={env.name} className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{env.name}</span>
                    <span className={`${styles.fieldValue} ${env.isSecret ? styles.fieldSecret : ''}`}>
                      {env.isSecret ? '••••••••' : 'set'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Tools catalogue */}
            {selected.tools.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  CAPABILITIES ({selected.tools.length} tools)
                </div>

                {selected.tools.length > 8 && (
                  <input
                    className={styles.searchInput}
                    type="text"
                    placeholder="Filter tools…"
                    value={toolSearch}
                    onChange={e => setToolSearch(e.target.value)}
                  />
                )}

                {[...toolGroups.entries()].map(([category, tools]) => {
                  const isOpen = expandedGroups.has(category)
                  return (
                    <div key={category} className={styles.toolGroup}>
                      <button
                        className={styles.toolGroupHeader}
                        onClick={() => setExpandedGroups(prev => {
                          const next = new Set(prev)
                          isOpen ? next.delete(category) : next.add(category)
                          return next
                        })}
                      >
                        <span className={styles.toolGroupChevron}>{isOpen ? '▾' : '▸'}</span>
                        <span className={styles.toolGroupName}>{category.toUpperCase()}</span>
                        <span className={styles.toolGroupCount}>{tools.length}</span>
                      </button>
                      {isOpen && (
                        <div className={styles.toolList}>
                          {tools.map(tool => {
                            const isExpanded = expandedTool === tool.name
                            const hasDetails = tool.description || tool.inputSchema
                            return (
                              <div key={tool.name} className={styles.toolItem}>
                                <div
                                  className={`${styles.toolHeader} ${hasDetails ? styles.toolHeaderClickable : ''}`}
                                  onClick={() => hasDetails && setExpandedTool(isExpanded ? null : tool.name)}
                                >
                                  <span className={styles.toolDot}>{hasDetails ? (isExpanded ? '▾' : '▸') : '·'}</span>
                                  <span className={styles.toolName}>{displayName(tool)}</span>
                                  {tool.inputSchema && (
                                    <span className={styles.paramCount}>
                                      {Object.keys((tool.inputSchema as Record<string, unknown>).properties ?? {}).length} params
                                    </span>
                                  )}
                                </div>
                                {isExpanded && (
                                  <div className={styles.toolDetails}>
                                    {tool.description && (
                                      <div className={styles.toolDescription}>{tool.description}</div>
                                    )}
                                    {tool.inputSchema && (
                                      <div className={styles.toolSchema}>
                                        <div className={styles.toolSchemaTitle}>PARAMETERS</div>
                                        {Object.entries((tool.inputSchema as Record<string, unknown>).properties ?? {}).map(([pName, pDef]) => {
                                          const param = pDef as Record<string, unknown>
                                          const required = ((tool.inputSchema as Record<string, unknown>).required as string[] ?? []).includes(pName)
                                          return (
                                            <div key={pName} className={styles.toolParam}>
                                              <span className={styles.toolParamName}>
                                                {pName}{required && <span className={styles.toolParamRequired}>*</span>}
                                              </span>
                                              <span className={styles.toolParamType}>{(param.type as string) ?? '?'}</span>
                                              {typeof param.description === 'string' && (
                                                <span className={styles.toolParamDesc}>{param.description}</span>
                                              )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}

                {toolSearch && toolGroups.size === 0 && (
                  <div className={styles.emptyState}>No tools match "{toolSearch}"</div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className={styles.emptyDetail}>
            <div className={styles.emptyIcon}>◈</div>
            <div className={styles.emptyLabel}>Select an MCP server to view its details</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(McpPage)
