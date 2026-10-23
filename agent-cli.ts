#!/usr/bin/env node
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { packContext } from './src/context/engine';
import { loadRepository, readBoundedFile } from './src/context/repository';
import type { PackResult, TokenEncoding } from './src/context/types';

type AgentStatus = 'ready' | 'needs_attention' | 'empty' | 'budget_exceeded' | 'error';

const HELP = `DiffAtlas Context — local agent interface

Usage:
  node pack.mjs --repo ./project --task "Fix verifyResetToken expiry" --budget 4000
  npm run --silent pack:agent -- --repo ./project --task "Explain parseConfig"

Options:
  --repo <directory>      Git working directory or subdirectory (default: .)
  --task <text>           Coding task, required
  --budget <tokens>       Complete prompt token budget (default: 4000)
  --encoding <name>       o200k_base (default) or cl100k_base
  --diff <file>           Include a unified Git diff
  --pin <paths>           Keep full files; repeat or separate paths with commas
  --output-dir <parent>   Create a unique artifact subdirectory here (default: OS temp)
  --help                 Show this help

Normal stdout is one compact JSON object. Read promptPath only after checking status.
Artifacts: context.md (usable source only), report.json (metadata; no duplicate source).
Existing artifacts are never overwritten. Processing is local; no source execution,
model or network call. Requires Git. Input limits: 100 files, 100 KiB each, 1 MiB total.
Exit codes: 0 ready; 3 needs_attention or empty; 2 budget_exceeded; 1 error.
`;

const LIMITATIONS = [
  'Token counts cover the exported prompt in the selected encoding; tool/report overhead and output tokens are excluded.',
  'Lexical selection and one relative-import hop do not guarantee complete context or unchanged answer quality.',
];
const EXPLICIT_TARGET = 'Explicit task target omitted:';

function summarizeTokens(result: PackResult, hasPrompt: boolean) {
  return {
    original: result.originalTokens,
    packed: hasPrompt ? result.packedTokens : 0,
    saved: hasPrompt ? result.savedTokens : 0,
    savingsPercent: hasPrompt ? result.savingsPercent : 0,
    encoding: result.encoding,
    budget: result.budget,
    minimumRequiredTokens: result.minimumRequiredTokens,
  };
}

function shortText(text: string, length = 260): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

export async function main(args: string[]): Promise<number> {
  let artifactDirectory: string | undefined;
  let artifactParent: string | undefined;
  try {
    const { values } = parseArgs({ args, options: {
      repo: { type: 'string', default: '.' }, task: { type: 'string' },
      budget: { type: 'string', default: '4000' }, encoding: { type: 'string', default: 'o200k_base' },
      diff: { type: 'string' }, pin: { type: 'string', multiple: true },
      'output-dir': { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help) { process.stdout.write(HELP); return 0; }
    if (!values.task?.trim()) throw new Error('Provide --task with the coding task to prepare context for.');
    if (!['o200k_base', 'cl100k_base'].includes(values.encoding!)) throw new Error('--encoding must be o200k_base or cl100k_base.');
    const budget = Number(values.budget);
    if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('--budget must be a positive integer.');
    const scan = await loadRepository(values.repo!);
    const result = packContext({
      task: values.task, files: scan.files, budget, encoding: values.encoding as TokenEncoding,
      diff: values.diff ? await readBoundedFile(values.diff) : undefined,
      pinnedPaths: values.pin?.flatMap(item => item.split(',')).filter(Boolean),
    });
    const hasPrompt = !result.budgetExceeded && result.chunks.length > 0;
    const namedTargetWarnings = result.warnings.filter(warning => warning.startsWith(EXPLICIT_TARGET));
    const status: AgentStatus = result.budgetExceeded ? 'budget_exceeded'
      : !hasPrompt ? 'empty' : namedTargetWarnings.length ? 'needs_attention' : 'ready';

    const parent = resolve(values['output-dir'] ?? tmpdir());
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const realParent = await realpath(parent);
    if (!values['output-dir'] && isInside(scan.root, realParent)) {
      throw new Error('The OS temporary directory is inside --repo. Use --output-dir with a parent outside the repository.');
    }
    artifactParent = realParent;
    artifactDirectory = await mkdtemp(join(realParent, 'diffatlas-context-'));
    // Creating artifacts after the scan keeps the current output out of its own
    // input. This ignore file also excludes earlier runs on subsequent scans.
    await writeFile(join(artifactDirectory, '.gitignore'), '*\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const promptPath = hasPrompt ? join(artifactDirectory, 'context.md') : null;
    const reportPath = join(artifactDirectory, 'report.json');
    const tokens = summarizeTokens(result, hasPrompt);
    const { prompt: _prompt, baselinePrompt: _baseline, chunks, ...metadata } = result;
    const report = {
      schemaVersion: 1, status, promptPath,
      ...metadata,
      packedTokens: tokens.packed, savedTokens: tokens.saved, savingsPercent: tokens.savingsPercent,
      chunks: chunks.map(({ content: _content, ...chunk }) => chunk),
      scan: { root: scan.root, excluded: scan.excluded },
    };
    if (promptPath) await writeFile(promptPath, result.prompt, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });

    // The first three engine warnings describe fixed limitations, which the
    // envelope summarizes separately. Full warnings remain in report.json.
    const alerts = [
      ...namedTargetWarnings,
      ...result.warnings.slice(3).filter(warning => !warning.startsWith(EXPLICIT_TARGET)),
    ];
    process.stdout.write(JSON.stringify({
      schemaVersion: 1, status, promptPath, reportPath, tokens,
      selected: { files: result.stats.filesSelected, units: result.stats.unitsSelected },
      alerts: alerts.slice(0, 3).map(warning => shortText(warning)), alertCount: alerts.length,
      limitations: LIMITATIONS,
    }) + '\n');
    return status === 'ready' ? 0 : status === 'budget_exceeded' ? 2 : 3;
  } catch (error) {
    if (artifactDirectory && artifactParent) {
      const createdDirectory = artifactDirectory;
      const createdParent = artifactParent;
      await (async () => {
        const resolved = await realpath(createdDirectory);
        if (isAbsolute(resolved) && dirname(resolved) === createdParent && basename(resolved).startsWith('diffatlas-context-')) {
          await rm(resolved, { recursive: true, force: true });
        }
      })().catch(() => {});
    }
    process.stdout.write(JSON.stringify({
      schemaVersion: 1, status: 'error', promptPath: null, reportPath: null, tokens: null,
      selected: { files: 0, units: 0 }, alerts: [], alertCount: 0,
      error: shortText(error instanceof Error ? error.message : 'Context packing failed.', 600),
    }) + '\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
