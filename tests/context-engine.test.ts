import { describe, expect, it } from 'vitest';
import { countTokens as o200kTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { countTokens as cl100kTokens } from 'gpt-tokenizer/encoding/cl100k_base';
import { countTextTokens, packContext } from '../src/context/engine';
import { fileExclusionReason } from '../src/context/policy';
import type { PackInput } from '../src/context/types';

const noise = `export const fixtureRecords = ${JSON.stringify(Array.from({ length: 180 }, (_, i) => ({ id: i, color: `violet${i}`, offset: i * 53 })))};\n`;
const base: PackInput = { task: 'Inspect verifyResetToken expiry validation', budget: 400, files: [
  { path: 'src/auth.ts', content: 'const maxAge = 900;\n\n/** Check reset expiry without executing code. */\nexport function verifyResetToken(age: number) {\n  return age <= maxAge;\n}\n\n' + noise },
  { path: 'docs/colors.md', content: 'Palette descriptions.\n' + 'Violet backgrounds and amber foregrounds.\n'.repeat(100) },
] };

describe('context token accounting and atomic selection', () => {
  it('uses actual BPE including Chinese and special-token-looking strings', () => {
    const text = '修复密码重置时的过期检查 <|endoftext|> <|im_start|> 🎨';
    const options = { disallowedSpecial: new Set<string>() };
    expect(countTextTokens(text)).toBe(o200kTokens(text, options));
    expect(countTextTokens(text, 'cl100k_base')).toBe(cl100kTokens(text, options));
    expect(countTextTokens(text)).not.toBe(Math.ceil(text.length / 4));
  });

  it('selects relevant complete functions, comments and same-file declaration support', () => {
    const result = packContext(base);
    expect(result.budgetExceeded).toBe(false);
    expect(result.prompt).toContain('/** Check reset expiry without executing code. */');
    expect(result.prompt).toContain('export function verifyResetToken(age: number) {\n  return age <= maxAge;\n}');
    expect(result.prompt).toContain('const maxAge = 900;');
    expect(result.prompt).not.toContain('fixtureRecords');
    expect(result.chunks.find(chunk => chunk.symbols.includes('maxAge'))?.reasons.join()).toContain('Support');
    expect(result.originalTokens).toBe(countTextTokens(result.baselinePrompt));
    expect(result.packedTokens).toBe(countTextTokens(result.prompt));
    expect(result.savedTokens).toBe(result.originalTokens - result.packedTokens);
    expect(result.omitted.some(file => file.reason.includes('Lines'))).toBe(true);
  });

  it('never exceeds the actual rendered budget across tight budgets and both encodings', () => {
    for (const encoding of ['o200k_base', 'cl100k_base'] as const) {
      for (const budget of [1, 40, 80, 130, 200, 350, 600]) {
        const result = packContext({ ...base, budget, encoding });
        expect(result.packedTokens).toBe(countTextTokens(result.prompt, encoding));
        expect(result.packedTokens).toBeLessThanOrEqual(budget);
        if (result.budgetExceeded) {
          expect(result.prompt).toBe('');
          expect(result.minimumRequiredTokens).toBeGreaterThan(budget);
          expect(result.savedTokens).toBe(0);
          expect(result.savingsPercent).toBe(0);
        }
      }
    }
  });

  it('keeps all accepted content when the complete prompt fits and uses the same renderer', () => {
    const result = packContext({ ...base, budget: 100_000 });
    expect(result.prompt).toBe(result.baselinePrompt);
    expect(result.savedTokens).toBe(0);
    expect(result.chunks.length).toBe(result.stats.unitsTotal);
    expect(result.baselinePrompt).toContain(base.files[0].content.trimEnd());
    expect(result.baselinePrompt).toContain(base.files[1].content.trimEnd());
  });

  it('does not mistake template literal braces or comments for function boundaries', () => {
    const code = '/** A } in a comment. */\nexport function renderInvoice(value: string) {\n  const message = `item: ${value}, literal { }`;\n  return message.replace(/}/g, "!");\n}\n';
    const result = packContext({ task: 'renderInvoice', budget: 250, files: [{ path: 'view.ts', content: code + noise }] });
    expect(result.prompt).toContain(code.trimEnd());
    expect(result.prompt).not.toContain('fixtureRecords');
    expect(result.chunks.find(chunk => chunk.symbols.includes('renderInvoice'))?.content).toBe(code.trimEnd());
  });

  it('keeps unknown languages and invalid TS as whole files, never a partial function', () => {
    const python = 'def password_reset(token):\n    return token is not None\n';
    const malformed = 'export function incomplete() { return "x";\n';
    const result = packContext({ task: 'password reset', budget: 500, files: [
      { path: 'auth.py', content: python }, { path: 'bad.ts', content: malformed },
    ] });
    expect(result.chunks.map(chunk => chunk.kind)).toEqual(['file', 'file']);
    expect(result.chunks.map(chunk => chunk.content)).toEqual([python, malformed]);
    expect(result.warnings.some(item => item.includes('unsupported language'))).toBe(true);
    expect(result.warnings.some(item => item.includes('syntax could not be parsed'))).toBe(true);
  });

  it('fails explicitly if task or a whole pinned function cannot fit', () => {
    const onlyTask = packContext({ task: 'Inspect reset token '.repeat(30), budget: 10, files: [] });
    expect(onlyTask.budgetExceeded).toBe(true);
    expect(onlyTask.prompt).toBe('');
    const pinned = packContext({ ...base, budget: 100, pinnedPaths: ['src/auth.ts'] });
    expect(pinned.budgetExceeded).toBe(true);
    expect(pinned.prompt).toBe('');
    expect(pinned.minimumRequiredTokens).toBeGreaterThan(100);
    expect(pinned.warnings.join()).toContain('No usable prompt was produced');
  });

  it('requires every unit of pinned files even without a task term match', () => {
    const result = packContext({ ...base, budget: 100_000, pinnedPaths: ['docs/colors.md'] });
    expect(result.chunks.filter(chunk => chunk.path === 'docs/colors.md').every(chunk => chunk.required)).toBe(true);
  });

  it('is deterministic across file input ordering', () => {
    expect(packContext({ ...base, files: [...base.files].reverse() })).toEqual(packContext(base));
  });

  it('segments Chinese task and comments to select useful code', () => {
    const result = packContext({ task: '检查密码重置', budget: 240, files: [{ path: 'auth.ts', content: '// 密码重置，验证有效期\nexport function validate(value: number) { return value > 0; }\n' + noise }] });
    expect(result.prompt).toContain('export function validate');
    expect(result.prompt).not.toContain('fixtureRecords');
  });

  it('warns when an explicitly named target is omitted while other relevant code fits', () => {
    const target = `const resetLimits = ${JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i, age: i * 99 })))};\nexport function verifyResetToken() { return resetLimits; }`;
    const files = [{ path: 'auth.ts', content: target + '\nexport const resetStatus = true;' }];
    const task = 'Review verifyResetToken reset behavior';
    const result = packContext({ task, budget: 200, files });
    expect(result.budgetExceeded).toBe(false);
    expect(result.prompt).toContain('export const resetStatus');
    expect(result.prompt).not.toContain('export function verifyResetToken');
    const groupOnly = packContext({ task, budget: 100_000, files: [{ path: 'auth.ts', content: target }] });
    const warning = result.warnings.find(item => item.startsWith('Explicit task target omitted:'));
    expect(warning).toContain('verifyResetToken at auth.ts:2–2');
    expect(warning).toContain(`needs ${groupOnly.packedTokens} o200k_base tokens`);
    expect(warning).toContain('Pin "auth.ts" or increase the budget');
    expect(packContext({ task: 'Review verifyResetTokenExtra reset behavior', budget: 200, files }).warnings.some(item => item.startsWith('Explicit task target omitted:'))).toBe(false);
    expect(packContext({ task, budget: 1, files }).warnings.some(item => item.startsWith('Explicit task target omitted:'))).toBe(false);
  });
});

describe('context dependency groups', () => {
  const files = [
    { path: 'src/reset.ts', content: 'import { checkExpiry as verify } from "./time.js";\nimport type { Account } from "./types";\nexport function resetPassword(age: number) { return verify(age); }\n' + noise },
    { path: 'src/time.ts', content: 'const lifetime = 900;\nexport function checkExpiry(age: number) { return age < lifetime; }\n' + noise },
    { path: 'src/types.ts', content: 'export interface Account { name: string }\n' + noise },
  ];
  it('includes imports, a one-hop named imported definition and its local support', () => {
    const result = packContext({ task: 'resetPassword', budget: 350, files });
    expect(result.prompt).toContain('import { checkExpiry as verify } from "./time.js";');
    expect(result.prompt).toContain('import type { Account } from "./types";');
    expect(result.prompt).toContain('export function checkExpiry(age: number) { return age < lifetime; }');
    expect(result.prompt).toContain('const lifetime = 900;');
    expect(result.prompt).not.toContain('export interface Account');
    expect(result.prompt).not.toContain('fixtureRecords');
  });

  it('does not include a function if its entire support group cannot fit', () => {
    const enough = packContext({ task: 'resetPassword', budget: 350, files });
    const result = packContext({ task: 'resetPassword', budget: enough.packedTokens - 1, files });
    expect(result.prompt).not.toContain('export function resetPassword');
    expect(result.packedTokens).toBeLessThanOrEqual(result.budget);
  });

  it('resolves a default imported function and same-file dependency cycles', () => {
    const result = packContext({ task: 'runLogin', budget: 400, files: [
      { path: 'main.ts', content: 'import authenticate from "./auth";\nexport function runLogin() { return authenticate(); }\n' + noise },
      { path: 'auth.ts', content: 'function first() { return second(); }\nfunction second() { return first(); }\nexport default function authenticate() { return first(); }\n' + noise },
    ] });
    expect(result.prompt).toContain('export default function authenticate()');
    expect(result.prompt).toContain('function first()');
    expect(result.prompt).toContain('function second()');
    expect(new Set(result.chunks.map(chunk => chunk.id)).size).toBe(result.chunks.length);
  });

  it('reports unresolved imports and the one-hop boundary without promising completeness', () => {
    const result = packContext({ task: 'runLogin', budget: 500, files: [
      { path: 'main.ts', content: 'import { authenticate } from "./auth";\nexport function runLogin() { return authenticate(); }\n' + noise },
      { path: 'auth.ts', content: 'import { check } from "./limits";\nimport { log } from "logger-package";\nimport { unknown } from "./absent";\nexport function authenticate() { log(unknown); return check(); }\n' + noise },
      { path: 'limits.ts', content: 'export function check() { return true; }\n' + noise },
    ] });
    expect(result.prompt).toContain('function runLogin');
    expect(result.prompt).toContain('function authenticate');
    expect(result.prompt).not.toContain('function check');
    expect(result.warnings.join()).toContain('further import hops are not guaranteed');
    expect(result.warnings.join()).toContain('external package or configured path alias');
    expect(result.warnings.join()).toContain('cannot be resolved among the accepted');
  });
});

describe('verified diff anchors', () => {
  const content = 'export function checked(age: number) {\n  return age < 900;\n}\n' + noise;
  const diff = 'diff --git a/auth.ts b/auth.ts\n--- a/auth.ts\n+++ b/auth.ts\n@@ -1,3 +1,3 @@\n export function checked(age: number) {\n-  return true;\n+  return age < 900;\n }\n';
  it('retains the entire diff and requires verified changed source units', () => {
    const result = packContext({ task: 'Review this change', budget: 400, files: [{ path: 'auth.ts', content }], diff });
    expect(result.prompt).toContain(diff);
    const changed = result.chunks.find(chunk => chunk.symbols.includes('checked'));
    expect(changed?.required).toBe(true);
    expect(changed?.reasons).toContain('Contains a verified added diff line.');
    expect(result.prompt).not.toContain('fixtureRecords');
    const short = packContext({ task: 'Review this change', budget: result.minimumRequiredTokens - 1, files: [{ path: 'auth.ts', content }], diff });
    expect(short.budgetExceeded).toBe(true);
    expect(short.prompt).toBe('');
  });

  it('warns on stale added lines instead of claiming a match', () => {
    const stale = diff.replace('+  return age < 900;', '+  return age < 600;');
    const result = packContext({ task: 'Review this change', budget: 400, files: [{ path: 'auth.ts', content }], diff: stale });
    expect(result.prompt).toContain(stale);
    expect(result.chunks.some(chunk => chunk.required)).toBe(false);
    expect(result.warnings.join()).toContain('does not match current source');
  });

  it('retains invalid diffs verbatim and warns without matching units', () => {
    const result = packContext({ task: 'Review this change', budget: 400, files: [{ path: 'auth.ts', content }], diff: 'invalid diff ~~~' });
    expect(result.prompt).toContain('invalid diff ~~~');
    expect(result.warnings.join()).toContain('Diff could not be parsed');
    expect(result.chunks.some(chunk => chunk.required)).toBe(false);
  });

  it('does not pin a following statement because its leading newline shares the changed line', () => {
    const current = 'export const changed = 2;\n' + noise;
    const change = '--- a/auth.ts\n+++ b/auth.ts\n@@ -1 +1 @@\n-export const changed = 1;\n+export const changed = 2;\n';
    const result = packContext({ task: 'Review this change', budget: 300, files: [{ path: 'auth.ts', content: current }], diff: change });
    expect(result.budgetExceeded).toBe(false);
    expect(result.prompt).toContain('export const changed = 2;');
    expect(result.prompt).not.toContain('fixtureRecords');
    expect(result.chunks.filter(chunk => chunk.required)).toHaveLength(1);
  });
});

describe('context input and exclusion boundaries', () => {
  it.each(['../secrets.ts', '/etc/passwd', 'C:\\file.ts', 'a/../b.ts', 'a\0b.ts', '//server/share', 'a\nb.ts'])('rejects unsafe path %s', path => {
    expect(() => packContext({ task: 'inspect', budget: 100, files: [{ path, content: 'text' }] })).toThrow(/path/i);
  });
  it('normalizes separators and rejects duplicate normalized paths', () => {
    expect(() => packContext({ task: 'inspect', budget: 100, files: [{ path: 'a\\b.ts', content: '' }, { path: 'a/b.ts', content: '' }] })).toThrow(/Duplicate/);
  });
  it('excludes filenames from BOTH prompts so exclusions are not reported as savings', () => {
    const files = [{ path: 'main.ts', content: 'export const value = 1;' }, ...['.env', 'private.pem', 'config/credentials.json', 'secrets/token.txt', 'node_modules/a.ts', '.git/config', 'package-lock.json'].map(path => ({ path, content: 'SECRET_SENTINEL' }))];
    const result = packContext({ task: 'value', budget: 400, files });
    expect(result.originalTokens).toBe(result.packedTokens);
    expect(result.savedTokens).toBe(0);
    expect(result.baselinePrompt).not.toContain('SECRET_SENTINEL');
    expect(result.omitted.length).toBe(7);
    expect(result.stats.filesTotal).toBe(1);
    expect(result.warnings.join()).toContain('do not detect secrets embedded');
    expect(fileExclusionReason('src/auth.ts')).toBeNull();
  });
  it('rejects missing or excluded pinned files', () => {
    expect(() => packContext({ ...base, pinnedPaths: ['absent.ts'] })).toThrow(/Pinned path/);
    expect(() => packContext({ task: 'inspect', budget: 100, files: [{ path: '.env', content: '' }], pinnedPaths: ['.env'] })).toThrow(/Pinned path/);
  });
  it('enforces task, file, total-byte and file-count limits', () => {
    expect(() => packContext({ ...base, task: 'x'.repeat(8001) })).toThrow(/8000/);
    expect(() => packContext({ ...base, files: [{ path: 'large.ts', content: '中'.repeat(35_000) }] })).toThrow(/100 KiB/);
    expect(() => packContext({ ...base, files: Array.from({ length: 11 }, (_, index) => ({ path: `${index}.txt`, content: 'x'.repeat(100_000) })) })).toThrow(/1 MiB/);
    expect(() => packContext({ ...base, files: Array.from({ length: 101 }, (_, index) => ({ path: `${index}.txt`, content: '' })) })).toThrow(/100 files/);
    expect(() => packContext({ ...base, budget: 1.5 })).toThrow(/budget/);
    expect(() => packContext({ ...base, diff: 'x'.repeat(102401) })).toThrow(/Diff/);
    const manyDeclarations = Array.from({ length: 501 }, (_, index) => `const value${index} = ${index};`).join('\n');
    expect(() => packContext({ ...base, files: [{ path: 'one.ts', content: manyDeclarations }, { path: 'two.ts', content: manyDeclarations }] })).toThrow(/1000 context units/);
  });
});
