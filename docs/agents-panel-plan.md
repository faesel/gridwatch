# Agents Panel — Design Plan

## Overview

The **Agents** panel surfaces the different Copilot agent types that have been used across
all sessions, mirroring the information presented by the `/agent` command in GitHub Copilot
CLI. It sits immediately below the MCP entry in the sidebar, following the same two-panel
master/detail layout used by the MCP and Skills pages.

---

## What Is a Copilot Agent?

When you run a session with GitHub Copilot CLI certain events in `events.jsonl` carry an
`agent_type` field that identifies which specialised agent handled the work:

| Agent type (internal) | Display name | Detection rule |
|---|---|---|
| `research` | Research | First `user.message` content starts with `"Researching: "` |
| `code-review` | Code Review | Any event line contains `"agent_type":"code-review"` |
| `coding` | Coding | All other sessions (the default Copilot agent) |

More agent types may be added by Copilot in the future. The panel is designed to be
extensible — any new `agent_type` value seen in logs would appear automatically.

---

## Data Sources

All data is derived from the `SessionSummary[]` array that is already loaded in `App.tsx`
and passed to the page as a prop. No new IPC handlers are required.

Relevant fields used from `SessionSummary`:

| Field | Used for |
|---|---|
| `isResearch` | Tag session as a Research agent session |
| `isReview` | Tag session as a Code Review agent session |
| `updatedAt` | Sort sessions newest-first; determine "last used" date |
| `createdAt` | Calculate session age |
| `summary` | Session title in the session list |
| `repository` | Repository context for each session |
| `turnCount` | Activity metric |
| `userMessageCount` | Activity metric |
| `researchReportCount` | Research output count (Research agent only) |
| `peakTokens` | Token usage for each session |
| `tags` | Session tags |

---

## UI Design

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  AGENTS panel                                               │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │  LIST PANEL      │  │  DETAIL PANEL                    │ │
│  │  (280px)         │  │  (flex-1)                        │ │
│  │                  │  │                                  │ │
│  │  AGENTS  [3]     │  │  Research               RESEARCH │ │
│  │  ─────────────── │  │  ─────────────────────────────── │ │
│  │  ▸ Research      │  │  ── OVERVIEW ──────────────────  │ │
│  │    14 sessions   │  │  Sessions     14                 │ │
│  │  ▸ Code Review   │  │  Last used    2 days ago         │ │
│  │    6 sessions    │  │  Turns        143                │ │
│  │  ▸ Coding        │  │  Reports      22                 │ │
│  │    89 sessions   │  │                                  │ │
│  │                  │  │  ── SESSIONS ─────────────────── │ │
│  │                  │  │  [search]                        │ │
│  │                  │  │  · My project research  2d ago   │ │
│  │                  │  │  · API design research  5d ago   │ │
│  │                  │  │    …                             │ │
│  └──────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### List Panel

- **Header**: "AGENTS" title + total agent-type count badge
- **Agent card** per detected agent type, showing:
  - Agent display name (e.g. "Research", "Code Review", "Coding")
  - Agent type badge (coloured per type — cyan for Research, blue for Code Review,
    dim for Coding)
  - Session count
  - "Last used" relative timestamp

### Detail Panel

When an agent type is selected:

#### Header
- Agent display name (large, cyan)
- Agent type badge

#### Overview section
Key statistics for the selected agent type:
- **Sessions** — total session count
- **Last used** — relative time of most recent session
- **Total turns** — sum of `turnCount` across all matching sessions
- **Total messages** — sum of `userMessageCount` across all matching sessions
- **Reports** — (Research only) sum of `researchReportCount`
- **Avg turns/session** — rounded mean

#### Sessions section
- Search/filter input
- Scrollable list of sessions using the agent type, sorted newest-first
- Each session row shows:
  - Session summary/title (truncated)
  - Repository name if available
  - `updatedAt` relative timestamp
  - Turn count
  - Research report count badge (Research agent only)
  - Clicking a row opens the session in the Sessions page (future enhancement; v1 shows info only)

#### Empty detail state
Centred icon + "Select an agent type to view its sessions" message.

---

## Feature List (v1)

- [x] Two-panel master/detail layout
- [x] Agent types derived from `SessionSummary` flags (`isResearch`, `isReview`)
- [x] Session count, last used, turns, messages per agent type
- [x] Searchable session list per agent type
- [x] Research report count shown for Research agent sessions
- [x] Overview statistics panel

## Future Enhancements

- [ ] Click session row to jump to Sessions page with that session pre-selected
- [ ] Export sessions by agent type (CSV / JSON)
- [ ] Chart: agent usage over time (timeline bar chart)
- [ ] Detect additional `agent_type` values from `events.jsonl` as Copilot adds new agents
- [ ] Filter/sort sessions within the detail panel (by date, by turn count)

---

## Implementation Checklist

- [x] `docs/agents-panel-plan.md` — this file
- [x] `src/pages/AgentsPage.tsx` — React component
- [x] `src/pages/AgentsPage.module.css` — Tron-themed styles
- [x] `src/App.tsx` — add `{ id: 'agents', label: 'AGENTS', icon: '◎' }` after `mcp`
- [x] Wire `<AgentsPage sessions={sessions} />` in the `renderPage` switch
