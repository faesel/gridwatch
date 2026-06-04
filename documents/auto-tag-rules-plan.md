# Plan: Directory-Based Auto-Tag Rules

## Problem statement

Sessions can be tagged manually, but there is no way to tag them automatically. A user who works across many repositories wants every session whose working directory lives under a given folder (e.g. `~/Code/work`) to be tagged automatically (e.g. `work`) without tagging each session by hand.

## Proposed approach

Add a **Settings** section, "AUTO-TAG RULES", where the user defines rules that map a **directory** to one or more **tags**. Rules are stored in a new GridWatch-owned config file (`~/.copilot/gridwatch-autotag-rules.json`), never touching Copilot-owned files. When sessions are loaded in the main process, each rule whose directory contains the session's working directory contributes its tags. Auto-tags are **derived at load time** (non-destructive) and exposed on a **separate `autoTags` field** (distinct from the manually-stored `tags`), so rules can be edited or removed at any time and the effect is immediately and fully reversible — no per-session files are rewritten.

### Decisions (confirmed with the user)

1. **Q1 — Derived at load time.** Auto-tags are computed from rules on every session load; nothing is written into session `gridwatch.json` files.
2. **Q2 — Distinct + read-only on sessions.** Auto-tags are returned on a separate `autoTags` field, rendered with a distinct marker/style, and are **not** removable from an individual session (managed only via rules). Manual `tags` remain fully editable.
3. **Q3 — Prefer `gitRoot`, fall back to `cwd`.** Matching tests the session's `gitRoot` when present, otherwise its `cwd`.
4. **Q4 — Always include subdirectories.** A rule matches the chosen folder and everything beneath it. No per-rule toggle (the `includeSubdirs` field is dropped — subdirectory matching is always on).
5. **Q5 — Free-form tags, same validation as manual, no cap, with typeahead.** The rule tag input reuses the same typeahead/autocomplete UX as the session tag input, suggesting existing tags to avoid accidental duplicates, while still allowing new free-form tags.

This mirrors three existing patterns already in the codebase:
- **Storage/merge**: same read → spread → write JSON pattern as `sessions:set-tags` (`electron/main.ts:746`).
- **Global config file**: same `~/.copilot/gridwatch-*.json` convention as `gridwatch-mcp-disabled.json` / `gridwatch-lsp-disabled.json`.
- **Settings UI**: same list + add/remove section pattern as "TRUSTED DIRECTORIES" (`src/pages/SettingsPage.tsx:272`).

---

## Where rules are stored

A single GridWatch-owned file:

```jsonc
// ~/.copilot/gridwatch-autotag-rules.json
{
  "rules": [
    {
      "id": "a1b2c3",            // stable id (crypto.randomUUID) for React keys + removal
      "path": "/Users/me/Code/work", // absolute directory, normalised
      "tags": ["work", "client-x"]  // 1+ tags applied to matching sessions
    }
  ]
}
```

(Per Q4, subdirectory matching is always on, so no `includeSubdirs` field is stored.)

**Why this store?**
- GridWatch-owned; honours the "No Copilot file writes" rule.
- App-level (not per-session), so a rule applies retroactively to all existing sessions and to all future ones with no migration.
- Mirrors the existing disabled-server config files for read/write helpers and prototype-pollution safety.

---

## How matching works

Each session already exposes `cwd` and `gitRoot` (`electron/main.ts:468`, `:514`). For each rule:
- Normalise both the rule `path` and the session directory with `path.resolve` (collapse `..`, trailing slashes).
- A session **matches** a rule when its directory **equals** the rule path, or is a descendant (subdirectories are always included — Q4) — tested with a path-boundary-safe check (`dir === rulePath || dir.startsWith(rulePath + path.sep)`), **not** a naive `startsWith` (which would wrongly match `/Code/work-old` against `/Code/work`).
- The session directory tested is its `gitRoot` when present, else `cwd` (Q3).
- **Case sensitivity**: macOS and Windows default file systems are case-insensitive; Linux is case-sensitive. Plan: compare case-insensitively on `darwin`/`win32` and case-sensitively on `linux` (use `process.platform`). Document this in the section help text.

The union of all matched rules' tags becomes the session's derived `autoTags` (de-duplicated, and with any tag already present in the manual `tags` removed so a tag never appears twice):
```ts
autoTags: dedupe(autoTagsFromMatchedRules).filter(t => !storedTags.includes(t))
```
`tags` (manual) and `autoTags` (derived) are returned as **separate fields** so the UI can style auto-tags distinctly and keep them read-only (Q2). Tag **filtering** in the Sessions list must consider the union of both fields.

---

## Phase / task breakdown

Each task is independently verifiable.

### Task 1 — Types + config read/write helpers (main process)
- **Files:** `src/types/autotag.ts` (new), `src/types/session.ts`, `electron/main.ts`.
- Add an `AutoTagRule` interface (`id`, `path`, `tags`).
- Add `autoTags: string[]` to `SessionData` (`src/types/session.ts`), defaulting to `[]` (always-present array, per the null-safety convention).
- Add `autoTagRulesPath = path.join(os.homedir(), '.copilot', 'gridwatch-autotag-rules.json')` near the other config-path constants (`electron/main.ts:1600`).
- Add `readAutoTagRules()` / `writeAutoTagRules(rules)` helpers with try/catch returning `[]` on any error (same defensive style as the MCP/LSP config readers). Validate each rule: `path` is a non-empty string, `tags` is an array of valid tag strings (reuse the existing tag-validation/sanitisation used by `sessions:set-tags`).
- **Completed:** Helpers compile and return `[]` when the file is absent; `SessionData.autoTags` typed.
- **Test:** `npx tsc --noEmit` passes; temporarily log `readAutoTagRules()` on startup and confirm `[]` with no file, and the parsed array after manually creating the JSON.
- **Status:** Pass when both hold.

### Task 2 — IPC handlers for rule CRUD
- **File:** `electron/main.ts` (after `dirs:*` handlers ~`:2147`).
- `autotag:get-rules` → `AutoTagRule[]`.
- `autotag:set-rules` (replace whole array) **or** granular `autotag:add-rule` / `autotag:remove-rule(id)` — recommend granular add/remove to match the TRUSTED DIRECTORIES UX. Each handler: validate input, write file, then `invalidateSessionsCache()` (`electron/main.ts:747`) so derived tags refresh on next load.
- Wrap every handler body in try/catch returning a safe default (per the IPC-guards convention).
- **Completed:** Handlers registered and callable.
- **Test:** From DevTools console, call `window.gridwatchAPI.addAutoTagRule(...)`, then `getAutoTagRules()` returns the new rule; `removeAutoTagRule(id)` removes it; inspect the JSON file on disk.
- **Status:** Pass when round-trip persists to disk.

### Task 3 — Apply rules when loading sessions
- **File:** `electron/main.ts` inside `loadAllSessions` where `tags` is built (`:481`).
- Read rules **once per `loadAllSessions` call** (not once per session) and pass them into the per-session mapping. For each session, compute matched auto-tags (against `gitRoot` ?? `cwd`, subdirs always included) and set them on the new `autoTags` field, excluding any tag already in the manual `tags` array.
- Keep this purely derived — do **not** write to any session's `gridwatch.json`.
- **Completed:** Sessions under a configured directory expose the rule's tags in `autoTags`.
- **Test:** Add a rule for a directory containing known sessions, refresh, and confirm those sessions show the auto-tags in the Sessions list and are filterable by them; sessions outside the directory are unaffected; sibling dirs with shared prefixes (e.g. `work` vs `work-old`) are correctly excluded; sub-directory sessions are included.
- **Status:** Pass when matched sessions gain auto-tags and boundary cases are correct.

### Task 4 — Preload + global typings
- **Files:** `electron/preload.ts`, `src/types/global.d.ts`.
- Expose `getAutoTagRules`, `addAutoTagRule`, `removeAutoTagRule` on `gridwatchAPI` and type them in `global.d.ts`.
- **Completed:** Renderer can call the new API with full typing.
- **Test:** `npx tsc --noEmit` passes; the methods are typed (no `any`) in the renderer.
- **Status:** Pass when types resolve.

### Task 5 — Settings UI section "AUTO-TAG RULES"
- **Files:** `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.module.css`.
- New `<div className={styles.panel}>` section modelled on TRUSTED DIRECTORIES:
  - List existing rules: directory path (with `title` tooltip for long paths), its tag chips, and a remove `✕` button.
  - "+ ADD RULE" flow: pick a directory via the existing native directory picker (reuse the `dialog.showOpenDialog` approach already used by `dirs:add`, `electron/main.ts:2165`), then enter one or more tags using the existing **`TagInput` component** (`src/components/TagInput`, the same typeahead/chip input used for session tags — Q5). Pass the full existing-tag vocabulary (union of all sessions' `tags` + `autoTags`, or a dedicated `autotag:get-known-tags` helper) as suggestions so duplicates are avoided while new tags are still allowed. Save → `addAutoTagRule`.
  - Empty-state message when no rules exist.
  - Inline error display (reuse the `dirError` pattern) for invalid input (e.g. no tags entered, non-existent directory).
- Load rules on mount via `useEffect` (same as `loadDirs`).
- **Completed:** User can add, view, and remove rules entirely from Settings, with tag typeahead.
- **Test:** `npm run dev`; add a rule, confirm it appears and persists across an app restart; the tag input suggests existing tags; remove the rule; confirm the Sessions list auto-tags update after the next refresh.
- **Status:** Pass when the full UI round-trip works and is reflected in Sessions.

### Task 6 — Render auto-tags distinctly + read-only in Sessions
- **Files:** `src/pages/SessionsPage.tsx`, `src/pages/SessionsPage.module.css`, possibly `src/components/TagInput.tsx`.
- In the session detail tag area, render `selectedSession.autoTags` as chips with a **distinct marker/style** (e.g. an "auto" prefix/icon and a different `var(--tron-*)` accent) and **no remove button** — they are managed only via rules (Q2). Keep the manual `tags` chips and `TagInput` fully editable.
- Update tag **filtering** so a session matches a selected filter tag if it appears in either `tags` or `autoTags`; update `allTags` (`SessionsPage.tsx:250`) to include `autoTags` so auto-tags are filterable.
- Guard against a manual tag duplicating an auto-tag in the UI (main already excludes overlaps from `autoTags`).
- **Completed:** Auto-tags show distinctly, can't be removed per session, and are filterable.
- **Test:** With a rule active, open a matching session: auto-tags appear with the distinct style and no `×`; manual tags still add/remove; filtering by an auto-tag returns the matching sessions.
- **Status:** Pass when rendering, read-only behaviour, and filtering all hold.

### Task 7 — Documentation + verification
- **Files:** `.github/copilot-instructions.md` (document the new config file, `autoTags` field + IPC surface), `README.md` (Features bullet + GridWatch-managed-files table row).
- Run `npx tsc --noEmit` and `npm run build`; manually verify all Task 3/5/6 checks; consult the rubber-duck agent on the matching logic (highest-risk area — path boundaries and platform case sensitivity) before finalising.
- **Completed:** Docs updated, build green, behaviour verified.
- **Test:** `npm run build` passes with no new lint errors; README/instructions reflect the feature.
- **Status:** Pass when build is clean and docs are accurate.

---

## Risks

- **Risk:** Naive prefix matching tags unintended sessions (e.g. `/Code/work` matching `/Code/work-old`).
  - **Impact:** Wrong tags on sessions; misleading filtering.
  - **Mitigation:** Path-boundary-safe comparison (`=== ` or `startsWith(path + sep)`); explicit test for sibling-prefix dirs in Task 3.
- **Risk:** Platform case-sensitivity mismatch (a rule entered with different casing fails to match on macOS/Windows or over-matches on Linux).
  - **Impact:** Rules silently do nothing, or match too broadly.
  - **Mitigation:** Platform-aware comparison; document behaviour in the section help text.
- **Risk:** Performance — re-reading the rules file once per session during load.
  - **Impact:** Slower session loads with many sessions.
  - **Mitigation:** Read rules once per `loadAllSessions` call and pass them in; rules are small.
- **Risk:** Corrupt or hand-edited `gridwatch-autotag-rules.json`.
  - **Impact:** Load failure.
  - **Mitigation:** Defensive try/catch returning `[]`; per-rule validation; never throw from the loader.
- **Risk:** Derived tags are indistinguishable from manual tags, so a user may try to remove an auto-tag from a single session and be confused when it reappears.
  - **Impact:** Confusing UX.
  - **Mitigation:** Decided (Q2): auto-tags use a distinct marker and are read-only on the session, managed only via rules; document this in the section help text.
- **Reversibility:** The derived-tags approach (Q1, decided) is fully reversible — no session files are written, so editing or deleting a rule instantly and completely updates all sessions.

## Security

- **Input handling:** Rule `path` and `tags` are user-provided and written to a JSON file read at startup. Validate/sanitise `tags` with the existing tag rules and treat `path` as data only — never execute it. No shell invocation involved.
- **Path traversal:** The rule path is only ever **compared** against session directories, never used to read/write arbitrary files, so traversal is not exploitable here; still normalise with `path.resolve`.
- **Prototype pollution:** When parsing the JSON, guard object keys the same way the MCP/LSP config readers do (reject `__proto__`/`constructor`/`prototype`, use `hasOwnProperty`).
- **Secrets/PII:** Directory paths may contain a username; this stays local in `~/.copilot/` and is never transmitted (GridWatch makes no network calls for this feature). No tokens or credentials involved.
- **Dependencies:** No new third-party dependencies required (uses Node `path`, `fs`, `crypto.randomUUID`).

## Accessibility

- The "+ ADD RULE" and remove controls must be real `<button>` elements with descriptive `aria-label`s (e.g. `Remove auto-tag rule for /Users/me/Code/work`), matching the existing trusted-dirs buttons.
- Tag chips and their remove buttons need accessible labels and visible keyboard focus states.
- Ensure tag-chip and path text meet WCAG 2.1 AA contrast (4.5:1) using existing `var(--tron-*)` tokens (already compliant in the current theme).
- The whole add flow (pick directory, enter tags, save, remove) must be keyboard-operable; manage focus sensibly after add/remove.

## User Guidance

- **Section help text:** one line under the title explaining rules auto-apply tags to sessions whose working directory is inside the chosen folder, and noting subdirectories are included and the case-sensitivity behaviour.
- **Tooltip** on each rule's directory path (`title`) for long paths, like the existing `dirPath` row.
- **Input hints:** placeholder text in the tag input (e.g. `add a tag…`).
- **Empty state:** "No auto-tag rules configured" when the list is empty (mirrors `dirEmpty`).
- **Actionable errors:** clear inline messages (e.g. "Choose a directory", "Enter at least one tag").
- **Auto-tag clarity (Q2):** auto-tags render with a distinct marker and no remove control on a session; add a short inline hint clarifying they are managed via Settings rules, not per session.
- **Duplicate avoidance (Q5):** the rule tag input uses the shared `TagInput` typeahead, suggesting existing tags so users don't create near-duplicates.

---

## Resolved decisions (confirmed with the user)

1. **Derived at load time.** Non-destructive; nothing written into session `gridwatch.json`. Auto-tags are recomputed from rules on every load.
2. **Distinct + read-only on sessions.** Auto-tags are returned on a separate `autoTags` field, styled distinctly, and cannot be removed from an individual session — managed only via rules. Manual `tags` remain editable.
3. **Match `gitRoot` ?? `cwd`.** Compare the session's `gitRoot` when present, otherwise its `cwd`.
4. **Subdirectories always included.** No per-rule toggle; the `includeSubdirs` field is dropped.
5. **Free-form tags, same validation as manual, no cap, with typeahead.** Reuse the `TagInput` component so existing tags are suggested to avoid duplicates while still allowing new tags.

*Deferred to a possible follow-up (scope two):* auto-suggesting rules from frequently-used directories.
