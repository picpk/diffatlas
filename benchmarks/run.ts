import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { packContext, countTextTokens } from '../src/context/engine';
import type { TokenEncoding } from '../src/context/types';
import { benchmarkCases } from './cases';

const budgets = [128, 256, 512, 1024, 2048] as const;

export function runBenchmark(encoding: TokenEncoding = 'o200k_base') {
  const runs = benchmarkCases.flatMap(testCase => budgets.map(budget => {
    try {
      const result = packContext({ ...testCase, budget, encoding });
      const actualPromptTokens = countTextTokens(result.prompt, encoding);
      const actualBaselineTokens = countTextTokens(result.baselinePrompt, encoding);
      const tokenCountMatches = actualPromptTokens === result.packedTokens && actualBaselineTokens === result.originalTokens;
      const budgetSatisfied = !result.budgetExceeded && actualPromptTokens <= budget && tokenCountMatches;
      const evidence = testCase.requiredEvidence.map(item => ({
        ...item,
        retained: budgetSatisfied && result.chunks.some(chunk => chunk.path === item.path && chunk.content.includes(item.includes)),
      }));
      return {
        id: testCase.id, title: testCase.title, budget, encoding,
        originalTokens: result.originalTokens,
        packedTokens: result.packedTokens,
        actualPromptTokens,
        actualBaselineTokens,
        savedTokens: budgetSatisfied ? result.savedTokens : null,
        savingsPercent: budgetSatisfied ? result.savingsPercent : null,
        budgetExceeded: result.budgetExceeded,
        budgetSatisfied,
        tokenCountMatches,
        minimumRequiredTokens: result.minimumRequiredTokens,
        retainedEvidence: evidence.filter(item => item.retained).length,
        totalEvidence: evidence.length,
        evidence,
        filesSelected: result.stats.filesSelected,
        unitsSelected: result.stats.unitsSelected,
        warnings: result.warnings,
        error: null as string | null,
      };
    } catch (error) {
      return {
        id: testCase.id, title: testCase.title, budget, encoding,
        originalTokens: null, packedTokens: null, actualPromptTokens: null, actualBaselineTokens: null,
        savedTokens: null, savingsPercent: null,
        budgetExceeded: null, budgetSatisfied: false, tokenCountMatches: false,
        minimumRequiredTokens: null,
        retainedEvidence: 0, totalEvidence: testCase.requiredEvidence.length,
        evidence: testCase.requiredEvidence.map(item => ({ ...item, retained: false })),
        filesSelected: 0, unitsSelected: 0, warnings: [] as string[],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  const byBudget = budgets.map(budget => {
    const group = runs.filter(run => run.budget === budget);
    const successful = group.filter(run => run.budgetSatisfied);
    const baselineTokens = successful.reduce((sum, run) => sum + (run.originalTokens ?? 0), 0);
    const packedTokens = successful.reduce((sum, run) => sum + (run.packedTokens ?? 0), 0);
    return {
      budget, runs: group.length, successfulRuns: successful.length,
      budgetExceededRuns: group.filter(run => run.budgetExceeded).length,
      errorRuns: group.filter(run => run.error).length,
      tokenAccountingFailures: group.filter(run => !run.error && !run.tokenCountMatches).length,
      retainedEvidence: group.reduce((sum, run) => sum + run.retainedEvidence, 0),
      totalEvidence: group.reduce((sum, run) => sum + run.totalEvidence, 0),
      fullEvidenceRuns: group.filter(run => run.budgetSatisfied && run.retainedEvidence === run.totalEvidence).length,
      // Savings only describe runs that yielded a prompt. Failed runs remain in all quality denominators.
      successfulBaselineTokens: baselineTokens,
      successfulPackedTokens: packedTokens,
      successfulWeightedSavingsPercent: baselineTokens ? 100 * (baselineTokens - packedTokens) / baselineTokens : null,
    };
  });
  return {
    schemaVersion: 1,
    benchmark: 'DiffAtlas authored synthetic context-selection fixtures',
    disclaimer: 'Measures prompt size and annotated evidence retention only. No model calls, task solving, accuracy, latency, billing, or model-quality improvement are measured. Fixtures and selection heuristics are maintained in the same repository; this is not independent validation.',
    encoding,
    budgets,
    overall: {
      cases: benchmarkCases.length, runs: runs.length,
      successfulRuns: runs.filter(run => run.budgetSatisfied).length,
      budgetExceededRuns: runs.filter(run => run.budgetExceeded).length,
      errorRuns: runs.filter(run => run.error).length,
      retainedEvidence: runs.reduce((sum, run) => sum + run.retainedEvidence, 0),
      totalEvidence: runs.reduce((sum, run) => sum + run.totalEvidence, 0),
      fullEvidenceRuns: runs.filter(run => run.budgetSatisfied && run.retainedEvidence === run.totalEvidence).length,
    },
    byBudget,
    runs,
  };
}

function toMarkdown(report: ReturnType<typeof runBenchmark>): string {
  const lines = [
    '# DiffAtlas synthetic context benchmark', '', report.disclaimer, '',
    `Encoding: \`${report.encoding}\`. Cases: ${report.overall.cases}. Runs: ${report.overall.runs}.`, '',
    '| Budget | Successful runs | Budget exceeded | Errors | Evidence retained | Complete evidence | Weighted saving on successful runs |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.byBudget.map(row => `| ${row.budget} | ${row.successfulRuns}/${row.runs} | ${row.budgetExceededRuns} | ${row.errorRuns} | ${row.retainedEvidence}/${row.totalEvidence} | ${row.fullEvidenceRuns}/${row.runs} | ${row.successfulWeightedSavingsPercent === null ? 'n/a' : row.successfulWeightedSavingsPercent.toFixed(1) + '%'} |`),
    '',
    '| Case | Budget | Baseline tokens | Packed tokens | Savings | Evidence retained | Status |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.runs.map(row => `| ${row.id} | ${row.budget} | ${row.originalTokens ?? 'n/a'} | ${row.packedTokens ?? 'n/a'} | ${row.savingsPercent === null ? 'n/a' : row.savingsPercent.toFixed(1) + '%'} | ${row.retainedEvidence}/${row.totalEvidence} | ${row.error ? 'error' : row.budgetExceeded ? 'budget exceeded' : row.budgetSatisfied ? 'within budget' : 'accounting failure'} |`),
    '',
    'A run with no deliverable prompt receives zero retained evidence and no savings claim. Complete evidence means every annotated substring is present in a selected chunk with the required path; it does not mean the task was solved.',
    '',
  ];
  for (const run of report.runs) {
    const missing = run.evidence.filter(item => !item.retained);
    if (!run.error && !run.budgetExceeded && missing.length === 0 && run.warnings.length === 0) continue;
    lines.push(`## ${run.id}, budget ${run.budget}`, '');
    if (run.error) lines.push(`Error: ${JSON.stringify(run.error)}`, '');
    if (run.budgetExceeded) lines.push(`Minimum required tokens: ${run.minimumRequiredTokens}. No prompt returned.`, '');
    if (missing.length) lines.push('Missing annotated evidence:', '', ...missing.map(item => `- ${JSON.stringify(item.path)}: ${JSON.stringify(item.includes)}`), '');
    if (run.warnings.length) lines.push('Warnings:', '', ...run.warnings.map(warning => `- ${warning}`), '');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    output: { type: 'string' },
    format: { type: 'string', default: 'json' },
    encoding: { type: 'string', default: 'o200k_base' },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    process.stdout.write('Usage: npm run benchmark -- [--format json|markdown] [--output path] [--encoding o200k_base|cl100k_base]\nRuns 8 synthetic cases at budgets 128, 256, 512, 1024, and 2048. No model or network request.\n');
    return;
  }
  if (values.format !== 'json' && values.format !== 'markdown') throw new Error('--format must be json or markdown');
  if (values.encoding !== 'o200k_base' && values.encoding !== 'cl100k_base') throw new Error('--encoding must be o200k_base or cl100k_base');
  const report = runBenchmark(values.encoding);
  const output = values.format === 'markdown' ? toMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`;
  if (values.output) await writeFile(values.output, output, 'utf8');
  else process.stdout.write(output);
  if (report.runs.some(run => run.error || !run.tokenCountMatches || (!run.budgetExceeded && !run.budgetSatisfied))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
