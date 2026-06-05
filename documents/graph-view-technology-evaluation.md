# Technology Evaluation: Graph / Canvas View for Skills & Agents

## Problem statement

GridWatch needs to visualise skills, their child skills, linked agents, and (later) the
outputs they produce. Two related but distinct experiences are in scope: a **read-only
relationship graph** (see `skill-graph-view-plan.md`) and an **editable, Obsidian-Canvas-style
designer** (see `skill-agent-designer-plan.md`). The user specifically likes Obsidian's
**Canvas** — an infinite, pan/zoom board of draggable cards with hand-drawn connections — and
wants something similar. This document evaluates the technology to build it.

## What "Obsidian-like" actually means here

Obsidian ships two different things; it helps to separate them:

- **Graph view** — an auto-laid-out, force-directed node-link diagram (you don't position
  nodes; physics does). Good for *seeing structure* at a glance. This maps to our read-only
  graph.
- **Canvas** — an infinite whiteboard where the **user** places and drags cards and draws
  arrows between them. Layout is manual and persisted. This maps to our designer.

The user referenced **Canvas**, so the editable surface is the priority, with the read-only
graph as the simpler first deliverable.

A useful, directly relevant fact: Obsidian open-sourced the Canvas file format as
**JSON Canvas** (`.canvas`, MIT, https://jsoncanvas.org). It's a tiny spec — `nodes[]`
(with `id`, `x`, `y`, `width`, `height`, `type`, `color`) and `edges[]` (`fromNode`,
`toNode`, `fromSide`, `toSide`, `label`, `color`). Adopting it as our storage format would
give longevity, human-readable diffs, and even interoperability (a GridWatch canvas could be
opened in Obsidian and vice-versa). This is independent of whichever rendering library we pick.

---

## Candidates evaluated

All figures gathered 2026-06-04 from the npm registry / bundlephobia.

| Library | Latest | Licence | Bundle (min / gzip) | Runtime deps | Downloads/wk | Fit |
|---|---|---|---|---|---|---|
| **React Flow** (`@xyflow/react`) | 12.11.0 | **MIT** | 179 KB / 57 KB | 3 (zustand, classcat, @xyflow/system) | ~6.6M | **Editable node canvas — best fit** |
| `reactflow` (old name, v11) | 11.11.4 | MIT | — | 6 (scoped subpackages) | ~1.9M | Legacy; superseded by `@xyflow/react` |
| **Cytoscape.js** | 3.34.0 | **MIT** | 420 KB / 132 KB | **0** | ~8.7M | **Read-only graph / large graphs** |
| **tldraw** | 5.1.0 | **Proprietary** (no production use without a commercial licence) | large | many (tiptap, radix, idb…) | ~223k | Closest to Canvas *feel*, but **licence blocks us** |
| `d3-force` + bespoke SVG | 3.0.0 | ISC | ~30 KB / ~11 KB | 3 (small) | ~14.6M | Build-your-own; max effort/control |
| Bespoke SVG, no physics | — | n/a (our code) | 0 | 0 | n/a | Current `skill-graph-view-plan.md` approach |

### React Flow — `@xyflow/react` (recommended for the designer)
- **Pros:** Purpose-built for exactly this — an infinite, pan/zoom canvas of **draggable
  nodes** with **connectable handles**, custom **React components as nodes/edges** (so each
  node is a Tron-styled skill/agent/artifact card using our existing CSS), plus first-party
  minimap, controls, background grid and selection. MIT, React-native (we're already React +
  zustand-compatible), actively maintained, ~6.6M downloads/week, only 3 small runtime deps,
  ~57 KB gzip and tree-shakeable. This is the de-facto standard for node-based editors and is
  the closest *legally-clean* match to the Obsidian-Canvas interaction model.
- **Cons:** It's a node-graph editor, not a freeform whiteboard — no built-in drawing/ink,
  text-card resizing, or frames (we don't need those). Custom edge routing/arrow styling to
  match Obsidian's curves takes some CSS/SVG work. State lives in a zustand store we'd adopt.
- **Verdict:** **Primary recommendation for the editable designer.**

### Cytoscape.js (recommended for the read-only graph, if we outgrow bespoke SVG)
- **Pros:** Mature graph library with excellent **automatic layouts** (breadthfirst, concentric,
  cose force-directed, dagre via extension) — ideal for the read-only "show me the shape"
  view that mirrors Obsidian's *graph* mode. MIT, **zero runtime dependencies**, canvas-rendered
  so it scales to large graphs, ~8.7M downloads/week.
- **Cons:** Not React-native (imperative API; you manage a Cytoscape instance in a ref). Nodes
  are canvas-drawn, not DOM/React — styling is via Cytoscape's own stylesheet, so our Tron CSS
  tokens must be passed in as JS values rather than reused directly. Heavier bundle (132 KB
  gzip).
- **Verdict:** **Best option for the read-only graph** *if* the bespoke-SVG approach in
  `skill-graph-view-plan.md` proves insufficient (deep trees, force layout, large global map).
  For the small, shallow trees we have today, bespoke SVG is still the lighter starting point.

### tldraw (the closest *feel*, but ruled out)
- **Pros:** The most polished infinite-canvas/whiteboard in the ecosystem — genuinely the
  nearest thing to Obsidian Canvas out of the box (drag cards, draw arrows, frames, text).
- **Cons / blocker:** **Licensing.** tldraw 5.x ships under a proprietary licence that
  **forbids use in "Production Environments"** and enforces a **License Key**; production use
  requires a paid commercial licence (the free tier shows a "made with tldraw" watermark).
  GridWatch is a freely-distributed, MIT-licensed desktop app shipped to end users — that is
  precisely a production environment. Using tldraw would either require buying a commercial
  licence or carrying a watermark and a non-free licence inside an MIT project.
- **Verdict:** **Not recommended** despite the great UX, on licensing grounds. (If a paid
  licence were ever acceptable, revisit — but default to MIT.)

### d3-force + bespoke SVG / current bespoke SVG
- **Pros:** No third-party UI dependency, full control, tiny footprint, themes natively with
  `var(--tron-*)`. `d3-force` (ISC) adds physics if we want auto-layout without a full library.
- **Cons:** We hand-build dragging, pan/zoom, edge routing, hit-testing, minimap — significant
  effort to reach React Flow's polish, and easy to get subtly wrong (touch targets, focus,
  performance). Fine for **read-only**, painful for an **editable** canvas.
- **Verdict:** Good for the read-only Phase 0; **not** worth it for the editable designer when
  React Flow exists under MIT.

---

## Recommendation

A **two-layer** approach, matching the two plans:

1. **Read-only relationship graph (Phase 0):** keep the **bespoke SVG** layered layout from
   `skill-graph-view-plan.md` for now (zero deps, themes perfectly, graphs are small). Hold
   **Cytoscape.js** in reserve and adopt it only if we need force-directed/auto layouts or a
   large global map.

2. **Editable designer / canvas (Phases 1–3):** **DECISION CONFIRMED — build on React Flow
   (`@xyflow/react` v12, MIT).** It's the React-native, well-maintained library that most closely reproduces the
   Obsidian-Canvas interaction (infinite pan/zoom board, draggable nodes, connectable edges)
   while letting every node be a Tron-styled React card. Render skills/agents/artifacts as
   custom node types and our typed relationships (`requires` / `invokes` / `uses-agent` /
   `extends` / `outputs`) as custom edge types with distinct arrowheads + labels.

3. **Storage/interop:** adopt the **JSON Canvas** (`.canvas`, MIT) shape for persisted layouts
   where practical — node positions, sizes, colours, and edges map almost 1:1 to React Flow's
   model. This gives portable, human-readable, diff-friendly files and potential Obsidian
   interop, independent of the renderer. (Our authoritative *relationships* still live in each
   skill's `gridwatch.json`; the `.canvas` file would carry **layout** — positions/colours.)

**Rule out tldraw** for shipped builds on licensing grounds.

---

## JSON Canvas feasibility (`jsoncanvas.org`)

**Verdict: feasible and recommended — as the on-disk *layout/interop* format, not as the
source of truth for relationships.** The spec (v1.0, 2024-03-11, MIT) is tiny, stable, plain
JSON, and maps almost 1:1 onto both React Flow and our domain model. It is trivial to read/write
by hand; an MIT helper (`@trbn/jsoncanvas`) exists if wanted, but no dependency is required.

### How our model maps onto the spec

| GridWatch concept | JSON Canvas representation | Notes |
|---|---|---|
| Skill node | `type: "file"`, `file: "~/.copilot/skills/<name>/SKILL.md"` | Using `file` nodes (not `text`) makes nodes point at the real file → click-through works, and the canvas opens meaningfully **in Obsidian** too. |
| Agent node | `type: "file"`, `file: "~/.copilot/agents/<name>.agent.md"` | Same benefit. |
| Artifact / output file | `type: "file"`, `file: "<output path>"` (or `text` if the file doesn't exist yet) | Output paths like `squad-review-<ID>.md`. |
| Node *kind* (skill/agent/artifact) | `color` preset (`"5"` cyan = skill, `"2"` orange = agent, `"3"` artifact) **+** a custom `gridwatchKind` key | Colour presets are intentionally app-defined, so we bind them to Tron tokens. |
| Orchestration step (parallel/sequential group) | `type: "group"` with a `label` (e.g. "Parallel: reviewers") | Groups are visual containers — a natural fit for sequencing steps. |
| Edge (relationship) | `edges[]` entry: `fromNode`/`toNode`, `toEnd: "arrow"`, `label`, `color` | Direction + arrowhead are native. |
| Edge *type* (`requires`/`invokes`/`uses-agent`/`extends`/`outputs`) | edge `label` + `color` preset **+** custom `gridwatchType` key | The spec has no typed edges, so type is carried by label/colour and a custom key for lossless round-trip. |
| Node layout (position/size) | `x`, `y`, `width`, `height` (integers, px) | Direct 1:1 with React Flow `position` + node dimensions. |

### Why it fits

- **React Flow interop is near-trivial:** `id/x/y/width/height/color` ↔ React Flow
  `id/position/style`; `fromNode/toNode` ↔ `source/target`; `fromSide/toSide` (top/right/bottom/
  left) ↔ React Flow handle positions. A ~50-line bidirectional converter covers it.
- **Extensibility:** extensibility is a stated goal of the format; adding custom keys
  (`gridwatchKind`, `gridwatchType`) is safe — other tools (Obsidian) ignore unknown keys while
  we read them for full fidelity.
- **Portability / ownership:** human-readable, diff-friendly, file-over-app; a GridWatch canvas
  could be opened/edited in Obsidian and round-tripped back.
- **No new runtime dependency required** — the format is small enough to serialise directly.

### Limits / caveats (why it's layout, not authority)

- **Edges are untyped and colours are undefined** by the spec. Our five relationship *types*
  survive only via label + colour + a custom key; a third-party reader (Obsidian) sees arrows
  and labels but not our semantics. Acceptable for interop, but it means the `.canvas` file is a
  *projection*, not the canonical model.
- **Whole-graph file vs per-skill truth.** Our authoritative relationships live **per skill** in
  each `~/.copilot/skills/<name>/gridwatch.json` (consumed by the app's logic). A `.canvas` is a
  single whole-graph document. Making `.canvas` authoritative would fragment/duplicate that data
  and fight the existing model. So: **keep `gridwatch.json` authoritative for relationships**;
  use JSON Canvas to persist **layout** (node positions/sizes/colours) and for **import/export**.
- **Frozen, low-activity spec.** v1.0 has been unchanged since 2024-03-11. That's fine (it's a
  deliberately small, stable format) but don't expect new features.
- **No first-class "handle" model** beyond four sides — sufficient for our needs.

### Recommended use in GridWatch

1. Store canvas **layout** (positions/sizes/colours/groups) in a `.canvas` JSON-Canvas file
   (e.g. `~/.copilot/gridwatch-skill-canvas.canvas`), while **relationships remain authoritative
   in each skill's `gridwatch.json`**.
2. Use `file` nodes pointing at real `SKILL.md` / `agent.md` / output paths for semantic
   richness and Obsidian click-through.
3. Provide **Import/Export `.canvas`** actions so designs are portable (and Obsidian-compatible).
4. Encode node-kind and edge-type via colour presets + labels **plus** custom `gridwatch*` keys
   for lossless round-trip within GridWatch.

---

## Risks

- **Risk:** Adding React Flow (+ its zustand dependency) increases bundle size and introduces a
  new state store.
  **Impact:** Larger renderer bundle (~57 KB gzip), a second state mechanism alongside React state.
  **Mitigation:** Code-split the designer page so React Flow loads only when opened; keep its
  zustand store scoped to the canvas; tree-shake unused extras (minimap/controls optional).
- **Risk:** Any new dependency may carry transitive vulnerabilities or maintenance risk.
  **Impact:** Supply-chain exposure in a desktop app.
  **Mitigation:** Run the mandatory **package-audit** skill before installing `@xyflow/react`
  (and `cytoscape` if adopted); pin versions; both are MIT with healthy adoption and small,
  well-known dependency trees.
- **Risk:** tldraw's licence misread leading to accidental adoption.
  **Impact:** Legal/licence incompatibility shipped to users.
  **Mitigation:** Explicitly excluded here; document the MIT-only constraint in the plan.
- **Risk:** Library API churn (React Flow renamed `reactflow` → `@xyflow/react` at v12).
  **Impact:** Future upgrade friction.
  **Mitigation:** Start on the current `@xyflow/react` v12 line, not the legacy `reactflow`
  package; isolate usage behind our own canvas component.
- **Risk:** Treating the `.canvas` (JSON Canvas) file as authoritative for relationships.
  **Impact:** Data fragmentation/duplication against the per-skill `gridwatch.json`, and loss of
  our typed-edge semantics (the spec has no typed edges).
  **Mitigation:** Keep `gridwatch.json` authoritative for relationships; use JSON Canvas only for
  **layout** and **import/export**, carrying type/kind via colour + label + custom `gridwatch*`
  keys for round-trip.

## Security

- **No new network surface:** all candidates render locally; no data leaves the machine. The
  designer reads/writes only GridWatch-owned files (`gridwatch.json`, an optional `.canvas`
  layout file) — never Copilot-owned files.
- **Dependencies:** React Flow's deps (zustand, classcat, @xyflow/system) and Cytoscape (zero
  deps) are small and reputable; still gate the install behind **package-audit**. tldraw pulls
  a large tree (tiptap, radix, idb) — another reason to avoid it.
- **No code execution from data:** JSON Canvas / `gridwatch.json` are pure data; parse with
  existing safe JSON handling and validate node ids (`/^[a-z0-9][a-z0-9-]*$/`). Any generated
  `SKILL.md` is text written via existing IPC, not executed by GridWatch.
- Assessment performed: the only material concern is supply-chain (mitigated by package-audit +
  MIT-only policy); no auth, secrets, PII, or injection vectors are introduced.

## Accessibility

- React Flow nodes are real DOM elements, so each card can carry proper roles, `aria-label`s,
  and a visible focus ring, and be reachable by keyboard — better than a pure `<canvas>`
  (Cytoscape) for AT. Provide keyboard alternatives for "add node"/"connect" rather than
  drag-only, and convey edge **type by arrowhead + label**, not colour alone (WCAG 2.1 AA,
  4.5:1 contrast verified in both themes). Respect `prefers-reduced-motion` for pan/zoom; keep
  ≥44 px hit targets. The existing chip editor remains a fully keyboard-operable fallback for
  the same edits.

## User Guidance

- Empty-canvas state: "Drag a skill or agent from the palette to start designing." Persistent
  legend mapping each edge type to its arrow style. Tooltips on canvas controls (fit/zoom/save)
  and an `ⓘ` explaining that layout is saved to a `.canvas` file while relationships save to
  each skill. Actionable validation messages ("Can't link a skill to itself", "Agents connect
  via 'uses-agent' only"). A short note that GridWatch canvases use the open JSON Canvas format.

---

## Suggested next steps (when implementation is approved)

1. Build the read-only graph with **bespoke SVG** per `skill-graph-view-plan.md` (no new dep).
2. Spike the designer on **`@xyflow/react`** behind a code-split route; run **package-audit**
   first. Prototype the three node types + five edge types against the **chained-review-squad**
   example.
3. Adopt **JSON Canvas** (`.canvas`) for layout persistence + import/export (see feasibility
   section): `file` nodes pointing at real SKILL.md/agent.md/output paths, `group` nodes for
   orchestration steps, custom `gridwatch*` keys for kind/type. Keep `gridwatch.json`
   authoritative for relationships.
4. Revisit Cytoscape.js only if the read-only graph needs auto/force layouts or a global map.
