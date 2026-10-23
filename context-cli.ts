#!/usr/bin/env node
import { lstat, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { packContext } from './src/context/engine';
import { loadRepository, readBoundedFile } from './src/context/repository';
import type { TokenEncoding } from './src/context/types';

const HELP = `DiffAtlas Context — local, task-aware code context packing

Usage:
  npm run --silent pack -- --repo . --task "Fix token expiry in verifyResetToken" --budget 4000 --output context.md
  node dist-server/context-cli.js --repo ./project --task "Explain parseConfig" --format json

Options:
  --repo <directory>  Git working directory or subdirectory (default: .)
  --task <text>       The coding task, required
  --budget <tokens>   Maximum complete prompt tokens (default: 4000)
  --encoding <name>   o200k_base (default) or cl100k_base
  --diff <file>       Include and prioritize a unified Git diff
  --pin <paths>       Keep full files; repeat or separate paths with commas
  --format <format>  prompt (default) or json
  --output <file>    Write the selected format to a UTF-8 file
  --help             Show help

No model or network call. Git-ignored files, credential filenames, generated files,
symlinks and binary files are excluded. Source-file credentials are not detected.
Input: at most 100 eligible files, 100 KiB each, 1 MiB total. Narrow --repo for larger projects.
Counts apply to the selected encoding and exclude provider-specific message overhead.
Exit codes: 0 success, 1 input/read error, 2 required context exceeds budget.
`;

async function prepareOutputPath(path: string): Promise<string> {
  const absolute = resolve(path);
  const output = join(await realpath(dirname(absolute)), basename(absolute));
  try {
    const info = await lstat(output);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('--output must be a regular file, not a symlink or directory.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return output;
}

async function writeOutput(path: string, content: string): Promise<void> {
  // Renaming a new file replaces a destination directory entry; unlike direct
  // writeFile, it cannot follow a symlink swapped into the final output path.
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function main(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: {
    repo: { type: 'string', default: '.' }, task: { type: 'string' },
    budget: { type: 'string', default: '4000' }, encoding: { type: 'string', default: 'o200k_base' },
    diff: { type: 'string' }, pin: { type: 'string', multiple: true },
    format: { type: 'string', default: 'prompt' }, output: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) { process.stdout.write(HELP); return 0; }
  if (!values.task?.trim()) throw new Error('Provide --task with the coding task to prepare context for.');
  if (!['prompt', 'json'].includes(values.format!)) throw new Error('--format must be prompt or json.');
  if (!['o200k_base', 'cl100k_base'].includes(values.encoding!)) throw new Error('--encoding must be o200k_base or cl100k_base.');
  const budget = Number(values.budget);
  if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('--budget must be a positive integer.');
  const outputPath = values.output ? await prepareOutputPath(values.output) : undefined;
  const scan = await loadRepository(values.repo!, outputPath ? [outputPath] : []);
  const result = packContext({
    task: values.task, files: scan.files, budget, encoding: values.encoding as TokenEncoding,
    diff: values.diff ? await readBoundedFile(values.diff) : undefined,
    pinnedPaths: values.pin?.flatMap(item => item.split(',')).filter(Boolean),
  });
  const report = { ...result, scan: { root: scan.root, excluded: scan.excluded } };
  if (result.budgetExceeded) process.stderr.write(`DiffAtlas: no pack produced; required context needs ${result.minimumRequiredTokens} tokens, budget ${result.budget}.\n`);
  else process.stderr.write(`DiffAtlas: ${result.originalTokens} -> ${result.packedTokens} ${result.encoding} tokens; ${result.savingsPercent.toFixed(1)}% saved; ${result.stats.filesSelected}/${result.stats.filesTotal} eligible files selected.\n`);
  if (scan.excluded.length) process.stderr.write(`${scan.excluded.length} paths excluded before the baseline; use --format json for the list.\n`);
  for (const warning of result.warnings) process.stderr.write(`Warning: ${warning}\n`);
  if (result.budgetExceeded && values.format === 'prompt') {
    process.stderr.write(`Required context needs at least ${result.minimumRequiredTokens} tokens. Increase --budget. No prompt was written.\n`);
    return 2;
  }
  // No extra newline is appended to a raw prompt: its bytes match the counted payload exactly.
  const output = values.format === 'json' ? JSON.stringify(report, null, 2) + '\n' : result.prompt;
  if (outputPath) await writeOutput(outputPath, output);
  else process.stdout.write(output);
  return result.budgetExceeded ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`DiffAtlas: ${error instanceof Error ? error.message : 'Context packing failed.'}\n`);
    process.exitCode = 1;
  });
}
