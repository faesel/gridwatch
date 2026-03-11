import { useState, useEffect, useCallback, useMemo } from 'react'
import type { McpServerData } from '../types/mcp'
import styles from './McpPage.module.css'

/** Group tool names by category prefix (e.g. jira_, confluence_) */
function groupTools(tools: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const tool of tools) {
    const sep = tool.indexOf('_')
    const category = sep > 0 ? tool.slice(0, sep) : 'general'
    const name = sep > 0 ? tool.slice(sep + 1) : tool
    if (!groups.has(category)) groups.set(category, [])
    groups.get(category)!.push(name)
  }
  return groups
}

/** Humanise a snake_case tool name */
function humanise(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function McpPage({ refreshKey }: { refreshKey?: number }) {
  const [servers, setServers] = useState<McpServerData[]>([])
  const [selected, setSelected] = useState<McpServerData | null>(null)
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [toolSearch, setToolSearch] = useState('')

  const loadServers = useCallback(async () => {
    try {
      const data = await window.gridwatchAPI.getMcpServers()
      setServers(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadServers()
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
  }, [selected?.name])

  // Group tools by category, filtered by tool search
  const toolGroups = useMemo(() => {
    if (!selected) return new Map<string, string[]>()
    const tools = toolSearch
      ? selected.tools.filter(t => t.toLowerCase().includes(toolSearch.toLowerCase()))
      : selected.tools
    return groupTools(tools)
  }, [selected?.tools, toolSearch])

  const filtered = servers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.command ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const localServers = filtered.filter(s => s.type === 'local')
  const remoteServers = filtered.filter(s => s.type === 'remote')

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

        {localServers.length > 0 && (
          <>
            <div className={styles.groupLabel}>LOCAL</div>
            {localServers.map(s => (
              <div
                key={s.name}
                className={`${styles.serverCard} ${selected?.name === s.name ? styles.serverCardActive : ''}`}
                onClick={() => setSelected(s)}
              >
                <div className={styles.serverName}>{s.name}</div>
                <div className={styles.serverMeta}>
                  <span className={styles.typeBadge}>LOCAL</span>
                  {s.toolCount !== undefined && (
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
            </div>

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
                          {tools.map(tool => (
                            <div key={tool} className={styles.toolItem}>
                              <span className={styles.toolDot}>·</span>
                              <span className={styles.toolName}>{humanise(tool)}</span>
                            </div>
                          ))}
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

            <div className={styles.section}>
              <div className={styles.sectionTitle}>CONFIGURATION FILE</div>
              <button
                className={styles.showFileBtn}
                onClick={() => window.gridwatchAPI.showMcpConfig()}
              >
                ◈ Open mcp-config.json
              </button>
            </div>
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
