import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { sampleDiff } from '../src/core/sample';

function run(args: string[], input = sampleDiff) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'cli.ts', ...args], {
    input, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, OPENAI_API_KEY: '' },
  });
}

describe('CLI process contract', () => {
  it('reads piped diffs and writes parseable JSON without log prefixes', () => {
    const result = run(['--demo', '--format', 'json']);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.mode).toBe('demo');
    expect(output.findings).toHaveLength(3);
  });
  it('sets the requested findings exit code while still producing a SARIF report', () => {
    const result = run(['--demo', '--format', 'sarif', '--fail-on', 'high']);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).runs[0].results).toHaveLength(3);
  });
  it('rejects oversize stdin and cannot silently fall back from AI to demo', () => {
    const oversized = run(['--demo'], 'x'.repeat(102_401));
    expect(oversized.status).toBe(1);
    expect(oversized.stderr).toContain('100 KiB');
    const live = run(['--format', 'json']);
    expect(live.status).toBe(1);
    expect(live.stdout).toBe('');
    expect(live.stderr).toContain('OPENAI_API_KEY');
  });
});
