# Plan: Skill & Agent Designer (visual relationship editor)

> **Status:** forward-looking design. This builds directly on `documents/skill-graph-view-plan.md` — the **read-only** graph view is Phase 0/foundation; this document describes evolving it into an **editable** canvas. Deliver the read-only graph first, then layer editing on top.

## Problem statement

Skill relationships (`childSkills`, `linkedAgents`) can only be edited as flat chip lists, one skill at a time. The user wants a **visual designer**: a canvas onto which existing skills and agents are imported as nodes, where links can be drawn between them directly, and where the *meaning* of each link is expressed through a small, well-defined relationship vocabulary ("a basic language") rather than a single undifferentiated "child" edge.

## Proposed approach

Extend the placement-agnostic `SkillGraph` component from the graph-view plan into an interactive **designer surface** (likely the full-screen overlay / a dedicated "DESIGNER" section). The designer lets the user:

1. **Import** existing skills and agents from `~/.copilot/skills/` and `~/.copilot/agents/` onto a canvas (palette → drag, or "add to canvas").
2. **Draw links** by dragging from one node's handle to another; on drop, pick a **relationship type** from the vocabulary.
3. **Declare outputs** — attach **artifact/output nodes** (files a step produces) so the canvas shows not just *what runs* but *what it writes* and where (e.g. chained-squad's per-reviewer `review-*-<ID>.md` files consolidating into `squad-review-<ID>.md`).
4. **Sequence** the steps — order nodes and group them into parallel/serial stages, capturing orchestration flow (chained-squad runs four reviewers *in parallel*, then consolidates).
5. **Generate an orchestrator skill** — the designed graph can be *emitted* as a brand-new orchestrator skill (a `SKILL.md` like chained-squad) whose workflow is composed from **injectable preset sentences** (see "Orchestrator generation" below).
6. **Persist** the resulting links back into each skill's `gridwatch.json` via an extended `skills:set-relations` IPC, keeping the existing flat fields working for backward compatibility.

The worked reference throughout is the existing **chained-review-squad** skill: it `requires` four child skills (`dev-frontend`, `dev-performance`, `dev-security`, `dev-fallow`), each `uses-agent` its specialist reviewer, every reviewer `outputs` a `review-<area>-<ID>.md` file, and the orchestrator `outputs` the consolidated `squad-review-<ID>.md`. The designer should be able to *draw* that picture and *regenerate* that skill.

To keep the first editable iteration honest and reversible, persistence remains **GridWatch-owned** (only `gridwatch.json` per skill is written — never Copilot-owned files), and every typed link still validates that both endpoints exist and rejects self-reference, exactly as `skills:set-relations` does today.

A drag-to-connect canvas with handles, panning and zooming is non-trivial to hand-roll. This is the point at which adopting a maintained graph-interaction library becomes justified. **Decision (confirmed): the editable designer is built on React Flow (`@xyflow/react` v12, MIT)** — see `graph-view-technology-evaluation.md` for the full evaluation. Installation remains **subject to the mandatory `package-audit` skill**. The read-only graph stays bespoke SVG; only the *editable* designer pulls in React Flow. Persisted canvas **layout** uses the open **JSON Canvas** (`.canvas`) format; relationships stay authoritative in each skill's `gridwatch.json`.

---

## The "basic language" — a relationship vocabulary

Today there is effectively one edge meaning ("child skill") plus "linked agent". The designer introduces a small **typed relationship language** so links carry intent. Proposed v1 vocabulary (kept deliberately tiny):

| Type        | From → To        | Meaning                                                            | Visual |
|-------------|------------------|-------------------------------------------------------------------|--------|
| `requires`  | skill → skill    | The source needs the target to function (hard dependency).        | solid blue, filled arrowhead |
| `invokes`   | skill → skill    | The source may call the target during execution (soft/runtime).   | dashed blue, open arrowhead |
| `uses-agent`| skill → agent    | The source runs this agent (today's `linkedAgents`).              | dashed cyan, open arrowhead |
| `extends`   | skill → skill    | The source specialises/augments the target.                       | solid grey, hollow triangle |
| `outputs`   | skill/agent → artifact | The source writes/produces this file or report.             | solid orange, document icon |

Node kinds are therefore three: **skill**, **agent**, and **artifact** (an output file). Artifact nodes carry a `path` (which may contain placeholders like `<REVIEW_ID>`) and are leaves — they are produced, never run. In the chained-squad example, each reviewer skill has an `outputs` edge to `review-<area>-<ID>.md`, and the orchestrator has an `outputs` edge to the consolidated `squad-review-<ID>.md`.

Design rules for the language:
- **Closed set, extensible later.** A single `RelationType` union; rendering and validation switch on it. New verbs can be added without schema churn.
- **Directional and typed.** Each edge stores `{ from, to, type }`. `from`/`to` are canonical ids (skill folder name, or `agent:<name>`).
- **Backward compatible.** Existing `childSkills` map to `requires` (or a chosen default); existing `linkedAgents` map to `uses-agent`. On save, the typed model is **projected back** onto the legacy fields so older code keeps working (see Persistence).
- **Optional textual form (DSL).** For review/diffing/portability, the graph can serialise to a tiny human-readable line grammar, e.g.:
  ```
  chained-squad requires dev-frontend
  chained-squad requires dev-security
  chained-squad uses-agent security-reviewer
  dev-security outputs review-security-<ID>.md
  chained-squad outputs squad-review-<ID>.md
  dev-frontend extends base-reviewer
  ```
  Grammar: `<subject> <relation> <object>` — one statement per line, ids validated against existing skills/agents. This is a *view/export*, not the source of truth, and is round-trippable with the visual model.

> **Open decision:** whether v1 ships the full vocabulary above or starts with just `requires` + `uses-agent` (a typed rename of today's two edges) and adds `invokes`/`extends` later. See Open questions.

---

## Persistence model

Extend each skill's `gridwatch.json` with an optional typed `relations` array, **alongside** the legacy fields (which are kept in sync for backward compatibility):

```jsonc
// ~/.copilot/skills/<name>/gridwatch.json
{
  "tags": ["review"],
  "childSkills": ["dev-frontend", "dev-security"],   // legacy — kept in sync
  "linkedAgents": ["security-reviewer"],             // legacy — kept in sync
  "relations": [                                      // new — typed edges
    { "to": "dev-frontend",      "type": "requires"  },
    { "to": "dev-security",      "type": "requires"  },
    { "to": "security-reviewer", "type": "uses-agent" }
  ]
}
```

- **Read:** if `relations` is present, it is authoritative; otherwise derive it from `childSkills`/`linkedAgents` (migration-on-read, non-destructive).
- **Write:** the designer writes `relations` **and** projects back `childSkills` = ids of skill-targeted relations, `linkedAgents` = ids of agent-targeted relations, so the existing detail-pane chips, the nested list accordion, and any other consumer keep working unchanged.
- **Canvas layout (positions)** are *presentation*, not relationships. Store node coordinates separately — either in a single GridWatch-owned `~/.copilot/gridwatch-skill-canvas.json` keyed by skill/agent id, or omit persistence in v1 and re-run auto-layout each open. (Open question.)

This mirrors the existing merge pattern in `skills:set-relations` (`electron/main.ts:1433`) and the `gridwatch-*.json` global-file convention.

> **Orchestrator artifacts** (sequence + output paths) describe a *generated* skill rather than an *existing* skill's relationships. These are richer than a single skill's `relations` array and are best stored as a standalone **orchestration document** (see next section), with the generated `SKILL.md` being the runnable output.

---

## Orchestrator generation & preset sentences

The most ambitious capability the user describes: the designer is not only a viewer/editor of existing relationships but an **orchestrator builder**. You arrange skills, agents and output files, define the **sequence**, and the designer **emits a new orchestrator skill** — exactly the shape of `chained-review-squad`.

### Orchestration model

An orchestration is a sequence of **steps** over the canvas:

```ts
type StepMode = 'parallel' | 'sequential'

interface OrchestrationStep {
  id: string
  mode: StepMode                 // run this group's members in parallel or one-by-one
  members: string[]             // node ids (skills) active in this step
  outputs: { nodeId: string; path: string }[]  // files each member writes
}

interface Orchestration {
  name: string                   // generated skill folder name (e.g. chained-squad)
  displayName: string            // SKILL.md frontmatter `name`
  description: string            // SKILL.md frontmatter `description`
  steps: OrchestrationStep[]      // ordered stages
  finalOutput?: { path: string; consolidatesFrom: string[] }  // e.g. squad-review-<ID>.md
}
```

For chained-squad this is one **parallel** step of four reviewers (each writing `review-<area>-<ID>.md`) followed by a **sequential** consolidation step producing `squad-review-<ID>.md`.

### Preset sentences (injectable templates)

The "preset sentences" the user wants are a **library of parametrised natural-language fragments** that the generator stitches together into the orchestrator's `SKILL.md` workflow. Each preset maps a step/relationship pattern to imperative prose with `{{placeholders}}`:

| Preset id            | When used                          | Template (example) |
|----------------------|------------------------------------|--------------------|
| `announce`           | start of workflow                  | `Print: "🚀 [{{orchestrator}}] Starting {{description}}..."` |
| `derive-id`          | outputs use a shared identifier     | `Determine a unique run identifier ({{idSource}}) and store it as {{idVar}}.` |
| `launch-parallel`    | a `parallel` step                  | `Launch {{members}} in parallel using the task tool with mode: "background". Instruct each to write its findings to {{outputPath}}.` |
| `launch-sequential`  | a `sequential` step                | `Run {{member}} and wait for it to finish before continuing.` |
| `use-agent`          | a `uses-agent` edge                | `{{skill}} runs the {{agent}} agent.` |
| `wait-all`           | after a parallel step              | `Wait for all launched tasks to complete, collecting results with read_agent.` |
| `consolidate`        | a `finalOutput`                    | `Read {{inputs}} and combine them into {{outputPath}}.` |
| `report-back`        | end of workflow                    | `Report a short summary and print the path to {{outputPath}}.` |

Properties of the preset system:
- **Editable, not hard-coded.** Presets live in a GridWatch-owned file (e.g. `~/.copilot/gridwatch-orchestration-presets.json`) so users can tweak the wording without touching app code; ship sensible defaults.
- **Placeholder binding.** The generator resolves `{{members}}`, `{{outputPath}}`, `{{agent}}`, `{{idVar}}` etc. from the orchestration model and canvas.
- **Ordered assembly.** Presets are emitted in step order to produce a numbered, sequenced workflow — yielding a `SKILL.md` structurally identical to the hand-written chained-squad (Announce → Derive ID → Launch parallel → Wait → Consolidate → Report).
- **Preview before write.** The generated markdown is shown in a diff/preview panel; the user confirms before a new skill folder is scaffolded via the existing `skills:create` + `skills:save-file` IPC.

### Generation output

"Generate" produces a **new skill** under `~/.copilot/skills/<name>/` (reusing `skills:create`), containing:
- `SKILL.md` — frontmatter (`name`, `description`) + the assembled, sequenced workflow.
- `gridwatch.json` — typed `relations` (`requires` each member skill, `uses-agent` each agent) **plus** an `orchestration` block (steps + outputs) so the designer can round-trip and re-edit what it generated.

Because generation only ever **creates/edits GridWatch-managed skill files** via existing IPC and never rewrites Copilot-owned runtime files, it stays within the project's "no Copilot file writes" rule.

---

## Tasks (phased, each independently verifiable)

**Phase 0 — Foundation (separate plan).** Ship the read-only graph view (`documents/skill-graph-view-plan.md`). The designer assumes its `buildSkillGraph`/`layoutSkillGraph`/`SkillGraph` exist.

0. **Extend the read-only graph with artifact/output nodes (small, do early).**
   Teach `buildSkillGraph` about `outputs` edges and `artifact` nodes so the *whole* chained-squad picture (skills → agents → output files) is visible read-only before any editing exists.
   - **Test:** With a hand-written `relations` containing `outputs` edges on chained-squad, the graph shows the four reviewer skills, their agents, and all five output files with orange document nodes.
   - **Status:** Whole-orchestration view renders.

1. **Typed relationship model + migration helpers (pure, no UI).**
   Add a `RelationType` union and `SkillRelation` type; helpers `toTypedRelations(skill)` (derive from legacy fields when `relations` absent) and `toLegacyFields(relations)` (project back to `childSkills`/`linkedAgents`).
   - **Test:** Node harness: a skill with only legacy fields yields the expected typed relations; round-tripping typed → legacy → typed is stable; agent vs skill targets map to the right legacy bucket.
   - **Status:** PASS on all assertions.

2. **Extend read of `gridwatch.json` to surface `relations`.**
   `scanSkillDir` (`electron/main.ts:~1236`) parses `relations` when present (validated, string-typed), else derives via the helper. Expose on `SkillData`.
   - **Test:** A skill with a hand-written `relations` array loads it verbatim; a skill without one shows derived relations identical to its chips. Verify in the detail pane.
   - **Status:** Correct relations on both paths.

3. **Extend `skills:set-relations` (or add `skills:set-typed-relations`) to persist `relations` + keep legacy fields in sync.**
   Validate each edge: endpoints exist, no self-reference, known `type`; write `relations` and projected legacy fields atomically.
   - **Test:** Save a typed graph; reopen and confirm `gridwatch.json` contains both `relations` and the synced legacy arrays; the existing chip UI reflects them.
   - **Status:** Persisted and backward compatible.

4. **`package-audit` + adopt a canvas/interaction library (if chosen).**
   Run the mandatory `package-audit` skill on the candidate (e.g. React Flow); record findings. If rejected, fall back to a bespoke pan/zoom/drag SVG layer.
   - **Test:** Audit report captured; dependency installed; `npm run build` green; a trivial canvas renders.
   - **Status:** Library vetted + building, or bespoke fallback chosen.

5. **Designer canvas — import + arrange (read/move only).**
   A "DESIGNER" surface (full-screen overlay or dedicated section) with a **palette** of existing skills/agents; add nodes to the canvas; pan/zoom; drag to reposition. No edge editing yet.
   - **Test:** Import 3 skills + 1 agent, arrange them, pan/zoom; nothing persists yet (or positions persist per the chosen model).
   - **Status:** Canvas usable.

6. **Edge creation with typed vocabulary.**
   Drag from a node handle to another node → a small menu picks the `RelationType` (filtered to valid combinations, e.g. only `uses-agent` to an agent). Render per the vocabulary's stroke/arrowhead. Delete edges.
   - **Test:** Create one of each edge type; invalid combos are prevented; edges render with the correct style; delete removes them.
   - **Status:** Typed linking works.

7. **Persist + sync + (optional) DSL export.**
   "Save" writes via Task 3's IPC; reload reflects the saved graph. Optionally add a read-only DSL text panel/export of the current graph.
   - **Test:** Build a graph, save, restart the app, reopen — graph and chips match; DSL export lists the statements; round-trips.
   - **Status:** End-to-end persistence verified.

8. **Polish, validation UX, docs.**
   Cycle warnings, missing-endpoint handling, empty states, theming/density, contrast; update `README.md`, `.github/copilot-instructions.md` (new `relations` field, vocabulary, any new IPC/config file).
   - **Test:** `npx tsc --noEmit` + `npm run build` clean; `npm run lint` no new errors; manual pass in both themes/all densities.
   - **Status:** All green.

### Phase 3 — Orchestrator generation

9. **Output/artifact editing + sequencing on the canvas.**
   Add artifact nodes (file paths, placeholder-aware) and `outputs` edges; let the user group members into ordered `parallel`/`sequential` steps (the `Orchestration` model). Persist the orchestration block.
   - **Test:** Recreate chained-squad's shape — one parallel step of four reviewers each with an output file, then a consolidation step producing the final report; reload restores steps + outputs.
   - **Status:** Orchestration is expressible and round-trips.

10. **Preset-sentence library + binding engine (pure).**
    Add the default presets file and a pure `renderWorkflow(orchestration, presets)` that resolves placeholders and emits ordered markdown steps. No skill is written yet.
    - **Test:** Node harness: feeding the chained-squad orchestration yields a workflow whose steps match the hand-written SKILL.md ordering (announce → derive id → launch parallel → wait → consolidate → report); unknown placeholders fail loudly.
    - **Status:** Generated markdown matches the reference.

11. **Generate orchestrator skill (preview → create).**
    A "Generate skill" action shows a preview of the assembled `SKILL.md`; on confirm, scaffold a new skill via `skills:create` + `skills:save-file`, writing `SKILL.md`, frontmatter, typed `relations`, and the `orchestration` block. Re-opening the generated skill in the designer round-trips it.
    - **Test:** Generate from a designed graph; the new skill appears in the Skills list, its SKILL.md is a valid sequenced workflow, and re-importing it reproduces the same canvas. Confirm no Copilot-owned files were written.
    - **Status:** End-to-end generation verified.

---

## Risks

- **Risk:** Editing relationships risks corrupting/overwriting skill `gridwatch.json` (which also holds `tags`).
  **Impact:** Loss of tags or relationships.
  **Mitigation:** Read–merge–write preserving unknown keys (as `skills:set-relations` already does); write atomically; never touch Copilot-owned files. Consider a one-time backup of `gridwatch.json` before first designer save.
- **Risk:** Typed model and legacy fields drift out of sync.
  **Impact:** Detail-pane chips and the designer disagree.
  **Mitigation:** Single source of truth (`relations`) with deterministic projection to legacy fields on every write; unit round-trip test (Task 1).
- **Risk:** Cycles / very large graphs.
  **Impact:** Confusing layout, performance.
  **Mitigation:** Reuse the read-only graph's `visited` cycle guard; virtualise/limit nodes; surface a non-blocking cycle warning rather than forbidding it.
- **Risk:** New interaction dependency (React Flow et al.).
  **Impact:** Bundle size, supply-chain/maintenance risk.
  **Mitigation:** Mandatory `package-audit` before install (Task 4); bespoke fallback documented; isolate the dependency to the designer surface only.
- **Risk:** Scope explosion (this is a large feature).
  **Impact:** Long-lived branch, hard to review.
  **Mitigation:** Strict phasing — read-only graph → typed model/persistence (no canvas) → canvas import → edge editing → orchestrator generation. Each phase is shippable on its own.
- **Risk:** Generated orchestrator `SKILL.md` is malformed or overwrites an existing skill.
  **Impact:** A broken or clobbered skill.
  **Mitigation:** Always preview before write; reject names that collide with existing skills (reuse `skills:create` validation); only ever create new folders, never overwrite Copilot files; the orchestration block makes regeneration deterministic and reviewable.
- **Risk:** Preset sentences drift from what the agent runtime actually understands.
  **Impact:** Generated skills read well but don't orchestrate correctly.
  **Mitigation:** Seed presets from the proven chained-squad wording; keep presets user-editable; validate a generated skill by running it once before relying on it.

No irreversible operations beyond editing GridWatch-owned `gridwatch.json` (recoverable via backup + the always-synced legacy fields).

## Security

- **Input handling:** Node labels and DSL ids derive from local skill/agent names; render as text (no `innerHTML`), and validate ids against existing skills/agents before persisting. The DSL parser must reject unknown/malformed ids and never execute anything — it is data, not code.
- **Path/identity validation:** Reuse existing skill-name validation (`/^[a-z0-9][a-z0-9-]*$/`) and existence/self-reference checks when writing edges.
- **Secrets/PII:** None involved.
- **Third-party deps:** Any canvas library must pass `package-audit`; pin and review.
- **Data exposure:** Entirely local; nothing transmitted.

Assessment performed: main concern is safe writes to `gridwatch.json` and strict id validation; both are mitigated above.

## Accessibility

- A drag-and-drop canvas is inherently hard for keyboard/AT users — provide a **non-canvas fallback**: the existing chip editor remains a fully keyboard-operable way to achieve the same edits, and the typed relations are also expressible via the DSL text panel.
- Canvas nodes/edges focusable with keyboard; offer keyboard alternatives for "add node" and "create link" (e.g. select source, choose target + type from a menu) rather than drag-only.
- Edge *type* must be conveyed by **shape/arrowhead + label**, not colour alone (WCAG 2.1 AA), and verified for 4.5:1 contrast in both themes.
- Respect `prefers-reduced-motion` for any pan/zoom animation; ensure ≥44px hit targets and visible focus rings.

## User Guidance

- **Palette/empty state:** "Drag a skill or agent onto the canvas to start designing," with a hint that links define how skills relate.
- **Legend:** persistent legend mapping each relationship type to its line/arrow style and meaning.
- **Edge-type picker:** on link creation, show concise descriptions per type (the table above) so the vocabulary is self-teaching; disable invalid combinations with a tooltip explaining why.
- **Tooltips:** nodes show enabled/disabled + counts; the "Save" and "Export DSL" controls have explanatory tooltips; a section `ⓘ` explains the designer and that edits write back to each skill's relationships.
- **Validation messaging:** actionable errors ("Can't link a skill to itself", "Agents can only be linked via 'uses-agent'", "Target skill no longer exists").
- **Reassurance:** note that changes only take effect on **Save** and that the equivalent chip editor stays available.

---

## Open questions

1. **Surface:** Is the designer the **expand overlay** from the graph-view plan, or a **dedicated "DESIGNER" section** in the sidebar? (Editing + palette likely wants the dedicated section.)
2. **Vocabulary scope for v1:** ship the full set (`requires`, `invokes`, `uses-agent`, `extends`) or start with a typed rename of today's two edges (`requires` + `uses-agent`) and grow later?
3. **Canvas library vs bespoke:** **RESOLVED — React Flow (`@xyflow/react` v12, MIT)** is the chosen library for the editable canvas (pending `package-audit` before install); read-only graph stays bespoke SVG. See `graph-view-technology-evaluation.md`.
4. **Position persistence:** save node coordinates (new `gridwatch-skill-canvas.json`) for a stable layout, or auto-layout fresh each open in v1?
5. **DSL:** is the textual relationship language a v1 deliverable (export/round-trip), or a later enhancement once the visual model is settled?
6. **Default mapping:** when migrating legacy `childSkills`, map them to `requires` or `invokes` by default?
7. **Output tracking fidelity:** are output files declared **manually** by the user on the canvas, or should the designer attempt to **infer** them by parsing existing `SKILL.md` workflows (e.g. detecting `review-<area>-<ID>.md` paths in chained-squad)? Inference is powerful but brittle.
8. **Generation target:** does "Generate" always create a **new** orchestrator skill, or also offer to **update** a previously generated one in place (round-trip editing of the same skill)?
9. **Preset ownership:** ship presets as a fixed default set first, or make `gridwatch-orchestration-presets.json` user-editable from day one?
10. **Sequencing richness for v1:** is `parallel`/`sequential` grouping enough, or do we need conditionals/dependencies between individual steps (e.g. "run consolidate only if ≥1 reviewer succeeded")?
