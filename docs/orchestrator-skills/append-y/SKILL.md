---
name: append-y
description: Appends the letter Y to a text file. Second step of the append-letters demo orchestrator.
---

# append-y

**When to use this skill**

- Invoked as the second step in the `append-letters` orchestration (runs after `append-x`).
- Can also be run standalone to append `Y` to a file.

## Inputs / Outputs (orchestration contract)

- `input_path` (optional) — The folder produced by the previous step. The orchestrator wires this
  to `append-x`'s output folder so this step writes to the same file.
- `output_path` (required when chained) — Absolute path of the file to append to. The
  orchestrator sets this to `<outputDir>/letters-<SESSION_ID>.txt`.
- If `output_path` is not provided, default to `./letters.txt` in the working directory.

## Workflow

1. **Announce** — Print: `🔧 [append-y] Appending "Y"…`
2. **Resolve the output path** — Use `output_path` if provided, otherwise `./letters.txt`.
   Create the parent folder if it does not exist.
3. **Append** — Append the single character `Y` to the file (create the file if missing). Do not
   overwrite existing content — the file should already contain `X` from the previous step.
4. **Report back** — Print a one-line summary and the absolute `output_path`.
