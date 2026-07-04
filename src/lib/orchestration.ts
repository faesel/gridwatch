import type {
  OrchestrationChild,
  OrchestrationConfig,
  OrchestrationMode,
  OrchestrationStatus,
} from '../types/skill';

// Markers anchoring the GridWatch-managed workflow inside an orchestrator's SKILL.md.
export const ORCH_START = '<!-- gridwatch:orchestration:start -->';
export const ORCH_END = '<!-- gridwatch:orchestration:end -->';

// Markers anchoring the user's editable "work step" inside a generated child scaffold.
export const BODY_START = '<!-- gridwatch:body:start -->';
export const BODY_END = '<!-- gridwatch:body:end -->';

const BANNER_TOP = [
  '<!-- ============================================================ -->',
  '<!-- GRIDWATCH-MANAGED — DO NOT EDIT BELOW.                       -->',
  '<!-- This block is regenerated from the Skills Graph orchestration -->',
  '<!-- config. Manual edits here are overwritten on regenerate.      -->',
  '<!-- ============================================================ -->',
].join('\n');

const BANNER_BOTTOM = [
  '<!-- ============================================================ -->',
  '<!-- END GRIDWATCH-MANAGED — you may edit below this line again.  -->',
  '<!-- ============================================================ -->',
].join('\n');

export interface ResolvedChild {
  name: string;
  inputDir: string;
  outputDir: string;
  outputFile: string;
}

/** Resolve a child's effective folders, inheriting the orchestrator's output folder when blank. */
export function resolveChild(name: string, config: OrchestrationConfig): ResolvedChild {
  const child: OrchestrationChild = config.children?.[name] ?? {};
  const outputDir = (child.outputDir || config.outputDir || '').trim();
  const inputDir = (child.inputDir || '').trim();
  const outputFile = (child.outputFile || `${name}-output-<SESSION_ID>.md`).trim();
  return { name, inputDir, outputDir, outputFile };
}

function joinPath(dir: string, file: string): string {
  if (!dir) return file;
  return `${dir.replace(/\/+$/, '')}/${file}`;
}

/**
 * Render the inner workflow markdown (without markers/banner) for an orchestrator.
 * `order` is the ordered list of child skill folder names (= run order).
 */
export function renderOrchestratorWorkflow(
  displayName: string,
  skillName: string,
  config: OrchestrationConfig,
  order: string[],
): string {
  const resolved = order.map((n) => resolveChild(n, config));
  const mode: OrchestrationMode = config.mode === 'parallel' ? 'parallel' : 'sequential';
  const lines: string[] = [];

  lines.push(`## Workflow (${mode})`);
  lines.push('');
  lines.push(`1. **Announce** — Print: \`🚀 [${skillName}] Starting ${displayName} (${mode})...\``);
  lines.push(
    '2. **Determine the session identifier** — Set `SESSION_ID` to the current Copilot CLI ' +
      'session id (the UUID of the active session under `~/.copilot/session-state/`). Use it to ' +
      'name all output files so concurrent runs do not clash.',
  );

  if (resolved.length === 0) {
    lines.push('3. **No steps attached yet** — Attach child skills in the GridWatch Skills Graph.');
  } else if (mode === 'parallel') {
    lines.push('3. **Launch all steps in parallel** using the `task` tool with `mode: "background"`. Announce each step yourself as you launch it (background tasks do not print to this console):');
    for (const c of resolved) {
      const out = joinPath(c.outputDir, c.outputFile);
      const readPart = c.inputDir ? ` It should read its input from \`${c.inputDir}\`.` : '';
      lines.push(`   - **${c.name}** — Print \`📣 [${skillName}] Launching ${c.name}…\`, then launch it as a background task.${readPart} Instruct it to write its output to \`${out}\`.`);
    }
    lines.push('4. **Wait for all steps to complete** — Collect each result with `read_agent`.');
  } else {
    lines.push('3. **Run each step in order, waiting for each to finish before the next. Announce each step yourself before running it:**');
    resolved.forEach((c, i) => {
      const out = joinPath(c.outputDir, c.outputFile);
      const readPart = c.inputDir ? ` Tell it to read its input from \`${c.inputDir}\`.` : '';
      lines.push(`   ${i + 1}. **${c.name}** — Print \`📣 [${skillName}] Running ${c.name}…\`, then run the \`${c.name}\` skill and wait for it to finish.${readPart} Instruct it to write its output to \`${out}\`.`);
    });
    lines.push('4. **Confirm each step wrote its output** before continuing.');
  }

  let step = resolved.length === 0 ? 4 : 5;
  if (config.finalOutput && resolved.length > 0) {
    const finalOut = joinPath(config.outputDir, config.finalOutput);
    const inputs = resolved.map((c) => joinPath(c.outputDir, c.outputFile)).join(', ');
    lines.push(
      `${step}. **Consolidate** — Create \`${finalOut}\` by concatenating the **full, verbatim** contents of ` +
        `${inputs}. Do NOT summarise, abridge, truncate, or rewrite any report — copy every section of each ` +
        `file in its entirety. Add a short heading before each file's content identifying which step produced ` +
        `it, then paste that file's complete text. The consolidated file must contain everything from every ` +
        `source file. Keep the individual files alongside it.`,
    );
    step += 1;
  }
  lines.push(`${step}. **Report back** — Print a short summary and the absolute path(s) to the output(s).`);
  step += 1;
  lines.push(`${step}. **Announce completion** — Print: \`✅ [${skillName}] Finished ${displayName} (${mode}).\``);

  return lines.join('\n');
}

/** Wrap inner workflow content with the banner + markers to form the full managed block. */
export function buildManagedBlock(innerContent: string): string {
  return [BANNER_TOP, ORCH_START, '', innerContent.trim(), '', ORCH_END, BANNER_BOTTOM].join('\n');
}

/** Normalise a block for hashing/comparison: trim trailing whitespace, collapse blank runs. */
export function normaliseBlock(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ManagedBlockScan {
  status: 'missing' | 'ok' | 'broken';
  /** Inner content between the markers (only when status === 'ok'). */
  inner?: string;
  reason?: string;
}

/** Locate the managed block within a SKILL.md and report marker integrity. */
export function scanManagedBlock(fileText: string): ManagedBlockScan {
  const text = fileText.replace(/\r\n/g, '\n');
  const startCount = (text.match(new RegExp(escapeRe(ORCH_START), 'g')) || []).length;
  const endCount = (text.match(new RegExp(escapeRe(ORCH_END), 'g')) || []).length;

  if (startCount === 0 && endCount === 0) return { status: 'missing' };
  if (startCount > 1 || endCount > 1) {
    return { status: 'broken', reason: 'Multiple managed blocks found — remove the extra one.' };
  }
  if (startCount !== 1 || endCount !== 1) {
    return { status: 'broken', reason: 'Managed markers missing — restore them or recreate the orchestrator.' };
  }
  const startIdx = text.indexOf(ORCH_START);
  const endIdx = text.indexOf(ORCH_END);
  if (endIdx < startIdx) {
    return { status: 'broken', reason: 'Managed markers are out of order.' };
  }
  const inner = text.slice(startIdx + ORCH_START.length, endIdx);
  return { status: 'ok', inner };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute the orchestration status given the SKILL.md text and the stored hash of the
 * last-generated block. `hashFn` supplies a hashing implementation (node:crypto in main).
 */
export function computeOrchestrationStatus(
  fileText: string,
  generatedHash: string | undefined,
  hashFn: (s: string) => string,
): OrchestrationStatus {
  const scan = scanManagedBlock(fileText);
  if (scan.status === 'missing') return 'missing';
  if (scan.status === 'broken') return 'broken';
  if (!generatedHash) return 'in-sync';
  const currentHash = hashFn(normaliseBlock(scan.inner ?? ''));
  return currentHash === generatedHash ? 'in-sync' : 'edited';
}

/**
 * Merge a freshly-rendered managed block into an existing SKILL.md.
 * Returns the new file text, or a `broken` result if markers can't be anchored safely.
 */
export function mergeManagedBlock(
  fileText: string,
  managedBlock: string,
): { ok: true; text: string } | { ok: false; reason: string } {
  const text = fileText.replace(/\r\n/g, '\n');
  const scan = scanManagedBlock(text);
  if (scan.status === 'broken') return { ok: false, reason: scan.reason ?? 'Broken managed block' };

  if (scan.status === 'missing') {
    const sep = text.endsWith('\n') ? '\n' : '\n\n';
    return { ok: true, text: `${text}${sep}${managedBlock}\n` };
  }
  const startIdx = text.indexOf(ORCH_START);
  const endIdx = text.indexOf(ORCH_END) + ORCH_END.length;
  const before = text.slice(0, startIdx);
  const after = text.slice(endIdx);
  // Trim a banner (consecutive comment lines) immediately before/after the markers.
  // Comment bodies use [\s\S]*? (not [^\n]*) so multi-line HTML comments are matched safely.
  const beforeTrimmed = before.replace(/(?:<!--[\s\S]*?-->\n)+$/, '');
  const afterTrimmed = after.replace(/^\n?(?:<!--[\s\S]*?-->\n?)+/, '');
  const head = beforeTrimmed.replace(/\n+$/, '');
  const tail = afterTrimmed.replace(/^\n+/, '');
  const newText = `${head}\n\n${managedBlock}\n${tail ? `\n${tail}` : '\n'}`;
  return { ok: true, text: newText };
}

/** Render a full child-skill scaffold SKILL.md that follows the orchestration I/O contract. */
export function renderChildScaffold(
  name: string,
  description: string,
  orchestratorName?: string,
): string {
  const desc = (description || 'TODO: Add a description').replace(/[\r\n]+/g, ' ').trim();
  const usedBy = orchestratorName
    ? `Invoked as a step in the \`${orchestratorName}\` orchestration (reads an input, writes an output).`
    : 'Invoked as a step in a GridWatch orchestration (reads an input, writes an output).';
  return [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    '---',
    '',
    `# ${name}`,
    '',
    '**When to use this skill**',
    `- ${usedBy}`,
    '- Can also be run standalone.',
    '',
    '## Inputs / Outputs (orchestration contract)',
    '',
    'This skill follows the GridWatch orchestration I/O contract so an orchestrator can chain it:',
    '',
    '- `input_path` (optional) — Absolute path this step READS. When run by an orchestrator this is',
    "  the upstream step's output (auto-wired in the Skills Graph). Standalone: the user supplies it.",
    '- `output_path` (required when chained) — Absolute path this step WRITES its result to. The',
    '  orchestrator sets this to `<outputDir>/<outputFile>` (e.g. `.../result-<SESSION_ID>.md`).',
    `- If \`output_path\` is not provided, default to \`./${name}-output.md\` in the working directory.`,
    '',
    '## Workflow',
    '',
    `1. **Announce** — Print: \`🔧 [${name}] Starting…\``,
    '2. **Read input** — If `input_path` is provided, read it; otherwise gather inputs as described below.',
    '3. **Do the work** —',
    `   ${BODY_START}`,
    '   > **PASTE OR WRITE YOUR SKILL INSTRUCTIONS HERE.**',
    '   > Describe exactly what this step should do with the input and produce as output.',
    `   ${BODY_END}`,
    '4. **Write output** — Write the result to `output_path` (create parent folders if needed). The',
    '   result MUST be saved to `output_path`, not returned only in chat.',
    '5. **Report back** — Print a one-line summary and the absolute `output_path`.',
    '',
    '## Notes',
    '',
    '- This skill is wired into an orchestrator via GridWatch (Skills Graph). The orchestrator passes',
    '  the input/output paths at runtime — do not hard-code them here.',
    '',
  ].join('\n');
}

/** Insert a pasted body into the scaffold's work-step markers (or return scaffold unchanged). */
export function applyPastedBody(scaffold: string, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return scaffold;
  const startIdx = scaffold.indexOf(BODY_START);
  const endIdx = scaffold.indexOf(BODY_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return scaffold;
  const indented = trimmed
    .split('\n')
    .map((l) => `   ${l}`)
    .join('\n');
  return (
    scaffold.slice(0, startIdx + BODY_START.length) +
    '\n' +
    indented +
    '\n   ' +
    scaffold.slice(endIdx)
  );
}

/** True when a pasted full SKILL.md declares the orchestration I/O contract (else best-effort). */
export function declaresIoContract(skillMd: string): boolean {
  return /output_path/.test(skillMd);
}
