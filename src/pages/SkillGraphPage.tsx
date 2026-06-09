import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { SkillData, OrchestrationConfig, OrchestrationStatus } from '../types/skill'
import type { CustomAgentData } from '../types/agent'
import { resolveChild } from '../lib/orchestration'
import styles from './SkillGraphPage.module.css'

interface NodeData extends Record<string, unknown> {
  label: string
  name: string
  kind: 'skill' | 'agent' | 'folder'
  enabled: boolean
  missing: boolean
  order?: number
  parallel?: boolean
  isOrchestrator?: boolean
  fullPath?: string
}

const COL_W = 280
const ROW_H = 120

function statusLabel(status?: OrchestrationStatus): { text: string; cls: string } | null {
  switch (status) {
    case 'in-sync':
      return { text: 'IN SYNC', cls: styles.badgeOk }
    case 'edited':
      return { text: 'EDITED', cls: styles.badgeWarn }
    case 'broken':
      return { text: 'BROKEN', cls: styles.badgeBroken }
    case 'missing':
      return { text: 'NOT GENERATED', cls: styles.badgeWarn }
    default:
      return null
  }
}

function SkillNode({ data }: NodeProps<Node<NodeData>>) {
  const cls = [
    styles.node,
    styles.skillNode,
    data.enabled ? '' : styles.disabled,
    data.isOrchestrator ? styles.orchestratorNode : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.nodeKind}>{data.isOrchestrator ? 'ORCHESTRATOR' : 'SKILL'}</div>
      <div className={styles.nodeLabel}>
        {data.parallel ? (
          <span className={styles.parallelBadge} title="Runs in parallel">∥</span>
        ) : (
          typeof data.order === 'number' && <span className={styles.orderBadge}>{data.order}</span>
        )}
        {data.label}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  )
}

function AgentNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className={`${styles.node} ${styles.agentNode} ${data.missing ? styles.disabled : ''}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.nodeKindAgent}>{data.missing ? 'AGENT — MISSING' : 'AGENT'}</div>
      <div className={styles.nodeLabel}>{data.label}</div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  )
}

function FolderGlyph() {
  return (
    <svg className={styles.folderGlyph} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1 3.5h4.2l1.3 1.6H15v7.4H1z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M1 7h14" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    </svg>
  )
}

function FolderNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className={`${styles.node} ${styles.folderNode}`} title={data.fullPath}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.nodeKindFolder}>
        <FolderGlyph />
        FOLDER
      </div>
      <div className={styles.nodeLabel}>{data.label}</div>
      <div className={styles.folderPath}>{data.fullPath}</div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  )
}

const nodeTypes: NodeTypes = { skill: SkillNode, agent: AgentNode, folder: FolderNode }

type NodeCategory = 'orchestrator' | 'skill' | 'agent' | 'folder'

function nodeCategory(data: NodeData): NodeCategory {
  if (data.kind === 'folder') return 'folder'
  if (data.kind === 'agent') return 'agent'
  return data.isOrchestrator ? 'orchestrator' : 'skill'
}

interface GraphModel {
  nodes: Node<NodeData>[]
  edges: Edge[]
}

function buildGraph(rootName: string, skills: SkillData[], agents: CustomAgentData[]): GraphModel {
  const skillByName = new Map(skills.map((s) => [s.name, s]))
  const agentByName = new Map(agents.map((a) => [a.name, a]))
  const rootSkill = skillByName.get(rootName)
  const rootChildren = rootSkill?.childSkills ?? []
  const rootIsOrchestrator = rootSkill?.orchestration?.isOrchestrator ?? false
  const rootIsParallel = rootSkill?.orchestration?.mode === 'parallel'

  // BFS over child skills, cycle-protected.
  const depth = new Map<string, number>()
  const order: string[] = []
  const visited = new Set<string>()
  const queue: { name: string; d: number }[] = [{ name: rootName, d: 0 }]
  while (queue.length) {
    const { name, d } = queue.shift()!
    if (visited.has(name)) continue
    visited.add(name)
    const sk = skillByName.get(name)
    if (!sk) continue
    depth.set(name, d)
    order.push(name)
    for (const child of sk.childSkills ?? []) {
      if (!visited.has(child)) queue.push({ name: child, d: d + 1 })
    }
  }

  // Unique linked agents across all rendered skills.
  const agentNames: string[] = []
  for (const name of order) {
    for (const a of skillByName.get(name)?.linkedAgents ?? []) {
      if (!agentNames.includes(a)) agentNames.push(a)
    }
  }

  // Column layout: skills by depth, agents in the rightmost lane.
  const byDepth = new Map<number, string[]>()
  for (const name of order) {
    const d = depth.get(name) ?? 0
    const col = byDepth.get(d) ?? []
    col.push(name)
    byDepth.set(d, col)
  }
  const maxDepth = order.length ? Math.max(...depth.values()) : 0

  const nodes: Node<NodeData>[] = []
  for (const [d, names] of byDepth) {
    names.forEach((name, i) => {
      const sk = skillByName.get(name)!
      const directOrder = rootChildren.indexOf(name)
      nodes.push({
        id: `skill:${name}`,
        type: 'skill',
        position: { x: d * COL_W, y: i * ROW_H },
        data: {
          label: sk.displayName || sk.name,
          name,
          kind: 'skill',
          enabled: sk.enabled,
          missing: false,
          order: directOrder >= 0 && !rootIsParallel ? directOrder + 1 : undefined,
          parallel: directOrder >= 0 && rootIsParallel,
          isOrchestrator: name === rootName && rootIsOrchestrator,
        },
      })
    })
  }
  agentNames.forEach((name, i) => {
    const agent = agentByName.get(name)
    nodes.push({
      id: `agent:${name}`,
      type: 'agent',
      position: { x: (maxDepth + 1) * COL_W, y: i * ROW_H },
      data: { label: agent?.displayName || name, name, kind: 'agent', enabled: true, missing: !agent },
    })
  })

  // Edges: skill→child (blue) and skill→agent (orange).
  const renderedSkills = new Set(order)
  const edges: Edge[] = []
  for (const name of order) {
    const sk = skillByName.get(name)!
    for (const child of sk.childSkills ?? []) {
      if (!renderedSkills.has(child)) continue
      edges.push({
        id: `e:${name}->${child}`,
        source: `skill:${name}`,
        target: `skill:${child}`,
        style: { stroke: 'var(--tron-blue)', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--tron-blue)' },
      })
    }
    for (const a of sk.linkedAgents ?? []) {
      edges.push({
        id: `ea:${name}->${a}`,
        source: `skill:${name}`,
        target: `agent:${a}`,
        style: { stroke: 'var(--tron-orange)', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--tron-orange)' },
      })
    }
  }

  // ── Folder I/O nodes (root orchestrator's direct children) ──
  // One node per unique folder path. Output edges carry the output filename as a label;
  // input edges are dashed. The consolidated final output is drawn from the orchestrator itself.
  const config = rootSkill?.orchestration
  const folderLane = (maxDepth + 2) * COL_W
  const seenFolders = new Set<string>()
  let folderCount = 0
  const labelStyle = { fill: 'var(--tron-text)', fontSize: 10, fontFamily: 'inherit' }
  const labelBgStyle = { fill: 'var(--tron-panel)', stroke: 'var(--tron-yellow)' }
  const ensureFolder = (raw: string | undefined): string | null => {
    const folderPath = (raw ?? '').trim()
    if (!folderPath) return null
    const id = `folder:${folderPath}`
    if (!seenFolders.has(folderPath)) {
      seenFolders.add(folderPath)
      const base = folderPath.replace(/\/+$/, '').split('/').pop() || folderPath
      nodes.push({
        id,
        type: 'folder',
        position: { x: folderLane, y: folderCount * ROW_H },
        data: { label: base, name: folderPath, kind: 'folder', enabled: true, missing: false, fullPath: folderPath },
      })
      folderCount += 1
    }
    return id
  }

  if (config?.isOrchestrator) {
    for (const childName of rootChildren) {
      if (!renderedSkills.has(childName)) continue
      const rc = resolveChild(childName, config)
      const outId = ensureFolder(rc.outputDir)
      if (outId) {
        edges.push({
          id: `fo:${childName}`,
          source: `skill:${childName}`,
          target: outId,
          label: rc.outputFile,
          labelStyle,
          labelBgStyle,
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 2,
          zIndex: 0,
          style: { stroke: 'var(--tron-yellow)', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--tron-yellow)' },
        })
      }
      const inId = ensureFolder(rc.inputDir)
      if (inId) {
        edges.push({
          id: `fi:${childName}`,
          source: inId,
          target: `skill:${childName}`,
          zIndex: 0,
          style: { stroke: 'var(--tron-yellow)', strokeWidth: 1.5, strokeDasharray: '5 4' },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--tron-yellow)' },
        })
      }
    }
    if (config.finalOutput && config.outputDir) {
      const finalId = ensureFolder(config.outputDir)
      if (finalId) {
        edges.push({
          id: 'ff:root',
          source: `skill:${rootName}`,
          target: finalId,
          label: config.finalOutput,
          labelStyle,
          labelBgStyle,
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 2,
          zIndex: 0,
          style: { stroke: 'var(--tron-yellow)', strokeWidth: 2.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--tron-yellow)' },
        })
      }
    }
  }

  return { nodes, edges }
}

interface CanvasProps {
  model: GraphModel
  editMode: boolean
  onNavigateToSkill: (name: string) => void
  onNavigateToAgent: (name: string) => void
  onConnectChild: (parentName: string, childName: string) => void
}

function GraphCanvas({ model, editMode, onNavigateToSkill, onNavigateToAgent, onConnectChild }: CanvasProps) {
  const [nodes, , onNodesChange] = useNodesState(model.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(model.edges)

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const data = node.data as NodeData
      if (data.kind === 'folder') {
        if (data.fullPath) window.gridwatchAPI.showInFolder(data.fullPath)
        return
      }
      if (data.missing) return
      if (data.kind === 'agent') onNavigateToAgent(data.name)
      else onNavigateToSkill(data.name)
    },
    [onNavigateToSkill, onNavigateToAgent],
  )

  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      if (!conn.source || !conn.target) return false
      if (conn.source === conn.target) return false
      // Only skill→skill links are valid for orchestration.
      if (!conn.source.startsWith('skill:') || !conn.target.startsWith('skill:')) return false
      const exists = edges.some((e) => e.source === conn.source && e.target === conn.target)
      return !exists
    },
    [edges],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!isValidConnection(conn) || !conn.source || !conn.target) return
      const parentName = conn.source.replace(/^skill:/, '')
      const childName = conn.target.replace(/^skill:/, '')
      setEdges((eds) =>
        addEdge(
          {
            ...conn,
            style: { stroke: 'var(--tron-blue)', strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--tron-blue)' },
          },
          eds,
        ),
      )
      onConnectChild(parentName, childName)
    },
    [isValidConnection, setEdges, onConnectChild],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeDoubleClick={onNodeDoubleClick}
      onConnect={editMode ? onConnect : undefined}
      isValidConnection={isValidConnection}
      nodesConnectable={editMode}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="var(--tron-grid-line)" gap={24} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => ((n.data as NodeData).kind === 'agent' ? 'var(--tron-orange)' : 'var(--tron-cyan)')}
        maskColor="rgba(0, 0, 0, 0.6)"
        className={styles.minimap}
      />
    </ReactFlow>
  )
}

interface ComboOption {
  name: string
  label: string
}

function OrchestratorCombobox({
  value,
  options,
  onChange,
  disabled,
  placeholder = 'Search orchestrators…',
  emptyPlaceholder = 'No orchestrators',
  listId = 'orchestrator-combo-list',
  title = 'Search and select an orchestrator skill',
}: {
  value: string
  options: ComboOption[]
  onChange: (name: string) => void
  disabled?: boolean
  placeholder?: string
  emptyPlaceholder?: string
  listId?: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find((o) => o.name === value)?.label ?? ''

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as globalThis.Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  const choose = useCallback(
    (name: string) => {
      onChange(name)
      setOpen(false)
      setQuery('')
    },
    [onChange],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[highlight]
      if (opt) choose(opt.name)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div className={styles.combo} ref={wrapRef}>
      <input
        className={styles.comboInput}
        type="text"
        value={open ? query : selectedLabel}
        placeholder={options.length === 0 ? emptyPlaceholder : placeholder}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!open) setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        title={title}
      />
      <span className={styles.comboCaret} aria-hidden="true">▾</span>
      {open && (
        <ul className={styles.comboList} id={listId} role="listbox">
          {filtered.length === 0 ? (
            <li className={styles.comboEmpty}>No matches</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.name}
                role="option"
                aria-selected={o.name === value}
                className={[
                  styles.comboOption,
                  i === highlight ? styles.comboOptionActive : '',
                  o.name === value ? styles.comboOptionSelected : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(o.name)
                }}
              >
                {o.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

function defaultConfig(): OrchestrationConfig {
  return { isOrchestrator: true, mode: 'sequential', outputDir: '', children: {}, schemaVersion: 1 }
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const LAST_PARENT_KEY = 'gridwatch-skillgraph-parent'

function readLastParent(): string {
  try {
    return localStorage.getItem(LAST_PARENT_KEY) || ''
  } catch {
    return ''
  }
}

interface SkillGraphPageProps {
  refreshKey?: number
  onNavigateToSkill: (name: string) => void
  onNavigateToAgent: (name: string) => void
}

function SkillGraphPage({ refreshKey, onNavigateToSkill, onNavigateToAgent }: SkillGraphPageProps) {
  const [skills, setSkills] = useState<SkillData[]>([])
  const [agents, setAgents] = useState<CustomAgentData[]>([])
  const [selectedParent, setSelectedParent] = useState<string>(() => readLastParent())
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [visibleKinds, setVisibleKinds] = useState({
    orchestrator: true,
    skill: true,
    agent: true,
    folder: true,
  })
  const [reloadTick, setReloadTick] = useState(0)

  // Orchestration draft (edit mode source of truth before persistence).
  const [draftOrder, setDraftOrder] = useState<string[]>([])
  const [draftConfig, setDraftConfig] = useState<OrchestrationConfig>(defaultConfig())
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string>('')

  // Modals.
  const [showNewSkill, setShowNewSkill] = useState(false)
  const [showNewOrch, setShowNewOrch] = useState(false)
  const [previewText, setPreviewText] = useState<string | null>(null)

  const reload = useCallback(() => {
    setReloadTick((t) => t + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([window.gridwatchAPI.getSkills(), window.gridwatchAPI.getCustomAgents()])
      .then(([s, a]) => {
        if (cancelled) return
        setSkills(s)
        setAgents(a)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refreshKey, reloadTick])

  // Parents: skills that orchestrate others or are flagged as orchestrators.
  const parents = useMemo(
    () =>
      skills
        .filter(
          (s) =>
            (s.childSkills?.length ?? 0) > 0 ||
            (s.linkedAgents?.length ?? 0) > 0 ||
            s.orchestration?.isOrchestrator,
        )
        .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name)),
    [skills],
  )

  useEffect(() => {
    if (parents.length === 0) {
      // Don't clear a remembered selection while the first load is still in flight.
      if (!loading && selectedParent) setSelectedParent('')
      return
    }
    if (parents.some((p) => p.name === selectedParent)) return
    // Restore the last-used parent when it's still a valid orchestrator, else fall back to the first.
    const stored = readLastParent()
    const restored = parents.find((p) => p.name === stored)?.name
    setSelectedParent(restored ?? parents[0].name)
  }, [parents, selectedParent, loading])

  // Remember the selected parent so it is restored next time the graph screen is opened.
  useEffect(() => {
    if (!selectedParent) return
    try {
      localStorage.setItem(LAST_PARENT_KEY, selectedParent)
    } catch {
      /* ignore persistence errors */
    }
  }, [selectedParent])

  const selectedSkill = useMemo(
    () => skills.find((s) => s.name === selectedParent) ?? null,
    [skills, selectedParent],
  )

  // Initialise the draft once per selected skill. We deliberately do NOT re-run on every
  // `selectedSkill` reference change: the 30s auto-refresh replaces the skills array with fresh
  // objects, and re-seeding here would wipe the user's unsaved edits mid-typing. The guard ref
  // only re-seeds when the *selected skill name* actually changes (or after an explicit reload).
  const initedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedParent) {
      initedFor.current = null
      setDraftOrder([])
      setDraftConfig(defaultConfig())
      setDirty(false)
      return
    }
    if (initedFor.current === selectedParent) return
    if (!selectedSkill) return
    initedFor.current = selectedParent
    setDraftOrder([...(selectedSkill.childSkills ?? [])])
    setDraftConfig(
      selectedSkill.orchestration
        ? { ...defaultConfig(), ...selectedSkill.orchestration, children: { ...selectedSkill.orchestration.children } }
        : defaultConfig(),
    )
    setDirty(false)
    setStatusMsg('')
  }, [selectedParent, selectedSkill])

  // While editing, reflect the draft on the canvas live.
  const effectiveSkills = useMemo(() => {
    if (!editMode || !selectedParent) return skills
    return skills.map((s) =>
      s.name === selectedParent ? { ...s, childSkills: draftOrder, orchestration: draftConfig } : s,
    )
  }, [editMode, selectedParent, skills, draftOrder, draftConfig])

  const model = useMemo(
    () => (selectedParent ? buildGraph(selectedParent, effectiveSkills, agents) : { nodes: [], edges: [] }),
    [selectedParent, effectiveSkills, agents],
  )

  // Filter nodes (and their edges) by the kinds the user has toggled on in the legend.
  const displayModel = useMemo(() => {
    const nodes = model.nodes.filter((n) => visibleKinds[nodeCategory(n.data as NodeData)])
    const kept = new Set(nodes.map((n) => n.id))
    const edges = model.edges.filter((e) => kept.has(e.source) && kept.has(e.target))
    return { nodes, edges }
  }, [model, visibleKinds])

  const modelKey = useMemo(
    () =>
      `${selectedParent}|${editMode ? 'edit' : 'view'}|${displayModel.nodes.map((n) => n.id).join(',')}|${displayModel.edges
        .map((e) => e.id)
        .join(',')}`,
    [selectedParent, editMode, displayModel],
  )

  // ── Draft mutations ──────────────────────────
  const skillByName = useMemo(() => new Map(skills.map((s) => [s.name, s])), [skills])

  const attachChild = useCallback(
    (childName: string) => {
      if (!childName || childName === selectedParent) return
      if (draftOrder.includes(childName)) return
      const prev = draftOrder[draftOrder.length - 1]
      // Only chain input→output between steps in sequential mode. Parallel steps are
      // independent and take no input by default, so leave their input folder blank.
      const inheritedInput =
        draftConfig.mode === 'parallel' ? '' : prev ? resolveChild(prev, draftConfig).outputDir : draftConfig.outputDir
      setDraftConfig((cfg) => ({
        ...cfg,
        children: {
          ...cfg.children,
          [childName]:
            cfg.children?.[childName] ?? {
              inputDir: inheritedInput || '',
              outputDir: '',
              outputFile: `${childName}-output-<SESSION_ID>.md`,
            },
        },
      }))
      setDraftOrder((order) => (order.includes(childName) ? order : [...order, childName]))
      setDirty(true)
    },
    [selectedParent, draftOrder, draftConfig],
  )

  const detachChild = useCallback((childName: string) => {
    setDraftOrder((order) => order.filter((n) => n !== childName))
    setDraftConfig((cfg) => {
      if (!cfg.children?.[childName]) return cfg
      const nextChildren = { ...cfg.children }
      delete nextChildren[childName]
      return { ...cfg, children: nextChildren }
    })
    setDirty(true)
  }, [])

  const moveChild = useCallback((index: number, dir: -1 | 1) => {
    setDraftOrder((order) => {
      const next = [...order]
      const target = index + dir
      if (target < 0 || target >= next.length) return order
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setDirty(true)
  }, [])

  const setChildField = useCallback(
    (childName: string, field: 'inputDir' | 'outputDir' | 'outputFile', value: string) => {
      setDraftConfig((cfg) => ({
        ...cfg,
        children: { ...cfg.children, [childName]: { ...cfg.children?.[childName], [field]: value } },
      }))
      setDirty(true)
    },
    [],
  )

  const setConfigField = useCallback(
    <K extends keyof OrchestrationConfig>(field: K, value: OrchestrationConfig[K]) => {
      setDraftConfig((cfg) => ({ ...cfg, [field]: value }))
      setDirty(true)
    },
    [],
  )

  const browseInto = useCallback(async (apply: (path: string) => void) => {
    const res = await window.gridwatchAPI.pickDirectory()
    if (res.ok && res.path) apply(res.path)
  }, [])

  // ── Persistence ──────────────────────────────
  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!selectedParent || !selectedSkill) return false
    setBusy(true)
    try {
      const okRel = await window.gridwatchAPI.setSkillRelations(
        selectedParent,
        draftOrder,
        selectedSkill.linkedAgents ?? [],
      )
      const prunedChildren = Object.fromEntries(
        Object.entries(draftConfig.children ?? {}).filter(([name]) => draftOrder.includes(name)),
      )
      const okOrch = await window.gridwatchAPI.setSkillOrchestration(selectedParent, {
        ...draftConfig,
        children: prunedChildren,
      })
      if (!okRel || !okOrch) {
        setStatusMsg('Save failed — check the skill is writable.')
        return false
      }
      setDirty(false)
      return true
    } catch {
      setStatusMsg('Save failed.')
      return false
    } finally {
      setBusy(false)
    }
  }, [selectedParent, selectedSkill, draftOrder, draftConfig])

  const handleSave = useCallback(async () => {
    if (!selectedParent) return
    if (dirty) {
      const ok = await saveDraft()
      if (!ok) return
    }
    setBusy(true)
    try {
      const res = await window.gridwatchAPI.generateOrchestrator(selectedParent)
      if (res.ok) {
        setStatusMsg('Saved and SKILL.md regenerated.')
      } else if (res.status === 'broken') {
        setStatusMsg(`Saved, but SKILL.md not regenerated — managed block is broken: ${res.error ?? ''}`)
      } else {
        setStatusMsg(`Saved, but SKILL.md regenerate failed: ${res.error ?? 'unknown error'}`)
      }
      reload()
    } finally {
      setBusy(false)
    }
  }, [selectedParent, dirty, saveDraft, reload])

  const handlePreview = useCallback(async () => {
    if (!selectedParent) return
    if (dirty) {
      const ok = await saveDraft()
      if (!ok) return
    }
    const res = await window.gridwatchAPI.previewOrchestrator(selectedParent)
    if (res.ok && res.block) setPreviewText(res.block)
    else setStatusMsg(`Preview failed: ${res.error ?? 'unknown error'}`)
  }, [selectedParent, dirty, saveDraft])

  const handleConnectChild = useCallback(
    (parentName: string, childName: string) => {
      if (parentName === selectedParent) attachChild(childName)
    },
    [selectedParent, attachChild],
  )

  // Candidate child skills (exclude self + already-attached).
  const attachable = useMemo(
    () =>
      skills
        .filter((s) => s.name !== selectedParent && !draftOrder.includes(s.name))
        .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name)),
    [skills, selectedParent, draftOrder],
  )

  const badge = statusLabel(selectedSkill?.orchestrationStatus)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.title}>SKILLS GRAPH</div>
        <label className={styles.pickerLabel}>
          ORCHESTRATOR
          <OrchestratorCombobox
            value={selectedParent}
            options={parents.map((p) => ({ name: p.name, label: p.displayName || p.name }))}
            onChange={setSelectedParent}
            disabled={parents.length === 0}
          />
        </label>
        {editMode && (
          <button className={styles.btn} onClick={() => setShowNewOrch(true)} title="Create a new orchestrator skill">
            ＋ New orchestrator
          </button>
        )}
        <button
          className={`${styles.btn} ${editMode ? styles.btnActive : ''}`}
          onClick={() => setEditMode((v) => !v)}
          title={editMode ? 'Return to read-only view' : 'Edit orchestration relationships'}
        >
          {editMode ? 'DONE' : 'EDIT'}
        </button>
        <div className={styles.legend}>
          <div className={styles.legendGroup}>
            <span className={styles.legendGroupLabel}>NODES</span>
            <label className={`${styles.legendItem} ${styles.legendToggle} ${visibleKinds.orchestrator ? '' : styles.legendToggleOff}`}>
              <input
                type="checkbox"
                className={styles.legendCheckbox}
                checked={visibleKinds.orchestrator}
                onChange={(e) => setVisibleKinds((v) => ({ ...v, orchestrator: e.target.checked }))}
              />
              <i className={`${styles.swatchOrch} ${visibleKinds.orchestrator ? styles.swatchChecked : ''}`} />Orchestrator
            </label>
            <label className={`${styles.legendItem} ${styles.legendToggle} ${visibleKinds.skill ? '' : styles.legendToggleOff}`}>
              <input
                type="checkbox"
                className={styles.legendCheckbox}
                checked={visibleKinds.skill}
                onChange={(e) => setVisibleKinds((v) => ({ ...v, skill: e.target.checked }))}
              />
              <i className={`${styles.swatchSkill} ${visibleKinds.skill ? styles.swatchChecked : ''}`} />Skill
            </label>
            <label className={`${styles.legendItem} ${styles.legendToggle} ${visibleKinds.agent ? '' : styles.legendToggleOff}`}>
              <input
                type="checkbox"
                className={styles.legendCheckbox}
                checked={visibleKinds.agent}
                onChange={(e) => setVisibleKinds((v) => ({ ...v, agent: e.target.checked }))}
              />
              <i className={`${styles.swatchAgent} ${visibleKinds.agent ? styles.swatchChecked : ''}`} />Agent
            </label>
            <label className={`${styles.legendItem} ${styles.legendToggle} ${visibleKinds.folder ? '' : styles.legendToggleOff}`}>
              <input
                type="checkbox"
                className={styles.legendCheckbox}
                checked={visibleKinds.folder}
                onChange={(e) => setVisibleKinds((v) => ({ ...v, folder: e.target.checked }))}
              />
              <i className={`${styles.swatchFolder} ${visibleKinds.folder ? styles.swatchChecked : ''}`} />Folder
            </label>
          </div>
          <div className={styles.legendGroup}>
            <span className={styles.legendGroupLabel}>EDGES</span>
            <span className={styles.legendItem}><i className={styles.lineBlue} />invokes</span>
            <span className={styles.legendItem}><i className={styles.lineOrange} />uses agent</span>
            <span className={styles.legendItem}><i className={styles.lineYellow} />reads / writes</span>
          </div>
          <span className={styles.legendHint}>
            {editMode ? 'Drag from an orchestrator handle to a skill to attach it' : 'Double-click a node to open it'}
          </span>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.canvas}>
          {loading ? (
            <div className={styles.empty}>LOADING GRAPH…</div>
          ) : parents.length === 0 ? (
            <div className={styles.empty}>
              No skills have relationships yet.{' '}
              {editMode
                ? 'Create a new orchestrator to begin.'
                : 'Link child skills or agents to a skill on the SKILLS page, or switch to EDIT to build an orchestrator.'}
            </div>
          ) : model.nodes.length === 0 ? (
            <div className={styles.empty}>Select an orchestrator to view its graph.</div>
          ) : (
            <GraphCanvas
              key={modelKey}
              model={displayModel}
              editMode={editMode}
              onNavigateToSkill={onNavigateToSkill}
              onNavigateToAgent={onNavigateToAgent}
              onConnectChild={handleConnectChild}
            />
          )}
        </div>

        {editMode && selectedSkill && (
          <aside className={styles.inspector} aria-label="Orchestrator inspector">
            <div className={styles.inspectorHead}>
              <span className={styles.inspectorTitle}>{selectedSkill.displayName || selectedSkill.name}</span>
              {badge && <span className={`${styles.badge} ${badge.cls}`}>{badge.text}</span>}
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>EXECUTION MODE</span>
              <div className={styles.modeRow}>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="mode"
                    checked={draftConfig.mode === 'sequential'}
                    onChange={() => setConfigField('mode', 'sequential')}
                  />
                  Sequential
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="mode"
                    checked={draftConfig.mode === 'parallel'}
                    onChange={() => setConfigField('mode', 'parallel')}
                  />
                  Parallel
                </label>
              </div>
              <span className={styles.hint}>
                {draftConfig.mode === 'sequential'
                  ? 'Steps run one-by-one in the order below.'
                  : 'All steps are launched at once as background tasks.'}
              </span>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>OUTPUT FOLDER</span>
              <div className={styles.pathRow}>
                <input
                  className={styles.input}
                  type="text"
                  value={draftConfig.outputDir}
                  placeholder="e.g. /Users/you/reports"
                  onChange={(e) => setConfigField('outputDir', e.target.value)}
                />
                <button className={styles.btnSm} onClick={() => browseInto((p) => setConfigField('outputDir', p))}>
                  Browse…
                </button>
              </div>
              <span className={styles.hint}>Default folder where step outputs are written.</span>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>CONSOLIDATED OUTPUT FILE (optional)</span>
              <input
                className={styles.input}
                type="text"
                value={draftConfig.finalOutput ?? ''}
                placeholder="e.g. summary-<SESSION_ID>.md"
                onChange={(e) => setConfigField('finalOutput', e.target.value)}
              />
              <span className={styles.hint}>If set, a final step merges all step outputs into this file.</span>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>STEPS ({draftOrder.length}) — RUN ORDER</span>
              {draftOrder.length === 0 ? (
                <div className={styles.emptySteps}>
                  No steps attached. Attach an existing skill below, drag a connection on the canvas, or create a new
                  skill node.
                </div>
              ) : (
                <ol className={styles.stepList}>
                  {draftOrder.map((childName, i) => {
                    const child = skillByName.get(childName)
                    const cfg = draftConfig.children?.[childName] ?? {}
                    return (
                      <li key={childName} className={styles.step}>
                        <div className={styles.stepHead}>
                          <span className={styles.stepIndex}>{i + 1}</span>
                          <span className={styles.stepName} title={childName}>
                            {child?.displayName || childName}
                            {!child && <span className={styles.missingTag}> (missing)</span>}
                          </span>
                          <span className={styles.stepActions}>
                            <button
                              className={styles.iconBtn}
                              onClick={() => moveChild(i, -1)}
                              disabled={i === 0}
                              title="Move up"
                              aria-label={`Move ${childName} up`}
                            >
                              ↑
                            </button>
                            <button
                              className={styles.iconBtn}
                              onClick={() => moveChild(i, 1)}
                              disabled={i === draftOrder.length - 1}
                              title="Move down"
                              aria-label={`Move ${childName} down`}
                            >
                              ↓
                            </button>
                            <button
                              className={styles.iconBtnDanger}
                              onClick={() => detachChild(childName)}
                              title="Detach"
                              aria-label={`Detach ${childName}`}
                            >
                              ✕
                            </button>
                          </span>
                        </div>
                        <div className={styles.stepIo}>
                          <label className={styles.ioField}>
                            <span>Input folder</span>
                            <div className={styles.pathRow}>
                              <input
                                className={styles.input}
                                type="text"
                                value={cfg.inputDir ?? ''}
                                placeholder={
                                  draftConfig.mode === 'parallel' ? 'optional — no input by default' : 'inherits previous step'
                                }
                                onChange={(e) => setChildField(childName, 'inputDir', e.target.value)}
                              />
                              <button
                                className={styles.btnSm}
                                onClick={() => browseInto((p) => setChildField(childName, 'inputDir', p))}
                              >
                                …
                              </button>
                            </div>
                          </label>
                          <label className={styles.ioField}>
                            <span>Output folder</span>
                            <div className={styles.pathRow}>
                              <input
                                className={styles.input}
                                type="text"
                                value={cfg.outputDir ?? ''}
                                placeholder="inherits orchestrator output"
                                onChange={(e) => setChildField(childName, 'outputDir', e.target.value)}
                              />
                              <button
                                className={styles.btnSm}
                                onClick={() => browseInto((p) => setChildField(childName, 'outputDir', p))}
                              >
                                …
                              </button>
                            </div>
                          </label>
                          <label className={styles.ioField}>
                            <span>Output file</span>
                            <input
                              className={styles.input}
                              type="text"
                              value={cfg.outputFile ?? ''}
                              placeholder={`${childName}-output-<SESSION_ID>.md`}
                              onChange={(e) => setChildField(childName, 'outputFile', e.target.value)}
                            />
                          </label>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>ATTACH A STEP</span>
              <div className={styles.attachRow}>
                <OrchestratorCombobox
                  value=""
                  options={attachable.map((s) => ({ name: s.name, label: s.displayName || s.name }))}
                  onChange={(name) => { if (name) attachChild(name) }}
                  disabled={attachable.length === 0}
                  placeholder="Search skills…"
                  emptyPlaceholder="No skills available"
                  listId="attach-step-combo-list"
                  title="Search and attach a child skill"
                />
                <button className={styles.btnSm} onClick={() => setShowNewSkill(true)} title="Scaffold a new child skill">
                  ＋ New
                </button>
              </div>
            </div>

            <div className={styles.actions}>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handleSave}
                disabled={busy}
                title="Persist the configuration and regenerate this skill's SKILL.md"
              >
                {busy ? 'Working…' : 'Save'}
              </button>
              <button className={styles.btn} onClick={handlePreview} disabled={busy}>
                Preview
              </button>
            </div>
            {statusMsg && <div className={styles.statusMsg}>{statusMsg}</div>}
            {selectedSkill.orchestrationStatus === 'broken' && (
              <div className={styles.brokenNote}>
                ⚠ The managed block in this skill&apos;s SKILL.md was hand-edited or damaged. Generate will refuse to
                overwrite it until the markers are restored.
              </div>
            )}
          </aside>
        )}
      </div>

      {showNewSkill && (
        <NewSkillModal
          orchestratorName={selectedParent}
          existingNames={new Set(skills.map((s) => s.name))}
          onClose={() => setShowNewSkill(false)}
          onCreated={(name) => {
            setShowNewSkill(false)
            attachChild(name)
            reload()
          }}
        />
      )}

      {showNewOrch && (
        <NewOrchestratorModal
          existingNames={new Set(skills.map((s) => s.name))}
          onClose={() => setShowNewOrch(false)}
          onCreated={(name) => {
            setShowNewOrch(false)
            setSelectedParent(name)
            reload()
          }}
        />
      )}

      {previewText !== null && (
        <div className={styles.modalOverlay} onClick={() => setPreviewText(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>GENERATED WORKFLOW PREVIEW</div>
            <pre className={styles.preview}>{previewText}</pre>
            <div className={styles.modalActions}>
              <button className={styles.btn} onClick={() => setPreviewText(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface NewSkillModalProps {
  orchestratorName: string
  existingNames: Set<string>
  onClose: () => void
  onCreated: (name: string) => void
}

function NewSkillModal({ orchestratorName, existingNames, onClose, onCreated }: NewSkillModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const create = useCallback(async () => {
    const clean = name.trim().toLowerCase()
    if (!NAME_PATTERN.test(clean)) {
      setError('Use lowercase letters, numbers and hyphens only.')
      return
    }
    if (existingNames.has(clean)) {
      setError('A skill with that name already exists.')
      return
    }
    setBusy(true)
    try {
      const res = await window.gridwatchAPI.createSkill(clean, description.trim() || 'TODO: Add a description')
      if (!res.ok) {
        setError(res.error ?? 'Failed to create skill.')
        return
      }
      // Build the orchestration child scaffold and write it over the default SKILL.md.
      const { renderChildScaffold, applyPastedBody } = await import('../lib/orchestration')
      let scaffold = renderChildScaffold(clean, description.trim(), orchestratorName)
      scaffold = applyPastedBody(scaffold, body)
      await window.gridwatchAPI.saveSkillFile(clean, 'SKILL.md', scaffold)
      onCreated(clean)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [name, description, body, existingNames, orchestratorName, onCreated])

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>NEW CHILD SKILL</div>
        <label className={styles.modalField}>
          <span>Name</span>
          <input
            className={styles.input}
            type="text"
            value={name}
            placeholder="my-step-skill"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label className={styles.modalField}>
          <span>Description</span>
          <input
            className={styles.input}
            type="text"
            value={description}
            placeholder="What this step does"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className={styles.modalField}>
          <span>Skill instructions (optional — pasted into the work step)</span>
          <textarea
            className={styles.textarea}
            value={body}
            placeholder="Describe exactly what this step should do with its input and produce as output."
            onChange={(e) => setBody(e.target.value)}
            rows={6}
          />
        </label>
        {error && <div className={styles.modalError}>{error}</div>}
        <div className={styles.modalActions}>
          <button className={styles.btn} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create & attach'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface NewOrchestratorModalProps {
  existingNames: Set<string>
  onClose: () => void
  onCreated: (name: string) => void
}

function NewOrchestratorModal({ existingNames, onClose, onCreated }: NewOrchestratorModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const create = useCallback(async () => {
    const clean = name.trim().toLowerCase()
    if (!NAME_PATTERN.test(clean)) {
      setError('Use lowercase letters, numbers and hyphens only.')
      return
    }
    if (existingNames.has(clean)) {
      setError('A skill with that name already exists.')
      return
    }
    setBusy(true)
    try {
      const res = await window.gridwatchAPI.createSkill(clean, description.trim() || 'Orchestrator skill')
      if (!res.ok) {
        setError(res.error ?? 'Failed to create skill.')
        return
      }
      const ok = await window.gridwatchAPI.setSkillOrchestration(clean, {
        isOrchestrator: true,
        mode: 'sequential',
        outputDir: '',
        children: {},
        schemaVersion: 1,
      })
      if (!ok) {
        setError('Created the skill but failed to mark it as an orchestrator.')
        return
      }
      onCreated(clean)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [name, description, existingNames, onCreated])

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>NEW ORCHESTRATOR</div>
        <label className={styles.modalField}>
          <span>Name</span>
          <input
            className={styles.input}
            type="text"
            value={name}
            placeholder="my-orchestrator"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label className={styles.modalField}>
          <span>Description</span>
          <input
            className={styles.input}
            type="text"
            value={description}
            placeholder="What this orchestrator coordinates"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {error && <div className={styles.modalError}>{error}</div>}
        <div className={styles.modalActions}>
          <button className={styles.btn} onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SkillGraphPage
