import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { buildSkill } from './build-skill.mjs';
import { installSkill } from './install-skill.mjs';

const temporaryParent = resolve(tmpdir());
const work = await mkdtemp(join(temporaryParent, 'diffatlas-skill-smoke-'));
try {
  const installed = await installSkill(await buildSkill(), join(work, 'installed skill', 'diffatlas-context'));
  const repo = join(work, 'repository');
  await mkdir(repo);
  execFileSync('git', ['init', '--quiet', repo]);
  await writeFile(join(repo, 'expiry.ts'), 'export function isExpired(now: number, expiresAt: number) { return now >= expiresAt; }\n');
  const run = spawnSync(process.execPath, [join(installed, 'scripts', 'pack.mjs'), '--repo', repo,
    '--task', 'Explain isExpired boundary behavior', '--budget', '1000', '--output-dir', join(work, 'results')],
  { cwd: work, encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 0, (run.stderr + run.stdout).slice(-3000));
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.status, 'ready');
  assert.ok(isAbsolute(summary.promptPath));
  assert.ok(isAbsolute(summary.reportPath));
  assert.ok(!run.stdout.includes('return now >= expiresAt'), 'Source must not leak into the compact envelope.');
  assert.match(await readFile(summary.promptPath, 'utf8'), /return now >= expiresAt/);
  const report = JSON.parse(await readFile(summary.reportPath, 'utf8'));
  assert.ok(!('baselinePrompt' in report));
  assert.ok(!('prompt' in report));
  const before = await readFile(join(installed, 'SKILL.md'), 'utf8');
  await assert.rejects(installSkill(installed, installed), /already exists/);
  assert.equal(await readFile(join(installed, 'SKILL.md'), 'utf8'), before);
  process.stdout.write('Standalone skill verified from a separate directory without node_modules; existing installs preserved.\n');
} finally {
  const child = relative(temporaryParent, resolve(work));
  if (!child || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`) || !child.startsWith('diffatlas-skill-smoke-')) {
    throw new Error('Refusing cleanup outside the known temporary verification directory.');
  }
  await rm(work, { recursive: true, force: true });
}
