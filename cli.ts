#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parseDiff, MAX_DIFF_BYTES } from './src/core/diff';
import { analyzeDemo } from './src/core/demo';
import { reviewWithAI } from './src/core/review';
import { toMarkdown, toSarif } from './src/core/format';
import type { Severity } from './src/core/types';

const HELP = `DiffAtlas — evidence-checked reviews for Git diffs

Usage:
  npm run review -- --demo --file examples/sample.diff
  git diff --no-ext-diff --no-color | npm run review -- --demo
  node dist-server/cli.js --file change.diff --format sarif --output review.sarif

Options:
  --demo              Use local pattern rules; no model or network request
  --file <path>       Read a UTF-8 unified diff (otherwise read stdin)
  --format <format>   markdown (default), json, sarif
  --output <path>     Write the report to a file (otherwise stdout)
  --fail-on <level>   high, medium, low, or none (default)
  --help              Show this help

AI mode requires OPENAI_API_KEY. OPENAI_MODEL defaults to gpt-4.1-mini.
Only the supplied diff is sent to OpenAI. Max input: 100 KiB UTF-8.
Exit codes: 0 success, 1 input/provider error, 2 findings meet --fail-on.
`;

async function readBounded(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_DIFF_BYTES) throw new Error('Diff exceeds the 100 KiB limit. Review a smaller change.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: {
    demo: { type: 'boolean', default: false },
    file: { type: 'string' }, format: { type: 'string', default: 'markdown' },
    output: { type: 'string' }, 'fail-on': { type: 'string', default: 'none' },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) { process.stdout.write(HELP); return 0; }
  if (!['markdown', 'json', 'sarif'].includes(values.format!)) throw new Error('Format must be markdown, json, or sarif.');
  if (!['none', 'high', 'medium', 'low'].includes(values['fail-on']!)) throw new Error('--fail-on must be high, medium, low, or none.');
  if (!values.file && process.stdin.isTTY) throw new Error('Provide --file <path> or pipe a unified diff to stdin.');
  const diff = await readBounded(values.file ? createReadStream(values.file) : process.stdin);
  if (Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES) throw new Error('Diff exceeds the 100 KiB limit.');
  const parsed = parseDiff(diff);
  const review = values.demo ? analyzeDemo(parsed) : await reviewWithAI(diff);
  const output = values.format === 'markdown' ? toMarkdown(review) : JSON.stringify(values.format === 'sarif' ? toSarif(review) : review, null, 2) + '\n';
  if (values.output) await writeFile(values.output, output, 'utf8');
  else process.stdout.write(output);
  const rank: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
  const threshold = values['fail-on'];
  return threshold !== 'none' && review.findings.some((f) => rank[f.severity] >= rank[threshold as Severity]) ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`DiffAtlas: ${error instanceof Error ? error.message : 'Review failed.'}\n`);
    process.exitCode = 1;
  });
}
