import type { Review } from './types';

function prose(value: string): string {
  // Model prose and diff filenames are untrusted. Keep links, images, headings,
  // and inline HTML literal when the exported report is rendered as Markdown.
  return value.replace(/[\\`*_{}\[\]()#+\-.!|~]/g, '\\$&')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function toMarkdown(review: Review): string {
  const blocks = ['# DiffAtlas review', '', `Mode: ${review.mode === 'ai' ? 'AI review' : 'Local rules (not AI)'}`, '', prose(review.summary)];
  for (const finding of review.findings) {
    const runs = finding.evidence.match(/`+/g) ?? [];
    const fence = '`'.repeat(Math.max(3, ...runs.map((s) => s.length + 1)));
    blocks.push('', `## [${finding.severity}] ${prose(finding.title)}`, '',
      `${prose(finding.file)}:${finding.line}`, '', fence, finding.evidence, fence,
      '', prose(finding.explanation), '', `Suggestion: ${prose(finding.suggestion)}`);
  }
  blocks.push('', '## Suggested tests', '', ...review.testPlan.map((test) => `- ${prose(test)}`), '',
    `Discarded findings with invalid evidence: ${review.discardedFindings}.`,
    'Evidence checks confirm a location and quote, not the correctness or completeness of a review.', '');
  return blocks.join('\n');
}

export function toSarif(review: Review): object {
  const levels = { high: 'error', medium: 'warning', low: 'note' } as const;
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'DiffAtlas', version: '0.1.0', informationUri: 'https://github.com/picpk/diffatlas',
        rules: [{ id: 'diffatlas/review', name: 'EvidenceCheckedReview', shortDescription: { text: 'Finding on an added line in the supplied diff' } }] } },
      properties: { mode: review.mode, discardedFindings: review.discardedFindings },
      results: review.findings.map((finding) => ({
        ruleId: 'diffatlas/review',
        level: levels[finding.severity],
        message: { text: `${finding.title}\n\n${finding.explanation}\n\n${finding.suggestion}` },
        locations: [{ physicalLocation: {
          artifactLocation: { uri: finding.file.split('/').map(encodeURIComponent).join('/'), uriBaseId: '%SRCROOT%' },
          region: { startLine: finding.line, snippet: { text: finding.evidence } },
        } }],
      })),
    }],
  };
}
