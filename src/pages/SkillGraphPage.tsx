import { useState, useEffect, useMemo, useCallback } from 'react'
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
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { SkillData } from '../types/skill'
import type { CustomAgentData } from '../types/agent'
import styles from './SkillGraphPage.module.css'

interface NodeData extends Record<string, unknown> {
  label: string
  name: string
  kind: 'skill' | 'agent'
  enabled: boolean
  missing: boolean
}

const COL_W = 280
const ROW_H = 120

function SkillNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className={`${styles.node} ${styles.skillNode} ${data.enabled ? '' : styles.disabled}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.nodeKind}>SKILL</div>
      <div className={styles.nodeLabel}>{data.label}</div>
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

const nodeTypes: NodeTypes = { skill: SkillNode, agent: AgentNode }

interface GraphModel {
  nodes: Node<NodeData>[]
  edges: Edge[]
}

function buildGraph(rootName: string, skills: SkillData[], agents: CustomAgentData[]): GraphModel {
  const skillByName = new Map(skills.map((s) => [s.name, s]))
  const agentByName = new Map(agents.map((a) => [a.name, a]))

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
      nodes.push({
        id: `skill:${name}`,
        type: 'skill',
        position: { x: d * COL_W, y: i * ROW_H },
        data: { label: sk.displayName || sk.name, name, kind: 'skill', enabled: sk.enabled, missing: false },
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

  return { nodes, edges }
}

interface CanvasProps {
  model: GraphModel
  onNavigateToSkill: (name: string) => void
  onNavigateToAgent: (name: string) => void
}

function GraphCanvas({ model, onNavigateToSkill, onNavigateToAgent }: CanvasProps) {
  const [nodes, , onNodesChange] = useNodesState(model.nodes)
  const [edges, , onEdgesChange] = useEdgesState(model.edges)

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const data = node.data as NodeData
      if (data.missing) return
      if (data.kind === 'agent') onNavigateToAgent(data.name)
      else onNavigateToSkill(data.name)
    },
    [onNavigateToSkill, onNavigateToAgent],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeDoubleClick={onNodeDoubleClick}
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

interface SkillGraphPageProps {
  refreshKey?: number
  onNavigateToSkill: (name: string) => void
  onNavigateToAgent: (name: string) => void
}

function SkillGraphPage({ refreshKey, onNavigateToSkill, onNavigateToAgent }: SkillGraphPageProps) {
  const [skills, setSkills] = useState<SkillData[]>([])
  const [agents, setAgents] = useState<CustomAgentData[]>([])
  const [selectedParent, setSelectedParent] = useState<string>('')
  const [loading, setLoading] = useState(true)

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
  }, [refreshKey])

  // Skills that orchestrate others (have child skills or linked agents) are the selectable parents.
  const parents = useMemo(
    () =>
      skills
        .filter((s) => (s.childSkills?.length ?? 0) > 0 || (s.linkedAgents?.length ?? 0) > 0)
        .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name)),
    [skills],
  )

  // Default to the first parent, and revalidate if the current selection disappears after a refresh.
  useEffect(() => {
    if (parents.length === 0) {
      if (selectedParent) setSelectedParent('')
      return
    }
    if (!parents.some((p) => p.name === selectedParent)) {
      setSelectedParent(parents[0].name)
    }
  }, [parents, selectedParent])

  const model = useMemo(
    () => (selectedParent ? buildGraph(selectedParent, skills, agents) : { nodes: [], edges: [] }),
    [selectedParent, skills, agents],
  )

  // Remount the canvas only when the graph's structure actually changes, so a 30s data
  // refresh that returns identical relationships preserves any manual node dragging.
  const modelKey = useMemo(
    () => `${selectedParent}|${model.nodes.map((n) => n.id).join(',')}|${model.edges.map((e) => e.id).join(',')}`,
    [selectedParent, model],
  )

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.title}>SKILLS GRAPH</div>
        <label className={styles.pickerLabel}>
          PARENT SKILL
          <select
            className={styles.picker}
            value={selectedParent}
            onChange={(e) => setSelectedParent(e.target.value)}
            disabled={parents.length === 0}
          >
            {parents.length === 0 && <option value="">No parent skills</option>}
            {parents.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName || p.name}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.legend}>
          <span className={styles.legendItem}><i className={styles.swatchSkill} />Skill</span>
          <span className={styles.legendItem}><i className={styles.swatchAgent} />Agent</span>
          <span className={styles.legendItem}><i className={styles.lineBlue} />invokes</span>
          <span className={styles.legendItem}><i className={styles.lineOrange} />uses agent</span>
          <span className={styles.legendHint}>Double-click a node to open it</span>
        </div>
      </div>
      <div className={styles.canvas}>
        {loading ? (
          <div className={styles.empty}>LOADING GRAPH…</div>
        ) : parents.length === 0 ? (
          <div className={styles.empty}>
            No skills have relationships yet. Link child skills or agents to a skill on the SKILLS page to see them mapped here.
          </div>
        ) : model.nodes.length === 0 ? (
          <div className={styles.empty}>Select a parent skill to view its graph.</div>
        ) : (
          <GraphCanvas
            key={modelKey}
            model={model}
            onNavigateToSkill={onNavigateToSkill}
            onNavigateToAgent={onNavigateToAgent}
          />
        )}
      </div>
    </div>
  )
}

export default SkillGraphPage
