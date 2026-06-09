---
name: append-x
description: Appends the letter X to a text file. First step of the append-letters demo orchestrator.
---

# append-x

**When to use this skill**

- Invoked as the first step in the `append-letters` orchestration.
- Can also be run standalone to append `X` to a file.

## Inputs / Outputs (orchestration contract)

- `input_path` (optional) — not used by this step.
- `output_path` (required when chained) — Absolute path of the file to append to. The
  orchestrator sets this to `<outputDir>/letters-<SESSION_ID>.txt`.
- If `output_path` is not provided, default to `./letters.txt` in the working directory.

## Workflow

1. **Announce** — Print: `🔧 [append-x] Appending "X"…`
2. **Resolve the output path** — Use `output_path` if provided, otherwise `./letters.txt`.
   Create the parent folder if it does not exist.
3. **Append** — Append the single character `X` to the file (create the file if missing). Do not
   overwrite existing content.
4. **Report back** — Print a one-line summary and the absolute `output_path`.
