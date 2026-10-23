import { describe, expect, it } from 'vitest';
import { toMarkdown, toSarif } from '../src/core/format';
import type { Review } from '../src/core/types';

const review: Review = {
  mode: 'demo', summary: 'One candidate risk', discardedFindings: 1,
  testPlan: ['Exercise invalid input'], findings: [{
    id: 'f1', title: '<script>Example</script>', severity: 'high', file: 'src/file #1.ts', line: 42,
    evidence: 'const s = "```";', explanation: 'User input reaches the query.', suggestion: 'Bind the parameter.',
  }],
};
describe('portable review exports', () => {
  it('preserves a valid SARIF location and risk level', () => {
    const sarif = toSarif(review) as any;
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results[0].locations[0].physicalLocation).toEqual({
      artifactLocation: { uri: 'src/file%20%231.ts', uriBaseId: '%SRCROOT%' },
      region: { startLine: 42, snippet: { text: 'const s = "```";' } },
    });
    expect(sarif.runs[0].results[0].level).toBe('error');
  });
  it('labels rules honestly and keeps code fences and HTML safe', () => {
    const markdown = toMarkdown(review);
    expect(markdown).toContain('Local rules (not AI)');
    expect(markdown).toContain('````\nconst s = "```";\n````');
    expect(markdown).not.toContain('<script>');
    expect(markdown).toContain('&lt;script&gt;');
  });
});
