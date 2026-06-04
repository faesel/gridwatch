# Plan: Skill Relationships (Child Skills & Linked Agents)

## Goal

Allow a parent skill to declare:
1. **Child skills** — other skills it depends on / invokes.
2. **Linked agents** — custom agents that run as part of the skill.

Surface these relationships in two places:
- **Skills list** — child skills nested (indented, visually marked) under their parent, with an accordion expand/collapse on the parent card (e.g. clicking the *chained-squad* skill reveals its children).
- **Skill detail panel** — a clearly visible section listing the skill's child skills and linked agents, with controls to add/remove them.

This is a **plan only** — no implementation.

---

## Where the relationships are stored

The cleanest, lowest-risk option is to reuse the existing **`gridwatch.json`** file that already lives in each skill folder (currently holds `tags`). We extend it with two new optional arrays:

```jsonc
// ~/.copilot/skills/<skill>/gridwatch.json
{
  "tags": ["review"],
  "childSkills": ["dev-frontend", "dev-security"],  // canonical skill folder names
  "linkedAgents": ["security-reviewer"]              // canonical agent ids (filename minus .agent.md)
}
```

**Why this store?**
- Already read/written by GridWatch; never touches Copilot-owned files (honours the "No Copilot file writes" rule).
- Same merge pattern already used by `skills:set-tags` (read existing JSON, spread, overwrite single key).
- Relationships are stored on the **parent**, so a child can be shared by multiple parents and is still a normal top-level skill.

**Design decisions / rules:**
- A child reference is just a folder name string. If the referenced skill or agent no longer exists, it is rendered as a "missing/unresolved" chip rather than causing an error.
- We do **not** prevent a skill from being both a parent and a child of different skills.
- **Cycle guard:** when rendering the nested list and when adding a child, guard against cycles (A → B → A) so the accordion cannot recurse infinitely. Adding a child that would create a cycle is rejected in the UI with an inline error.
- A skill that is referenced as a child by any parent is shown nested under its parent and hidden from the top level to avoid duplication. **Nesting is always preserved — including while a search/tag filter is active.** Filtering never falls back to a flat list.

---

## Phase 1 — Types

**File: `src/types/skill.ts`**
- Add to `SkillData`:
  ```ts
  childSkills: string[]    // canonical skill folder names declared by this skill
  linkedAgents: string[]   // canonical agent ids declared by this skill
  ```
- Treat both as always-present arrays (default `[]`) to match the existing null-safety convention (`(s.tags ?? [])`), populated in the main process.

**File: `.github/copilot-instructions.md`**
- Update the documented `SkillData` type and the `gridwatch.json` description so the instructions stay accurate.

---

## Phase 2 — Main process (IPC)

**File: `electron/main.ts`**

1. **`scanSkillDir()`** (≈ line 1185): when reading `gridwatch.json`, also parse `childSkills` and `linkedAgents` (validate they are arrays of strings; default `[]`). Return them on the `SkillData` object.

2. **New IPC handler `skills:set-relations`** (mirrors `skills:set-tags`, ≈ line 1383):
   ```ts
   ipcMain.handle('skills:set-relations', async (_e, skillName, childSkills, linkedAgents) => { ... })
   ```
   - Validate `skillName` via existing `isValidSkillName`.
   - Validate `childSkills` / `linkedAgents` are arrays of valid name strings (reuse `isValidSkillName` and `isValidAgentName`).
   - Reject any `childSkills` entry equal to `skillName` (no self-reference).
   - Reject any `linkedAgents` entry that is not the id of a currently-existing agent (scan `~/.copilot/agents/` for `*.agent.md`, same logic as `agents:get-all`). This backstops the UI typeahead so only real agents can be linked.
   - Merge into existing `gridwatch.json` (read → spread → write), same pattern as `set-tags`.
   - Return `boolean`.

   *Alternative considered:* two separate handlers (`set-child-skills`, `set-linked-agents`). Rejected to keep the surface small and writes atomic — one file write covers both.

3. No new handler needed for agents — the renderer already has `getCustomAgents()` to resolve agent ids to display names.

---

## Phase 3 — Preload + global typings

**File: `electron/preload.ts`**
- Add:
  ```ts
  setSkillRelations: (skillName, childSkills, linkedAgents) =>
    ipcRenderer.invoke('skills:set-relations', skillName, childSkills, linkedAgents),
  ```

**File: `src/types/global.d.ts`**
- Add the matching method signature under the Skills block:
  ```ts
  setSkillRelations: (skillName: string, childSkills: string[], linkedAgents: string[]) => Promise<boolean>;
  ```

---

## Phase 4 — Skills list: nesting + accordion

**File: `src/pages/SkillsPage.tsx`**

1. **Derive a parent/child view model** with `useMemo`:
   - Build a map `name → SkillData`.
   - Determine the set of child names referenced by any skill.
   - Top-level rows = skills that are **not** a child of any other skill (plus orphan/unresolved handling).
   - For each parent with `childSkills.length > 0`, attach resolved child `SkillData[]` (skip/flag unresolved names). Apply the cycle guard here.

2. **Filtering interaction (important):**
   - Nesting is **always** preserved — the tree structure (parents with nested children) is rendered whether or not a search/tag filter is active. We never fall back to a flat list.
   - When a filter is active, compute matches against both parents and children, then render **only the parent + child skills that are relevant**:
     - If a **parent** matches → show the parent and all its children.
     - If a **child** matches → show that child nested under its parent, and keep the parent visible (as the container) even if the parent itself doesn't match. Show only the matching child(ren), not unrelated siblings.
     - Top-level skills with no children are shown only if they match.
   - **Auto-expand on filter:** when a filter is active, parents that have a matching child should be force-expanded so the match is visible (don't require a manual click while filtering). Restore the user's manual expand state when the filter is cleared.

3. **Accordion state:**
   - Add `const [expanded, setExpanded] = useState<Set<string>>(new Set())`.
   - Parent cards with children get a chevron/disclosure marker (`▶` collapsed / `▼` expanded), consistent with the existing `tagFilterToggle` arrow convention.
   - Clicking the disclosure marker toggles expansion **without** changing the selected skill; clicking the card body still selects the skill (separate click targets / `stopPropagation`).
   - Persisting expanded state across refreshes is nice-to-have; in-memory is acceptable for v1.

4. **Child row rendering:**
   - Reuse the existing `.card` markup for children but add a `childCard` modifier for indentation + marker.
   - Children remain fully interactive (select, show DISABLED badge, etc.).

**File: `src/pages/SkillsPage.module.css`**
- Add:
  - `.parentToggle` — small disclosure button (chevron), styled like existing toggles, `var(--tron-text-dim)`.
  - `.childCard` — `margin-left` indent (e.g. `+16px` over `.card`'s `8px`) and a left accent border using `var(--tron-blue)` (children) to differentiate from the cyan active border; include a marker (e.g. `└` pseudo-element or a left border bar). Use CSS variables only — no hardcoded hex.
  - Optional `.childCardGroup` wrapper for the accordion region so it can animate height if desired (keep simple for v1).

---

## Phase 5 — Detail panel: relationships section

**File: `src/pages/SkillsPage.tsx`** (detail column, after the TAGS section ≈ line 463)

Add a **RELATIONSHIPS** section with two sub-blocks:

1. **CHILD SKILLS**
   - Render current `selected.childSkills` as chips (resolved → show `displayName` and make the chip clickable to select that skill; unresolved → show name + a "missing" marker).
   - Each chip has an `×` remove button (same pattern as tag chips).
   - An "add" control: a dropdown/typeahead listing other skills (exclude self, exclude existing children, exclude entries that would create a cycle). On select → call `setSkillRelations`.

2. **LINKED AGENTS**
   - Load agents via `window.gridwatchAPI.getCustomAgents()` once (e.g. in an effect, store in state) to resolve ids → display names.
   - Render `selected.linkedAgents` as chips (resolved → `displayName`; if an agent was later deleted → name + missing marker), each with `×` remove.
   - An "add" control implemented as a **typeahead/autocomplete** (same UX as the existing `TagInput` component): suggestions are drawn **only** from the existing agents returned by `getCustomAgents()`, minus those already linked. The user can only pick an existing agent — arbitrary free-text ids cannot be added. On select → call `setSkillRelations`.

3. **State handling** mirrors the existing tag pattern:
   - Local state `localChildSkills` / `localLinkedAgents`, synced from `selected` on selection change.
   - `addChild/removeChild/addAgent/removeAgent` update local state, call `setSkillRelations(selected.name, nextChildren, nextAgents)`, then optimistically patch `skills` (same as `addTag`).

**File: `src/pages/SkillsPage.module.css`**
- Reuse existing tag chip styles; add `.relationChip`, `.relationChipMissing` (orange marker for unresolved), and a `.relationAddSelect` for the dropdown, all using `var(--tron-*)`.

---

## Phase 6 — Verification

- `npm run dev` and manually verify:
  - chained-squad shows a chevron; expanding reveals indented children with the blue accent/marker.
  - Children are interactive and show DISABLED state correctly.
  - Detail panel RELATIONSHIPS section adds/removes children and agents; changes persist to `gridwatch.json` and survive a refresh.
  - Search/tag filtering preserves nesting: a matching child stays nested under its parent (parent shown as container, auto-expanded), and unrelated siblings are hidden.
  - Unresolved child/agent references render as "missing" chips, not errors.
  - Cycle creation is blocked with an inline message.
- Run `tsc` (via `npm run pack:*`'s typecheck step or `npx tsc --noEmit`) to confirm types.
- Consult the rubber-duck agent on the parent/child + filtering view-model before implementing (highest-risk area).

---

## Files touched (summary)

| File | Change |
|---|---|
| `src/types/skill.ts` | Add `childSkills`, `linkedAgents` to `SkillData` |
| `electron/main.ts` | Parse relations in `scanSkillDir`; new `skills:set-relations` handler |
| `electron/preload.ts` | Expose `setSkillRelations` |
| `src/types/global.d.ts` | Type `setSkillRelations` |
| `src/pages/SkillsPage.tsx` | Nesting/accordion in list; RELATIONSHIPS section in detail |
| `src/pages/SkillsPage.module.css` | `.parentToggle`, `.childCard`, relation chip styles |
| `.github/copilot-instructions.md` | Update `SkillData` + `gridwatch.json` docs |

---

## Open questions for review

1. **Top-level duplication:** ~~When a skill is a child of a parent, should it also still appear as its own top-level row?~~ **Decided:** children are nested-only (hidden from top level), and nesting is preserved even when filtering — filtered results show only the relevant parent + matching child skills (parent auto-expanded as the container).
2. **Multiple parents:** ~~Should a child be allowed under more than one parent (shown in each)?~~ **Decided: yes** — a shared child appears nested under every parent that references it. Relationships are stored per-parent independently, so no extra validation is needed.
3. **Agent source of truth:** ~~Linked agents are stored as free strings validated against `getCustomAgents()`. Acceptable, or should we hard-reject linking an agent that doesn't currently exist?~~ **Decided: only existing agents can be linked.** The UI restricts choices to a typeahead/autocomplete populated from `getCustomAgents()` (same UX as the tag input) — you can only pick from agents that actually exist, never free-type an arbitrary id. The `skills:set-relations` handler also validates each `linkedAgents` entry against the set of existing agent ids and rejects unknown ones. (Unresolved chips can still appear if an agent is later deleted — rendered as "missing" — but new links to non-existent agents are not possible.)
4. **Auto-detection:** ~~Should GridWatch attempt to auto-suggest child skills/agents by scanning a skill's `SKILL.md` for references?~~ **Decided: deferred to scope two.** A nice-to-have follow-up — GridWatch could scan a skill's `SKILL.md` for references to other skills/agents and offer them as one-click suggestions. Not part of this (scope one) implementation.
