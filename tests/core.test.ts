import { describe, expect, it, vi } from 'vitest';
import { analyzeDemo } from '../src/core/demo';
import { DiffParseError, MAX_DIFF_BYTES, parseDiff } from '../src/core/diff';
import { createReviewService, ReviewServiceError, validateFindings } from '../src/core/review';
import { sampleDiff } from '../src/core/sample';
import { toMarkdown } from '../src/core/format';

const multiHunk = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -2,3 +2,4 @@
 same
-old
+first
+second
 last
@@ -20 +21 @@
-before
+after
`;

describe('unified diff parser', () => {
  it('preserves line coordinates across additions, deletions, context and multiple hunks', () => {
    const parsed = parseDiff(multiHunk);
    expect(parsed.totalAdditions).toBe(3);
    expect(parsed.totalDeletions).toBe(2);
    expect(parsed.files[0].lines.map(line => [line.kind, line.oldLine, line.newLine])).toEqual([
      ['context', 2, 2], ['deletion', 3, null], ['addition', null, 3], ['addition', null, 4],
      ['context', 4, 5], ['deletion', 20, null], ['addition', null, 21],
    ]);
  });

  it('parses the real sample as three files and produces three clearly labeled local findings', () => {
    const parsed = parseDiff(sampleDiff);
    const review = analyzeDemo(parsed);
    expect(parsed.files).toHaveLength(3);
    expect(review.mode).toBe('demo');
    expect(review.findings).toHaveLength(3);
    expect(review.findings.map(finding => [finding.file, finding.line])).toEqual([
      ['src/api/users.ts', 3], ['src/ui/profile.ts', 2], ['src/config/client.ts', 2],
    ]);
    expect(review.findings.every(finding => parsed.files.some(file => file.path === finding.file &&
      file.lines.some(line => line.kind === 'addition' && line.newLine === finding.line && line.content === finding.evidence)))).toBe(true);
  });

  it('handles pure deletions and retains binary and rename metadata alongside text', () => {
    const parsed = parseDiff(`diff --git a/deleted.ts b/deleted.ts
deleted file mode 100644
--- a/deleted.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-first
-second
diff --git a/icon.png b/icon.png
Binary files a/icon.png and b/icon.png differ
diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
`);
    expect(parsed.files[0].path).toBe('deleted.ts');
    expect(parsed.files[0].lines.every(line => line.newLine === null)).toBe(true);
    expect(parsed.files[1].isBinary).toBe(true);
    expect(parsed.files[2]).toMatchObject({ path: 'new.ts', oldPath: 'old.ts' });
    expect(parsed.warnings).toHaveLength(3);
  });

  it('supports zero old lines, CRLF, a missing final newline marker and quoted paths', () => {
    const diff = 'diff --git "a/a file.ts" "b/a file.ts"\r\n--- /dev/null\r\n+++ "b/a file.ts"\r\n@@ -0,0 +1 @@\r\n+hello\r\n\\ No newline at end of file\r\n';
    expect(parseDiff(diff).files[0]).toMatchObject({ path: 'a file.ts', additions: 1, lines: [{ kind: 'addition', content: 'hello', oldLine: null, newLine: 1 }] });
  });

  it('supports ordinary unified file headers and Git octal-escaped UTF-8 paths', () => {
    expect(parseDiff('--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-a\n+b\n').files[0].path).toBe('file.ts');
    const diff = 'diff --git "a/\\344\\270\\255.ts" "b/\\344\\270\\255.ts"\n--- "a/\\344\\270\\255.ts"\n+++ "b/\\344\\270\\255.ts"\n@@ -1 +1 @@\n-a\n+b\n';
    expect(parseDiff(diff).files[0].path).toBe('中.ts');
  });

  it.each([
    '', 'not a diff', 'diff --git a/icon.png b/icon.png\nBinary files a/icon.png and b/icon.png differ\n',
    'diff --git a/a.ts b/b.ts\nrename from a.ts\nrename to b.ts\n',
    '--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1 @@\n-old\n+new\n',
    '--- a/a.ts\n+++ b/a.ts\n@@ -0 +0 @@\n-old\n+new\n',
    '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n+extra\n',
  ])('rejects invalid, truncated, or non-textual diffs', diff => {
    expect(() => parseDiff(diff)).toThrow(DiffParseError);
  });

  it('bounds UTF-8 bytes and file count', () => {
    expect(() => parseDiff('中'.repeat(MAX_DIFF_BYTES / 3 + 1))).toThrow(/100 KiB/);
    const tooManyFiles = Array.from({ length: 101 }, (_, i) => `diff --git a/${i} b/${i}\n--- a/${i}\n+++ b/${i}\n@@ -1 +1 @@\n-a\n+b\n`).join('');
    expect(() => parseDiff(tooManyFiles)).toThrow(/100 files/);
  });
});

describe('AI review boundary', () => {
  const valid = {
    title: 'Example finding', severity: 'medium' as const, file: 'file.ts', line: 3, evidence: 'first',
    explanation: 'A bounded example used to exercise citation validation.', suggestion: 'Inspect the behavior.',
  };

  it('drops invented files, line numbers, altered evidence, deletion citations, context citations and duplicates', () => {
    const checked = validateFindings([
      valid, { ...valid, file: 'invented.ts' }, { ...valid, line: 100 },
      { ...valid, evidence: ' first' }, { ...valid, line: 2, evidence: 'same' },
      { ...valid, line: 20, evidence: 'before' }, valid,
    ], parseDiff(multiHunk));
    expect(checked.findings).toEqual([{ ...valid, id: 'ai-1' }]);
    expect(checked.discardedFindings).toBe(6);
  });

  it('accepts an injected provider without any network request and reports removed citations', async () => {
    const provider = vi.fn().mockResolvedValue({ summary: 'Review complete.', findings: [valid, { ...valid, evidence: 'invented' }], testPlan: ['Run a regression test.'] });
    const result = await createReviewService(provider, 'test-model')(multiHunk);
    expect(provider).toHaveBeenCalledExactlyOnceWith({ diff: multiHunk, model: 'test-model' });
    expect(result).toMatchObject({ mode: 'ai', model: 'test-model', discardedFindings: 1 });
    expect(result.findings).toHaveLength(1);
    expect(result.summary).toContain('removed');
  });

  it('does not call the provider for a pure deletion', async () => {
    const provider = vi.fn();
    const result = await createReviewService(provider)('--- a/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed\n');
    expect(provider).not.toHaveBeenCalled();
    expect(result.findings).toEqual([]);
    expect(result.summary).toContain('No model request');
  });

  it('propagates explicit refusals and hides unknown provider error details', async () => {
    const refusal = new ReviewServiceError('The AI provider declined to review this content.', 'provider_refused', 422);
    await expect(createReviewService(async () => { throw refusal; })(multiHunk)).rejects.toMatchObject({ code: 'provider_refused', status: 422 });
    await expect(createReviewService(async () => { throw new Error('secret-api-key and private source'); })(multiHunk)).rejects.toThrow('The AI provider could not complete the review. Try again later.');
  });

  it('rejects malformed provider output', async () => {
    await expect(createReviewService(async () => ({ summary: 'bad' }))(multiHunk)).rejects.toMatchObject({ code: 'invalid_provider_response' });
  });
});

describe('untrusted report prose', () => {
  it('exports model-supplied Markdown images and links as literal text', () => {
    const report = toMarkdown({
      mode: 'ai', discardedFindings: 0, findings: [],
      summary: '![external](https://example.test/image) and [link](javascript:alert(1))',
      testPlan: ['<script>alert(1)</script>\n# injected heading'],
    });
    expect(report).not.toContain('![external]');
    expect(report).not.toContain('[link]');
    expect(report).toContain('\\!\\[external\\]\\(https://example\\.test/image\\)');
    expect(report).not.toContain('\n# injected heading');
    expect(report).not.toContain('<script>');
  });
});
