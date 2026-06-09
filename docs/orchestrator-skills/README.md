# Orchestrator skills

An **orchestrator skill** is an ordinary Copilot CLI skill that GridWatch has flagged as a
runner for other ("child") skills. You build one visually in **GridWatch → Skills Graph → EDIT**:
attach child skills, choose how they run, wire their input/output folders, and click **Save**.
GridWatch then writes a runnable workflow into the orchestrator's own `SKILL.md`.

This folder contains a complete, minimal example you can read end-to-end.

---

## Anatomy

An orchestrator is made of three things:

1. **`gridwatch.json`** — the machine-readable configuration (run order, mode, per-child I/O
   folders, final output). GridWatch owns this file.
2. **A managed block inside `SKILL.md`** — the human-readable workflow GridWatch generates from
   the configuration. It is anchored by markers and wrapped in a DO-NOT-EDIT banner:

   ```text
   <!-- gridwatch:orchestration:start -->
   ... generated workflow ...
   <!-- gridwatch:orchestration:end -->
   ```

   Only the text **between** these markers is rewritten on regenerate. Anything you write
   **outside** the block (your own description, "when to use", notes) is preserved. A
   `SKILL.md.bak` backup is written before each regenerate.
3. **The child skills** — normal skills that do the actual work. A child reads an optional input
   path and writes its result to an output path the orchestrator provides at runtime.

### Sequential vs parallel

| Mode         | Behaviour                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------ |
| `sequential` | Runs each child one-by-one, waiting for each to finish. Each step's input folder is auto-wired to the previous step's output folder. |
| `parallel`   | Launches every child at once as background tasks, then waits for all to finish. Steps take no input by default. |

In **both** modes the orchestrator announces each step itself (`📣 [<orchestrator>] Running …`)
before launching it, because background tasks do not print to the main console.

### Run order

The run order is simply the order in which you attached the child skills (stored as the
`childSkills` array). Re-order or detach steps in EDIT mode.

### Status badge

GridWatch hashes the managed block and compares it to the hash stored when it was last
generated:

- **In sync** — the block matches the saved configuration.
- **Edited** — someone hand-edited inside the managed block.
- **Broken** — the markers are missing, duplicated, or out of order (regenerate to repair, or
  restore from `SKILL.md.bak`).

---

## Worked example: `append-letters`

A trivial **sequential** orchestrator that appends a character to a file. It runs two child
skills one after the other:

| Step | Skill      | What it does                                       |
| ---- | ---------- | -------------------------------------------------- |
| 1    | `append-x` | Creates the file and appends the letter `X`.       |
| 2    | `append-y` | Reads the same folder and appends the letter `Y`.  |

The result is a file `letters-<SESSION_ID>.txt` containing `XY`.

Files in this folder:

```
append-letters/
  gridwatch.json     ← the orchestration configuration GridWatch writes
  SKILL.md           ← the orchestrator, with the generated managed block
append-x/
  SKILL.md           ← child skill: appends "X"
append-y/
  SKILL.md           ← child skill: appends "Y"
```

To try it yourself, copy the three skill folders into `~/.copilot/skills/`, open GridWatch,
select **append-letters** in the Skills Graph, and run it from Copilot CLI with
*"use the append-letters skill"*. Change the demo `/tmp/gridwatch-demo` output folder to one you
prefer in EDIT mode and click **Save**.

> These are illustrative snippets. The managed block shown in `append-letters/SKILL.md` is the
> verbatim output of GridWatch's generator, so it reflects exactly what the tool produces.
