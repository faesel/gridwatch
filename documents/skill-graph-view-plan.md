# Plan: Skill Relationship Graph (Phase 1)

## Problem statement

Skill → child-skill and skill → agent relationships are only visible as flat chip lists in the
Skills detail pane. There is no way to *see* the shape of a skill's dependency tree at a glance.

## Approach

A dedicated **GRAPH** section in the sidebar renders the relationships as an interactive
node-link diagram built on **React Flow (`@xyflow/react`, MIT)** — see
`graph-view-technology-evaluation.md`. The user picks a **parent skill** (only skills that have
child skills or linked agents are selectable) from a dropdown; the graph then shows that skill as
the root, its child skills laid out by depth (BFS, cycle-protected), and the agents linked at each
level in a separate lane. **Double-clicking a node** opens that skill (Skills page) or agent
(Agents page). Everything is styled with `var(--tron-*)` tokens so it themes in both *The Grid*
and *Programs*. The page is **code-split** so React Flow loads only when the section is opened.

The graph is derived at render time from the already-loaded `getSkills()` + `getCustomAgents()`
data — **no new IPC and no persisted data**.

## Status: implemented

| Task | Done | Test |
|---|---|---|
| 1. Audit + install `@xyflow/react` | ✅ | `package-audit` clean (0 vulns, MIT); `npm audit` 0 vulnerabilities |
| 2. `SkillGraphPage` — parent dropdown, BFS layout, skill/agent nodes + typed edges | ✅ | `npx tsc --noEmit` + `npm run build` clean |
| 3. Tron-styled custom nodes, edges, controls, minimap | ✅ | Colours use `var(--tron-*)`; verified in both themes |
| 4. Double-click navigation to skill/agent | ✅ | `onNodeDoubleClick` → `navigateToSkill` / `navigateToAgent` |
| 5. App wiring: GRAPH nav item + `focusSkill` plumbing into `SkillsPage` | ✅ | New nav item renders; selecting a graph skill node focuses it on the Skills page |
| 6. Code-split the page | ✅ | React Flow is a separate 176 KB chunk; main bundle dropped ~895→718 KB |

Verified against real data: selecting **chained-squad** renders its 4 child skills, each with its
linked specialist agent.

## Files

- `src/pages/SkillGraphPage.tsx` — page, `buildGraph()` layout, custom `SkillNode`/`AgentNode`.
- `src/pages/SkillGraphPage.module.css` — Tron styling + React Flow chrome overrides.
- `src/App.tsx` — `GRAPH` nav item, lazy import + `Suspense`, `navigateToSkill`/`focusSkill`.
- `src/pages/SkillsPage.tsx` — `focusSkill`/`onFocusHandled` props to auto-select a skill.

## Risks

- **Risk:** New dependency (React Flow + zustand) increases bundle size.
  **Mitigation:** Page is code-split (lazy + Suspense); React Flow stays out of the initial bundle.
- **Risk:** A relationship points at a deleted skill/agent.
  **Mitigation:** Edges are only drawn to rendered nodes; missing children are skipped.
- **Risk:** Cyclic `childSkills` relationships.
  **Mitigation:** BFS is `visited`-guarded, so cycles can't loop.

## Security

- Read-only: no new IPC, no writes to Copilot- or GridWatch-owned files. No network surface; all
  rendering is local. `@xyflow/react` is MIT with 0 known vulnerabilities (OSV.dev).

## Accessibility

- Nodes are real DOM elements (focusable). Edge meaning is conveyed by colour **and** the legend
  labels, not colour alone. Double-click is the open action; the equivalent chip lists on the
  Skills page remain a fully keyboard-operable alternative. Contrast verified in both themes.

## User Guidance

- Dropdown labelled **PARENT SKILL**; a legend maps node/edge colours; a hint reads
  "Double-click a node to open it." Empty state explains how to create relationships when no
  parent skills exist.

## Future (later phases — see `skill-agent-designer-plan.md`)

Editable canvas (drag to connect), artifact/output nodes, orchestration sequencing, and
orchestrator-skill generation, with JSON Canvas (`.canvas`) for layout persistence/interop.
