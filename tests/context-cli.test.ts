import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRepository, readBoundedFile } from '../src/context/repository';
import { countTextTokens } from '../src/context/engine';

let repo: string;
const cli = resolve('context-cli.ts');
beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'diffatlas-context-test-'));
  execFileSync('git', ['init', '--quiet', repo]);
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src/auth.ts'), 'export function verifyResetToken(expiresAt: number, now: number) { return now < expiresAt; }\n');
  await writeFile(join(repo, 'tracked-ignored.ts'), 'const trackedButNowIgnored = true;');
  execFileSync('git', ['-C', repo, 'add', '--', 'tracked-ignored.ts']);
  await writeFile(join(repo, '.gitignore'), 'ignored.ts\ntracked-ignored.ts\n');
  await writeFile(join(repo, 'ignored.ts'), 'const doNotRead = true;');
  await writeFile(join(repo, '.env'), 'OPENAI_API_KEY=synthetic-test-only');
  await writeFile(join(repo, 'image.png'), Buffer.from([0, 1, 2]));
});
afterAll(async () => { if (repo) await rm(repo, { recursive: true, force: true }); });

describe('repository context CLI', () => {
  it('respects gitignore, excludes credential filenames and supports scoped subdirectories', async () => {
    const result = await loadRepository(repo);
    expect(result.files.map(file => file.path)).toEqual(['src/auth.ts']);
    expect(result.excluded.some(file => file.path === '.env')).toBe(true);
    expect(result.excluded.some(file => file.path === 'ignored.ts')).toBe(false);
    expect(result.excluded.find(file => file.path === 'tracked-ignored.ts')?.reason).toContain('Git ignore rules');
    const scoped = await loadRepository(join(repo, 'src'));
    expect(scoped.files[0].path).toBe('auth.ts');
  });
  it('never reads a symlink as source when symlink creation is supported', async () => {
    const link = join(repo, 'linked.ts');
    try { await symlink(join(repo, 'src/auth.ts'), link); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error; }
    const result = await loadRepository(repo);
    expect(result.files.some(file => file.path === 'linked.ts')).toBe(false);
    expect(result.excluded.find(file => file.path === 'linked.ts')?.reason).toContain('Symlinks');
  });
  it('exports exactly the counted prompt, keeping diagnostics out of stdout', () => {
    const args = ['--import', 'tsx', cli, '--repo', repo, '--task', 'Explain verifyResetToken', '--budget', '1000'];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('verifyResetToken');
    expect(countTextTokens(result.stdout)).toBeLessThanOrEqual(1000);
    expect(result.stdout).not.toContain('DiffAtlas:');
    expect(result.stderr).toContain('tokens;');
  });
  it('does not overwrite a prior output file when the required context cannot fit', async () => {
    const output = join(repo, 'context.md');
    await writeFile(output, 'existing context');
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, '--repo', repo,
      '--task', 'Explain verifyResetToken', '--budget', '1', '--pin', 'src/auth.ts', '--output', output],
    { encoding: 'utf8', timeout: 20_000 });
    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toBe('');
    expect(await readFile(output, 'utf8')).toBe('existing context');
  });

  it('excludes an existing output addressed with different casing on Windows', async () => {
    const output = join(repo, 'case-output.md');
    await writeFile(output, 'OLD_OUTPUT_MUST_NOT_BECOME_SOURCE');
    const addressed = process.platform === 'win32' ? output.toUpperCase() : output;
    const result = await loadRepository(repo, [addressed]);
    expect(result.files.some(file => file.path === 'case-output.md')).toBe(false);
    expect(result.excluded.find(file => file.path === 'case-output.md')?.reason).toContain('Output file');
    await rm(output);
  });

  it('refuses a symlink output and preserves its target', async () => {
    const output = join(repo, 'output-link.md');
    const target = join(repo, 'src/auth.ts');
    const original = await readFile(target, 'utf8');
    try { await symlink(target, output); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error; }
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, '--repo', repo,
      '--task', 'Explain verifyResetToken', '--budget', '1000', '--output', output],
    { encoding: 'utf8', timeout: 20_000 });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('not a symlink');
    expect(await readFile(target, 'utf8')).toBe(original);
  });

  it('writes a fresh counted prompt while excluding its previous output', async () => {
    const output = join(repo, 'context.md');
    await writeFile(output, 'OLD_OUTPUT_MUST_NOT_BECOME_SOURCE');
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, '--repo', repo,
      '--task', 'Explain verifyResetToken', '--budget', '1000', '--output', output],
    { encoding: 'utf8', timeout: 20_000 });
    expect(result.status, result.stderr).toBe(0);
    const written = await readFile(output, 'utf8');
    expect(written).toContain('verifyResetToken');
    expect(written).not.toContain('OLD_OUTPUT_MUST_NOT_BECOME_SOURCE');
    expect(countTextTokens(written)).toBeLessThanOrEqual(1000);
  });

  it('bounds UTF-8 file reads and rejects non-regular files and invalid UTF-8', async () => {
    const input = join(repo, 'bounded.txt');
    await writeFile(input, '中文测试');
    await expect(readBoundedFile(input, 11)).rejects.toThrow(/byte limit/);
    await expect(readBoundedFile(input, 12)).resolves.toBe('中文测试');
    await writeFile(input, Buffer.from([0xff, 0xfe]));
    await expect(readBoundedFile(input)).rejects.toThrow();
    await expect(readBoundedFile(join(repo, 'src'))).rejects.toThrow();
    await rm(input);
  });
});
