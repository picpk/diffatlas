import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { countTextTokens } from '../src/context/engine';
import type { TokenEncoding } from '../src/context/types';

const cli = resolve('agent-cli.ts');
const cleanup = new Set<string>();
interface Envelope {
  schemaVersion: number;
  status: string;
  promptPath: string | null;
  reportPath: string | null;
  tokens: null | { original: number; packed: number; saved: number; savingsPercent: number; encoding: TokenEncoding; budget: number; minimumRequiredTokens: number };
  selected: { files: number; units: number };
  alerts: string[];
  alertCount: number;
  error?: string;
}

async function repository(files: Record<string, string>): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'diffatlas-agent-test-'));
  cleanup.add(repo);
  execFileSync('git', ['init', '--quiet', repo]);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), content);
  }
  return repo;
}

function invoke(repo: string, args: string[]) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', cli, '--repo', repo, ...args], {
    encoding: 'utf8', timeout: 20_000,
  });
  expect(child.error).toBeUndefined();
  expect(child.stderr).toBe('');
  const envelope = JSON.parse(child.stdout) as Envelope;
  if (envelope.reportPath) cleanup.add(dirname(envelope.reportPath));
  return { ...child, envelope };
}

afterAll(async () => {
  const temporaryRoot = await realpath(tmpdir());
  for (const path of cleanup) {
    let resolved: string;
    try { resolved = await realpath(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const inside = relative(temporaryRoot, resolved);
    if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
      throw new Error('Refusing to remove a test path outside the temporary directory.');
    }
    await rm(resolved, { recursive: true, force: true });
  }
});

describe('local agent context interface', () => {
  it('returns compact paths and exact counts without printing or duplicating source', async () => {
    const source = 'export function verifyResetToken() { return "SOURCE_PAYLOAD_ONLY_923987"; }\n';
    const repo = await repository({ 'auth.ts': source });
    const result = invoke(repo, ['--task', 'Explain verifyResetToken', '--budget', '1000']);
    expect(result.status).toBe(0);
    expect(result.envelope.schemaVersion).toBe(1);
    expect(result.envelope.status).toBe('ready');
    expect(result.stdout.length).toBeLessThan(2000);
    expect(result.stdout).not.toContain('SOURCE_PAYLOAD_ONLY_923987');
    expect(isAbsolute(result.envelope.promptPath!)).toBe(true);
    expect(isAbsolute(result.envelope.reportPath!)).toBe(true);
    expect(relative(repo, result.envelope.promptPath!).startsWith('..')).toBe(true);
    const prompt = await readFile(result.envelope.promptPath!, 'utf8');
    expect(prompt).toContain(source.trim());
    expect(countTextTokens(prompt)).toBe(result.envelope.tokens!.packed);
    const serialized = await readFile(result.envelope.reportPath!, 'utf8');
    const report = JSON.parse(serialized);
    expect(serialized).not.toContain('SOURCE_PAYLOAD_ONLY_923987');
    expect(report).not.toHaveProperty('baselinePrompt');
    expect(report).not.toHaveProperty('prompt');
    expect(report.chunks).toHaveLength(1);
    expect(report.chunks[0]).not.toHaveProperty('content');
    expect(report.chunks[0].symbols).toContain('verifyResetToken');
    expect(report.packedTokens).toBe(result.envelope.tokens!.packed);
  });

  it('returns needs_attention when an explicitly named target is missing from a partial pack', async () => {
    const large = `const resetLimits = ${JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i, age: i * 99 })))};\n`;
    const repo = await repository({ 'auth.ts': large + 'export function verifyResetToken() { return resetLimits; }\nexport const resetStatus = true;' });
    const result = invoke(repo, ['--task', 'Review verifyResetToken reset behavior', '--budget', '200']);
    expect(result.status).toBe(3);
    expect(result.envelope.status).toBe('needs_attention');
    expect(result.envelope.promptPath).not.toBeNull();
    expect(result.envelope.alerts[0]).toMatch(/^Explicit task target omitted: verifyResetToken/);
    const prompt = await readFile(result.envelope.promptPath!, 'utf8');
    expect(prompt).toContain('export const resetStatus');
    expect(prompt).not.toContain('export function verifyResetToken');
  });

  it('writes only a report and zero savings when required context exceeds the budget', async () => {
    const repo = await repository({ 'auth.ts': 'export const tokenExpiry = 1000;' });
    const result = invoke(repo, ['--task', 'Explain tokenExpiry', '--budget', '1', '--pin', 'auth.ts']);
    expect(result.status).toBe(2);
    expect(result.envelope.status).toBe('budget_exceeded');
    expect(result.envelope.promptPath).toBeNull();
    expect(result.envelope.tokens).toMatchObject({ packed: 0, saved: 0, savingsPercent: 0, budget: 1 });
    expect(result.envelope.tokens!.minimumRequiredTokens).toBeGreaterThan(1);
    expect(await readdir(dirname(result.envelope.reportPath!))).not.toContain('context.md');
    const report = JSON.parse(await readFile(result.envelope.reportPath!, 'utf8'));
    expect(report.status).toBe('budget_exceeded');
    expect(report.budgetExceeded).toBe(true);
  });

  it('does not export or claim token savings for a pack with no source selected', async () => {
    const repo = await repository({ 'large.ts': `export const records = ${JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ index: i, value: i * 23 })))};` });
    const result = invoke(repo, ['--task', 'Explain unrelatedWidget', '--budget', '200']);
    expect(result.status).toBe(3);
    expect(result.envelope.status).toBe('empty');
    expect(result.envelope.promptPath).toBeNull();
    expect(result.envelope.tokens).toMatchObject({ packed: 0, saved: 0, savingsPercent: 0 });
    expect(result.envelope.selected).toEqual({ files: 0, units: 0 });
    const report = JSON.parse(await readFile(result.envelope.reportPath!, 'utf8'));
    expect(report.packedTokens).toBe(0);
    expect(report.savedTokens).toBe(0);
    expect(await readdir(dirname(result.envelope.reportPath!))).not.toContain('context.md');
  });

  it('uses a fresh directory for each run and excludes previous artifacts from later scans', async () => {
    const repo = await repository({ 'auth.ts': 'export const tokenExpiry = 1000;' });
    const parent = join(repo, 'artifacts');
    const args = ['--task', 'Explain tokenExpiry', '--output-dir', parent];
    const first = invoke(repo, args);
    expect(first.status).toBe(0);
    await writeFile(first.envelope.promptPath!, 'PRESERVE_PREVIOUS_ARTIFACT');
    const second = invoke(repo, args);
    expect(second.status).toBe(0);
    expect(second.envelope.promptPath).not.toBe(first.envelope.promptPath);
    expect(second.envelope.reportPath).not.toBe(first.envelope.reportPath);
    expect(await readFile(first.envelope.promptPath!, 'utf8')).toBe('PRESERVE_PREVIOUS_ARTIFACT');
    expect(second.envelope.tokens!.original).toBe(first.envelope.tokens!.original);
    const report = JSON.parse(await readFile(second.envelope.reportPath!, 'utf8'));
    expect(report.stats.filesTotal).toBe(1);
    expect(report.chunks.map((chunk: { path: string }) => chunk.path)).toEqual(['auth.ts']);
  });

  it('supports repeated/comma pins, a diff and the selected encoding', async () => {
    const repo = await repository({
      'auth.ts': 'export const tokenExpiry = 1000;\n',
      'helper.ts': 'export const helper = "中文";\n',
      'config.ts': 'export const config = true;\n',
    });
    const diffDir = await mkdtemp(join(tmpdir(), 'diffatlas-agent-diff-'));
    cleanup.add(diffDir);
    const diffPath = join(diffDir, 'change.diff');
    await writeFile(diffPath, 'diff --git a/auth.ts b/auth.ts\n--- a/auth.ts\n+++ b/auth.ts\n@@ -1 +1 @@\n-export const tokenExpiry = 500;\n+export const tokenExpiry = 1000;\n');
    const result = invoke(repo, ['--task', 'Inspect changes', '--encoding', 'cl100k_base', '--pin', 'auth.ts,helper.ts', '--pin', 'config.ts', '--diff', diffPath]);
    expect(result.status).toBe(0);
    const prompt = await readFile(result.envelope.promptPath!, 'utf8');
    expect(prompt).toContain('# Complete diff');
    expect(result.envelope.tokens!.encoding).toBe('cl100k_base');
    expect(countTextTokens(prompt, 'cl100k_base')).toBe(result.envelope.tokens!.packed);
    const report = JSON.parse(await readFile(result.envelope.reportPath!, 'utf8'));
    expect(report.chunks.every((chunk: { required: boolean }) => chunk.required)).toBe(true);
    expect(report.stats.filesSelected).toBe(3);
  });

  it('caps stdout alerts while keeping complete warnings in the report', async () => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`module${i}.py`, `sample_${i} = ${i}\n`]));
    const repo = await repository(files);
    const result = invoke(repo, ['--task', 'Explain sample', '--budget', '4000']);
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeLessThan(2000);
    expect(result.envelope.alerts).toHaveLength(3);
    expect(result.envelope.alertCount).toBe(12);
    const report = JSON.parse(await readFile(result.envelope.reportPath!, 'utf8'));
    expect(report.warnings).toHaveLength(15);
  });

  it('reports invalid input as JSON with no misleading output paths', async () => {
    const repo = await repository({ 'auth.ts': 'export const tokenExpiry = 1000;' });
    const result = invoke(repo, ['--task', 'Explain tokenExpiry', '--budget=-1']);
    expect(result.status).toBe(1);
    expect(result.envelope).toMatchObject({ schemaVersion: 1, status: 'error', promptPath: null, reportPath: null, tokens: null });
    expect(result.envelope.error).toContain('positive integer');
  });
});
