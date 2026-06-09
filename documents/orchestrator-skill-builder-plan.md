# Plan: Orchestrator Skill Builder (Skills Graph)

> **Status: planning only — do not implement until reviewed and approved.**
> Builds directly on the shipped read-only **SKILLS GRAPH** (`src/pages/SkillGraphPage.tsx`,
> React Flow `@xyflow/react` v12). This plan evolves that pane into an **editable orchestrator
> builder**. `chained-review-squad` (folder `chained-squad`) is the worked reference throughout.

## Problem statement

GridWatch can *view* skill → child-skill relationships but cannot *build* an orchestrator. The user
wants to assemble an **orchestrator skill** in the Skills Graph by attaching child skills, choose
whether they run **sequentially** (one-by-one) or **asynchronously** (all at once), wire each child's
**input/output folders** so outputs flow between steps, and have results written into a single
**output folder** the user defines — generating a runnable `SKILL.md` shaped like `chained-squad`.

## Proposed approach

Because Copilot skills are **prose an agent reads at runtime**, "invoking a child" means the
orchestrator's `SKILL.md` *names each child and tells the agent how to run it*. We therefore: (1) store
an ordered, typed **orchestration config** in the parent skill's GridWatch-owned `gridwatch.json`;
(2) make the graph **editable** — create/attach child nodes, set mode and folders, auto-wire links;
and (3) **generate** the orchestrator's `SKILL.md` workflow into a clearly-demarcated **managed
block** so config drives the workflow while any prose outside the markers is preserved. Only
GridWatch-owned files (`gridwatch.json`, the orchestrator's own `SKILL.md`) and the user's chosen
output folder are written — never Copilot-owned files.

### Confirmed design decisions

- **Run order = attachment order.** `childSkills` is an ordered array; the graph **appends** on attach.
- **Single orchestrator output folder**, defined on the orchestrator; each child may **override** its
  own `outputDir`.
- **Per-child input/output folders** enable "linking". Drawing a link A → B **auto-wires**
  `B.inputDir = A.outputDir`, with **manual override** allowed.
- **Create child skill nodes from the graph**, including a textarea to **paste skill text** (the
  `SKILL.md` body), placeholder: *"Paste your skill instructions here…"*.
- **Two modes:** `sequential` (synchronous, one-by-one) and `parallel` (asynchronous, all at once).
- **Managed block** generation with an explicit, visible **editable / do-not-edit demarcation**.

### Storage model (parent's `gridwatch.json`)

```jsonc
{
  "tags": ["dev"],
  "childSkills": ["dev-frontend", "dev-security", "dev-fallow"],  // ordered = run order
  "linkedAgents": [],
  "orchestration": {
    "isOrchestrator": true,
    "mode": "sequential",                       // "sequential" | "parallel"
    "outputDir": "/Users/Faesel.Saeed/Code/review",
    "runIdSource": "session",                   // how <SESSION_ID> is derived (the Copilot session id)
    "children": {                               // I/O wiring; order still comes from childSkills
      "dev-frontend": { "inputDir": "", "outputDir": "", "outputFile": "review-frontend-<SESSION_ID>.md" },
      "dev-security": { "inputDir": "", "outputDir": "", "outputFile": "review-security-<SESSION_ID>.md" }
    },
    "finalOutput": "squad-review-<SESSION_ID>.md"   // optional consolidation step
  }
}
```

`childSkills` carries **order**; `orchestration.children` carries **I/O wiring**. Empty `inputDir` /
`outputDir` inherit the orchestrator's `outputDir`. Relationships stay authoritative in
`gridwatch.json`; the parent is the single source of truth for the pipeline.

### Generated `SKILL.md` shape (managed block)

```markdown
---
name: <orchestrator>
description: <description>
---

# <Orchestrator>

<!-- Anything ABOVE this line is yours to edit freely. -->

<!-- ╔══════════════════════════════════════════════════════════════╗ -->
<!-- ║ GRIDWATCH-MANAGED — DO NOT EDIT BELOW.                        ║ -->
<!-- ║ This block is regenerated from the Skills Graph orchestration ║ -->
<!-- ║ config. Manual edits here will be overwritten on regenerate.  ║ -->
<!-- ╚══════════════════════════════════════════════════════════════╝ -->
<!-- gridwatch:orchestration:start -->
… generated workflow (announce → derive SESSION_ID → run children [sequential|parallel]
   → optional consolidation → report) …
<!-- gridwatch:orchestration:end -->
<!-- ╔══════════════════════════════════════════════════════════════╗ -->
<!-- ║ END GRIDWATCH-MANAGED — you may edit BELOW this line again.   ║ -->
<!-- ╚══════════════════════════════════════════════════════════════╝ -->
```

- **Sequential:** for each child in order — run it, tell it to read from its input folder and write to
  its output folder, **wait** before the next.
- **Parallel:** launch all children via `task` `mode: "background"`, each writing to its output folder,
  then **wait for all** with `read_agent`.
- **Consolidation** (if `finalOutput` set): read each child's output and combine into
  `<outputDir>/<finalOutput>`, mirroring `squad-review-<REVIEW_ID>.md`.
- `<SESSION_ID>` is the current Copilot CLI session id (UUID under `~/.copilot/session-state/`), keeping filenames unique per run (generalises squad's `REVIEW_ID`).

---

## Editable graph UX (detailed interaction design)

This section details how a user **adds nodes, connects them, edits the pipeline and generates** the
skill. It extends today's read-only canvas (pan/zoom, `Controls`, `MiniMap`, double-click-to-open)
rather than replacing it; read-only behaviour remains the default until **Edit mode** is enabled.

### 1. Mode switch: View ↔ Edit

- A segmented control in the header — **VIEW | EDIT** — toggles editability. VIEW is today's
  behaviour (no accidental drags/edits). EDIT reveals the palette, node toolbars, connection handles
  and the inspector.
- The current PARENT-SKILL dropdown is **repurposed in EDIT** to select the **orchestrator being
  built** (only `isOrchestrator` skills, plus a "➕ New orchestrator…" entry).
- Unsaved-config state is held in component state and **debounced-persisted** via the IPC; a subtle
  "Saved ✓ / Saving…" indicator sits beside the toggle.

### 2. Canvas chrome (EDIT mode)

A left-hand **palette/rail** and a top **action bar**:

- **Palette (left rail):** searchable list of existing skills and agents as draggable chips, grouped
  *Skills / Agents*, plus two creator buttons: **＋ New skill node** and **＋ New orchestrator**.
  Dragging a chip onto the canvas adds it as a node (and, for a skill dropped near the orchestrator,
  offers to attach it).
- **Action bar (top):** `Mode: Sequential ⇄ Parallel` toggle, **Output folder** picker (shows the
  resolved path), **Auto-layout** (re-runs the BFS/column layout), **Generate SKILL.md**, and a
  `Saved ✓` indicator.
- **Node context menu** (right-click / ⋯ button on a node): *Attach as child*, *Detach*, *Set input
  folder*, *Set output folder*, *Open skill*, *Remove from canvas*, *Delete skill…* (guarded).

### 3. Adding nodes — three routes

1. **From the palette (existing skill/agent):** drag a chip onto the canvas → node appears at the drop
   point. If dropped onto/near the orchestrator it is **auto-attached** (appended to `childSkills`);
   otherwise it sits unattached until linked.
2. **Create a brand-new skill node (paste text):** **＋ New skill node** opens a modal:
   - **Name** (validated `^[a-z0-9][a-z0-9-]*$`, live-checked for collisions),
   - **Description** (one line → frontmatter),
   - **Skill body** — a large `<textarea>` with placeholder *"Paste your skill instructions here…"*
     and helper text *"Frontmatter (name/description) is added automatically."*,
   - optional **Input folder** / **Output folder** pickers.
   On **Create**: `skills:create` → `skills:save-file` (body wrapped in frontmatter) → node added and
   **auto-attached** to the selected orchestrator as the **last** child.
3. **New orchestrator:** **＋ New orchestrator** opens a smaller modal (name + description + initial
   mode + output folder); creates the skill with `orchestration.isOrchestrator = true` and selects it.

New nodes animate in at a non-overlapping slot (next free row in the relevant column); **Auto-layout**
tidies positions on demand. Manual drags are preserved across refreshes (existing `modelKey` guard).

### 4. Connecting nodes — drawing links

- Each node shows **connection handles** (already present: source-right, target-left). In EDIT, hover
  enlarges the handle to a ≥44 px hit target.
- **Drag from a source handle to a target node** to create an edge. On drop:
  - **skill → skill** → the edge means "child runs as part of this orchestrator" and the target is
    **appended to `childSkills`** (order = link order). If a typed vocabulary is adopted later, a small
    inline **edge-type picker** (`requires` / `invokes`) appears; v1 can default to the single child
    meaning.
  - **skill → agent** → `uses-agent` (today's `linkedAgents`).
  - **Auto-wire I/O:** if the source has an `outputDir`, the target's `inputDir` is **auto-set** to it
    (toast: *"Input set from <source>'s output — override in the inspector"*). Manual override always
    wins.
- **Invalid connections are blocked at drag time** with a tooltip explaining why (self-link, would
  create a cycle, agent→skill not allowed, target already attached). React Flow's `isValidConnection`
  drives this so the edge never snaps when invalid.
- **Deleting an edge** (select + `Delete`, or edge context menu) **detaches** the child / removes the
  agent link and clears any auto-wired `inputDir` that came from it.

### 5. Ordering the pipeline

- Run order is the `childSkills` array order. Two ways to change it:
  - a compact **ordered child list** in the inspector with up/down controls and drag-reorder, and
  - **numbered order badges** (1, 2, 3…) rendered on attached child nodes in **sequential** mode so
    the run order is visible on the canvas itself. In **parallel** mode badges are hidden (order is
    irrelevant) and edges render with a "fan-out" style from the orchestrator.

### 6. Selection & the inspector panel

Selecting a node opens a right-hand **inspector** (collapsible):

- **Orchestrator selected:** name/description, **Mode** toggle, **Output folder** picker (with the
  resolved absolute path and a "browse" button → `pickDirectory`), `runIdSource`, optional
  **Final output** filename, and the **ordered child list** (reorder/detach).
- **Child selected:** display name + enabled state, **Input folder** / **Output folder** pickers (with
  an *"Inherits orchestrator output folder"* hint when blank), **Output filename** (with `<SESSION_ID>`
  placeholder support), an **"Open skill"** button, and a **best-effort** badge if the child declares
  no input/output contract in its own `SKILL.md`.
- All inspector edits persist via the debounced IPC; no separate "save relationships" step.

### 7. Generating the SKILL.md

- **Generate SKILL.md** opens a **preview drawer** showing the assembled managed block with the
  **editable vs do-not-edit demarcation** clearly rendered (banner + dimmed managed region). The user
  confirms before write.
- Generation **merges** only the marked region (Task 6); prose outside is untouched. A success toast
  links *"Open <orchestrator>/SKILL.md"*.
- Re-opening the orchestrator **round-trips** the canvas: order from `childSkills`, folders from
  `orchestration.children`, mode/output from the config.

### 8. Visual language (Tron tokens only)

- **Orchestrator node:** distinct accent (e.g. `var(--tron-cyan)` border + a small ⚙/⌬ glyph) to set
  it apart from plain skills.
- **Child skills:** existing skill node; **agents:** existing agent node (orange).
- **Edges:** child = blue, agent = orange (as today); add a subtle **dashed** style for any future
  "soft" relation. Sequential order shown via numbered badges; parallel via fan-out.
- **States:** disabled skills dimmed; missing/unresolved targets get the existing "missing" treatment;
  best-effort children get a small ⚠ chip.
- All colours via `var(--tron-*)`; contrast verified in both themes.

---

## Child-skill scaffold template

When a user creates a child node via **＋ New skill node**, GridWatch scaffolds a `SKILL.md` that
**conforms to the orchestration I/O contract** so the orchestrator can chain it and the folder-wiring
is honoured. The user's pasted instructions drop into the clearly-marked **work step**; everything
else is a thin, standalone-friendly wrapper modelled on `dev-security` (which already declares a
`report_path` input). If the user leaves the body blank, this scaffold is written verbatim; if they
paste their own full `SKILL.md`, it is used as-is (and flagged "best-effort" if it declares no I/O
contract).

```markdown
---
name: <name>
description: <description>
---

# <Display Name>

**When to use this skill**
- Invoked as a step in the `<orchestrator>` orchestration (reads an input, writes an output).
- Can also be run standalone.

## Inputs / Outputs (orchestration contract)

This skill follows the GridWatch orchestration I/O contract so an orchestrator can chain it:

- `input_path` (optional) — Absolute path this step READS. When run by an orchestrator this is the
  upstream step's output (auto-wired in the Skills Graph). Standalone: the user supplies it.
- `output_path` (required when chained) — Absolute path this step WRITES its result to. The
  orchestrator sets this to `<outputDir>/<outputFile>` (e.g. `.../result-<SESSION_ID>.md`).
- If `output_path` is not provided, default to `./<name>-output.md` in the working directory.

## Workflow

1. **Announce** — Print: `🔧 [<name>] Starting…`
2. **Read input** — If `input_path` is provided, read it; otherwise gather inputs as described below.
3. **Do the work** —
   <!-- gridwatch:body:start -->
   > **PASTE OR WRITE YOUR SKILL INSTRUCTIONS HERE.**
   > Describe exactly what this step should do with the input and produce as output.
   <!-- gridwatch:body:end -->
4. **Write output** — Write the result to `output_path` (create parent folders if needed). The result
   MUST be saved to `output_path`, not returned only in chat.
5. **Report back** — Print a one-line summary and the absolute `output_path`.

## Notes

- This skill is wired into an orchestrator via GridWatch (Skills Graph). The orchestrator passes the
  input/output paths at runtime — do not hard-code them here.
```

**How it ties together:**

- The **orchestrator's generated workflow** (managed block) passes each child its `output_path`
  (`<outputDir>/<outputFile>`) and, for linked steps, its `input_path` (the upstream `outputDir`).
  The child template's *Inputs / Outputs* section is the matching half of that contract.
- The optional `gridwatch:body:start/end` markers let GridWatch locate the **user's work step** so a
  future "edit body in-app" affordance can target just that region without touching the contract — and
  so a blank body is easy to detect and prompt for. They are **informational anchors for the child**,
  independent of the orchestrator's own managed block.
- A child that does **not** follow this contract still works: the orchestrator falls back to a
  best-effort instruction ("after `<child>` finishes, move its output into `<outputDir>`") and the
  node is flagged **best-effort** in the inspector (see Risks).

> **Open choice:** whether `input_path` / `output_path` are surfaced to the agent as literal argument
> names or as prose ("read from … / write to …"). Prose is more robust across agent versions; argument
> names are tidier. Recommendation: **prose**, with the names shown as hints — matching how
> `dev-security` documents `report_path` today.

---

## Resilience: a broken or edited managed block

The orchestrator's workflow lives inside a hand-editable `SKILL.md`, so users **will** sometimes edit
or break it. The guiding principle is **never silently destroy user content**: detect the breakage and
**clearly indicate** it. The `gridwatch.json` `orchestration` config remains
the **source of truth**; the managed block is a regenerable *projection* of it.

To support detection and recovery, extend the `orchestration` block with provenance:

```jsonc
"orchestration": {
  "schemaVersion": 1,
  "generatedHash": "<sha256 of the last block we wrote, normalised>",
  "generatedAt": "2026-06-09T11:00:00.000Z",
  "...": "…rest of config…"
}
```

### Failure modes and handling

| What the user does | Detection | Handling |
|---|---|---|
| **Edits text *inside* the managed block** (markers intact) | Current block hash ≠ `generatedHash` | Show a **"Managed block edited"** badge on the orchestrator node + an inline diff in the preview. Offer **Regenerate** (overwrites, restoring canonical text) or **Keep mine** (leaves it; records that it's diverged). Never auto-overwrite without the user choosing. |
| **Deletes or alters one/both markers** (`…:start` / `…:end`) | Marker scan finds 0 or 1 of the pair | **Refuse to merge** (we won't guess the region and risk clobbering prose) and flag the orchestrator as **Broken** with guidance ("Managed markers missing — restore them or recreate the orchestrator"). *(Automated repair is deferred — see below.)* |
| **Duplicates the marker pair** (copy/paste) | Marker scan finds >1 start or >1 end | Refuse to merge; flag **Broken** ("Multiple managed blocks found — remove the extra one"). |
| **Markers out of order** (`end` before `start`) | Index of `end` < index of `start` | Refuse to merge; flag **Broken**. |
| **Edits/removes frontmatter** (`name`/`description`) | Frontmatter parse on load | Generation **only ever touches the managed block**, never frontmatter. If frontmatter is missing/invalid, warn "skill may not load" in the inspector; do **not** auto-rewrite it. |
| **Corrupts `gridwatch.json`** (invalid JSON) | `JSON.parse` throws in `scanSkillDir` | Fail safe (existing try/catch convention): treat as no orchestration; inspector shows **"Orchestration config unreadable — relationships disabled"**; offer to re-initialise from the legacy `childSkills`. |
| **Config ↔ SKILL.md drift** (block stale vs config) | `generatedHash` present but block differs, or config changed since `generatedAt` | Graph is driven by **config** (truth); show a **"Regenerate to sync"** nudge so the file matches what the graph shows. |
| **Edits SKILL.md in GridWatch's own editor** (`SkillsPage` `saveSkillFile`) | Save targets a file containing managed markers | Render the managed region **read-only / visually protected** in the in-app editor and warn on save ("This region is managed by the Skills Graph"). |
| **Deletes the whole `SKILL.md`** | File missing on generate | Regenerate scaffolds a fresh file (frontmatter + managed block) from config. |

### Principles & safeguards

- **Anchor-based, idempotent merge.** Replace strictly between the validated marker pair; if integrity
  fails, **stop and flag Broken**, never overwrite the whole file.
- **Backup before write.** Before any merge, write a timestamped `SKILL.md.bak` (or keep the last-good
  block + `generatedHash` in config) so a bad regenerate is recoverable.
- **Drift visibility.** A normalised hash (`generatedHash`) drives the **In sync / Edited / Broken**
  indicator; normalisation ignores trailing whitespace so cosmetic diffs don't false-positive.
- **Preview before write.** The Generate preview shows exactly what will change (managed block only);
  when markers are broken it shows the **Broken** state and guidance instead of writing.
- **Runtime is best-effort by nature.** We cannot guarantee an agent runs hand-edited prose correctly;
  our v1 job is to **detect and clearly indicate** breakage in-app. The unedited generated block is
  always reproducible from config.

> **Deferred to a later version (not in v1):** an automated **Repair** flow (re-inserting/consolidating
> a clean managed block while preserving surrounding prose). v1 ships **detection + a status indicator
> only**; fixing a broken block is a manual edit (or recreate the orchestrator), with the `SKILL.md.bak`
> backup available as a fallback.

---

## Tasks (small, independently verifiable increments)

### Phase A — Model & persistence (back-end, no UI risk)

1. **Types + migration helpers (pure).**
   Add `OrchestrationConfig` / `OrchestrationChild` to `src/types/skill.ts`; add `orchestration?` to
   `SkillData`. Pure helpers normalise/validate config and resolve effective per-child folders
   (inherit orchestrator `outputDir` when blank).
   - **Test:** Node harness — blank child folders resolve to the orchestrator folder; invalid
     mode/paths rejected; `childSkills` order preserved.
   - **Status:** pending.

2. **Read `orchestration` in `scanSkillDir`.**
   `electron/main.ts` (~1428) parses `orchestration` when present (validated, safe defaults); surfaces
   it on `SkillData`.
   - **Test:** Hand-write an `orchestration` block on `chained-squad`; confirm it loads verbatim via
     `getSkills()`; a skill without one returns a safe default.
   - **Status:** pending.

3. **Persist orchestration via IPC.**
   Extend `skills:set-relations` (or add `skills:set-orchestration`) to read–merge–write the
   `orchestration` block atomically, preserving `tags`/unknown keys (pattern at
   `electron/main.ts:1625`). Validate mode, `children ⊆ childSkills`, no self-reference, ids exist.
   - **Test:** Save a config; reopen and confirm `gridwatch.json` keeps `orchestration` **and** intact
     `tags`/`childSkills`; invalid payloads leave the file untouched.
   - **Status:** pending.

4. **Generic directory picker IPC.**
   Add `pickDirectory()` (reuse `autotag:pick-directory`) for choosing output/input folders.
   - **Test:** Opens a native folder dialog; returns the chosen absolute path or `null` on cancel.
   - **Status:** pending.

### Phase B — Workflow generation (pure + write)

5. **Pure workflow renderer.**
   `renderOrchestratorWorkflow(config, children)` returns the managed-block markdown for both modes +
   optional consolidation. No file writes.
   - **Test:** Node harness — a `chained-squad`-equivalent config (parallel, four children, output
     files, final report) yields step ordering matching `chained-squad/SKILL.md`
     (announce → derive SESSION_ID → launch parallel → wait → consolidate → report); sequential emits
     ordered run-and-wait steps.
   - **Status:** pending.

6. **Generate + managed-block merge IPC, with integrity check.**
   `skills:generate-orchestrator(name)` renders the block (Task 5) and **merges** it strictly between
   the `gridwatch:orchestration:start/end` markers in `SKILL.md`; only that region is rewritten. Adds
   **marker-integrity validation** (0/1/duplicate/out-of-order markers), a **backup-before-write**
   (`SKILL.md.bak`), and stores `generatedHash`/`generatedAt`/`schemaVersion` in the config. On broken
   markers it **refuses to clobber** and returns a `broken` result (no write). Inserts the demarcation
   banner + markers once if absent. *(Automated repair is out of scope for v1.)*
   - **Test:** Manual prose above/below survives regeneration; deleting a marker returns `broken` and
     writes nothing; duplicate/out-of-order markers are detected; `generatedHash` updates on a clean
     write; a backup is created.
   - **Status:** pending.

7. **Child-skill scaffold generator (pure + create).**
   A pure `renderChildScaffold(name, description, orchestrator)` produces the I/O-contract template
   (Inputs/Outputs + `gridwatch:body:start/end` work step). Used by "＋ New skill node" when the body
   is blank; a pasted full `SKILL.md` is used as-is and flagged best-effort if it declares no contract.
   - **Test:** Node harness — blank body yields the scaffold with the contract section and body
     markers; a pasted body round-trips unchanged; best-effort detection works (no `output_path`
     mention → flagged).
   - **Status:** pending.

### Phase C — Editable graph UI

8. **View/Edit toggle + orchestrator selection + inspector shell.**
   Add the VIEW|EDIT control; in EDIT, repurpose the dropdown to pick/create the orchestrator and show
   the inspector (mode toggle, output-folder picker, ordered child list). Debounced persistence with a
   Saved indicator.
   - **Test:** Toggle to EDIT, set mode + output folder; values persist (Task 3) and survive a 30 s
     refresh; VIEW mode is unchanged from today.
   - **Status:** pending.

9. **Palette + add existing nodes (drag) + attach/detach/reorder.**
   Left-rail palette of skills/agents; drag onto canvas to add; drop-near-orchestrator or link to
   **attach** (append → order); detach; up/down + drag reorder; order badges in sequential mode.
   Cycle/self-reference guards reused.
   - **Test:** Attach three skills; order in `gridwatch.json` matches attach order; detach middle;
     reorder; canvas, badges and file stay consistent.
   - **Status:** pending.

10. **Connect nodes with validation + auto-wire.**
    Drag handle→node to create edges; `isValidConnection` blocks self/cycle/agent→skill/duplicate with
    a tooltip; skill→skill attaches, skill→agent links; auto-set `B.inputDir = A.outputDir` on link
    (toast), override allowed; deleting an edge detaches and clears auto-wired input.
    - **Test:** Valid links attach + auto-wire; invalid links never snap and show the reason; deleting
      an edge detaches and clears the inherited input.
    - **Status:** pending.

11. **Create new skill node with pasted text (uses the scaffold).**
    "＋ New skill node" modal (name/description/body textarea with placeholder + I/O folders) →
    `skills:create` → `skills:save-file` writing the **child scaffold** (Task 7) with the pasted body in
    the work step (or the scaffold's placeholder if blank) → auto-attach as last child.
    - **Test:** Paste body, create; the skill appears in the Skills list with the contract section +
      pasted body and is attached last; blank body yields the placeholder; collision/invalid-name
      errors are actionable.
    - **Status:** pending.

12. **Per-child I/O inspector + Generate-with-preview.**
    Child inspector folder pickers (inherit hint), output filename with `<SESSION_ID>`; **Generate**
    preview drawer shows the demarcated managed block before writing (Task 6); round-trip verified.
    - **Test:** Build a pipeline, generate; preview matches the written file; re-opening reproduces the
      canvas (order + folders + mode).
    - **Status:** pending.

13. **Status indicator (In sync / Edited / Broken) + in-app editor guard.**
    Surface the resilience handling as a **read-only status only** (no repair in v1): an **In sync /
    Edited / Broken** badge on the orchestrator node driven by `generatedHash` + marker integrity, with
    a tooltip explaining each state and what to do (e.g. "Broken — restore the managed markers or
    recreate the orchestrator"). Protect the managed region in the `SkillsPage` in-app editor (render
    read-only + warn on save). Invalid `gridwatch.json` shows "config unreadable" rather than crashing.
    - **Test:** Edit inside the block → **Edited** badge; remove/duplicate a marker → **Broken** badge,
      Generate writes nothing; clean state → **In sync**; corrupt `gridwatch.json` → inspector shows the
      safe message; editing the managed region in the in-app editor is blocked/warned.
    - **Status:** pending.

### Phase D — Polish & docs

14. **Validation UX, empty states, theming, docs.**
    Cycle/missing-endpoint handling, actionable errors, both themes + all densities; update
    `README.md` and `.github/copilot-instructions.md` (new `orchestration` block, new IPC, demarcation
    convention).
    - **Test:** `npx tsc --noEmit` + `npm run build` clean; manual pass in both themes; docs updated.
    - **Status:** pending.

---

## Risks

- **Risk:** Regeneration overwrites the user's manual prose in `SKILL.md`.
  **Impact:** Lost edits.
  **Mitigation:** Anchor-based managed-block merge — only the marked region is rewritten; visible
  demarcation banner; preview before write; backup-before-write (`SKILL.md.bak`) (Tasks 6, 12).
- **Risk:** The user breaks the templated block — deletes/duplicates/reorders the markers or edits
  inside it.
  **Impact:** Merge can't anchor safely; naive overwrite could clobber surrounding prose; a hand-edited
  block may mis-orchestrate at runtime.
  **Mitigation:** Marker-integrity validation that **refuses to clobber** and a clear **In sync /
  Edited / Broken** status indicator; `generatedHash` drift detection; the unedited block is always
  reproducible from the `gridwatch.json` config. *(Automated repair is deferred beyond v1; fixing a
  broken block is a manual edit, with `SKILL.md.bak` as a fallback.)* (Tasks 6, 13; see *Resilience*).
- **Risk:** Writing `orchestration` clobbers `tags`/`childSkills` in the shared `gridwatch.json`.
  **Impact:** Lost tags or relationships.
  **Mitigation:** Read–merge–write preserving unknown keys; atomic temp+rename; reuse the proven
  `skills:set-relations` merge pattern (`electron/main.ts:1625`).
- **Risk:** A child doesn't accept an input/output-path argument, so folder wiring can't be honoured.
  **Impact:** The child ignores the pipeline folders.
  **Mitigation:** Generate explicit "read from / write to" instructions (the `report_path` contract
  `dev-security` documents); flag such children as "best-effort" in the inspector.
- **Risk:** Cyclic or self-referential attachments.
  **Impact:** Infinite layout / nonsensical pipeline.
  **Mitigation:** Reuse the graph's `visited` cycle guard and existing self-reference rejection;
  `isValidConnection` blocks them at drag time.
- **Risk:** Generated orchestrator collides with an existing skill name.
  **Impact:** Clobbered skill.
  **Mitigation:** `skills:create` already rejects existing names; only ever create new folders; preview
  before write.
- **Risk:** Editable graph is a larger surface than today's read-only pane.
  **Impact:** Long branch, regressions.
  **Mitigation:** Strict phasing (A model → B generation → C UI → D polish); VIEW mode preserves
  current behaviour; each task independently verifiable; no Copilot-owned files written.

No irreversible operations beyond editing GridWatch-owned files (recoverable; legacy fields stay in
sync).

## Security

- **No new network surface** — all local. Writes touch only GridWatch-owned `gridwatch.json`, the
  orchestrator's own `SKILL.md` (via validated `skills:save-file`), and the user's chosen output
  folder. Never Copilot-owned files (`workspace.yaml`, `events.jsonl`).
- **Input handling** — skill/folder names validated against `^[a-z0-9][a-z0-9-]*$`; child ids checked
  for existence and self-reference; pasted skill body written as text (no `innerHTML`, no execution)
  and size-capped by `skills:save-file` (512 KB).
- **Path safety** — folder picks are absolute paths from a native dialog; `skills:save-file` enforces
  `isPathWithin` so writes can't escape the skill directory; output folders are written by the
  *generated skill at runtime*, not by GridWatch directly.
- **Secrets/PII** — none involved. No auth/authorisation changes.
- **Dependencies** — no new runtime dependency (React Flow already vetted). Any future layout helper is
  gated behind the mandatory `package-audit` skill.
- Assessment performed: the only material concerns are safe merges into `gridwatch.json` and strict id
  validation; both are mitigated above.

## Accessibility

- React Flow nodes are real DOM elements — keep them focusable with visible focus rings and
  `aria-label`s; palette chips, modals and inspector use semantic controls (`<button>`, `<label>`,
  `<select>`, `<textarea>`, dialog with focus trap + `Esc` to close).
- **Keyboard alternatives** to drag-only actions: add via palette `Enter`, attach/connect via node
  context menu, reorder via up/down — never drag-only.
- Convey edge meaning by **arrowhead + label/badge**, not colour alone (WCAG 2.1 AA, 4.5:1 verified in
  both *The Grid* and *Programs* themes).
- Respect `prefers-reduced-motion` for pan/zoom and node-in animations; ≥44 px handle/control hit
  targets in EDIT mode.
- The existing chip editor on the Skills page remains a fully keyboard-operable fallback for the same
  relationship edits.

## User Guidance

- **Mode switch:** tooltip — "VIEW explores the graph; EDIT lets you build and wire an orchestrator."
- **Empty states:** orchestrator with no children — "Drag a skill from the palette, or create a new
  skill node, to start your pipeline."; no orchestrators — guide to "＋ New orchestrator".
- **Mode toggle:** inline help — "Sequential runs skills one-by-one; Parallel launches them all at
  once."
- **Folder fields:** picker buttons show the resolved absolute path; blank child folder hint *"Inherits
  the orchestrator's output folder"*; on linking, toast *"Input auto-set from the upstream skill's
  output — override if needed."*
- **Paste-text node:** textarea placeholder *"Paste your skill instructions here…"* + helper *"Frontmatter
  is added automatically."*
- **Connections:** invalid-drag tooltips ("Can't link a skill to itself", "This would create a cycle",
  "Agents connect via 'uses-agent' only", "Already attached").
- **Managed block:** visible banner + dimmed preview making **editable vs do-not-edit** unmistakable;
  "Generate" tooltip explaining regeneration only rewrites the managed block.
- **Save feedback:** a persistent "Saved ✓ / Saving…" indicator so users know edits persist without a
  manual save step.
