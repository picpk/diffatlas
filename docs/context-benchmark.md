# Context selection benchmark

This benchmark measures prompt size and retention of annotated code evidence. It makes no model calls. It does not measure answer accuracy, successful code changes, false positives, latency, monetary cost, or model-quality improvement.

## Reproduce

```bash
npm ci
npm run benchmark -- --format markdown --output benchmark.md
npm run benchmark -- --format json --output benchmark.json
npm run benchmark -- --encoding cl100k_base --output benchmark-cl100k.json
```

The default encoding is `o200k_base`. All fixtures run at budgets of 128, 256, 512, 1,024, and 2,048 tokens. Use `npm run --silent benchmark` for machine-readable stdout. The small budgets intentionally expose missing evidence and failures to fit required content.

## Fixtures

[cases.ts](../benchmarks/cases.ts) contains eight small, authored synthetic repositories, each with five or six readable files. They include relevant and plausible unrelated code. No private repository is downloaded and fixture code is not executed.

| Case | Required evidence | Additional coverage |
| --- | --- | --- |
| `reset-expiry` | Reset caller, expiry predicate, TTL, boundary test | Same-file and relative-import dependencies |
| `cached-null` | Cache hit check, null result, read-count test | A null result must not become a miss |
| `invoice-rounding` | Calculation, rounding helper, half-cent test | Small but important utility |
| `download-path` | Caller, containment check, sibling-path test | Cross-file security context |
| `abort-cleanup` | Timer cleanup, caller, cleanup test | Full function and `finally` |
| `config-schema` | Changed type, parser, consumer, invalid-string test | Diff lines and type imports |
| `renamed-slug` | Changed function, caller, punctuation test | Rename diff and current path |
| `unicode-config` | Zero retries, Chinese error, test, pinned docs | Unicode, emoji, whole Markdown file |

Required evidence is declared as `{path, includes}` pairs before selection. A pair is retained only if a selected chunk has the exact path and contains the annotated substring. The runner never searches `baselinePrompt` for retention. Annotations are not changed to match selected output.

The snippets are selection fixtures, not production implementations or security certifications. Test-like files provide realistic evidence text; this runner does not execute their tests or validate all behavior.

## Baseline and budgets

The baseline is all accepted fixture files rendered with the same task and formatting as the packed prompt. It is not a competing retrieval system. The comparison answers how much smaller this prompt is than sending this candidate set in full; it does not establish superiority to manual selection, grep, an IDE agent, or another packer.

The runner independently counts the final prompt and checks the returned `packedTokens`. A successful run has matching counts and fits its budget. Required content that cannot fit produces a budget failure with a reported minimum. At large enough budgets, a whole fixture may fit, making zero savings the correct outcome.

## Metrics

- **Prompt tokens and savings:** selected-encoding counts including task and wrappers. Failed runs have `null`/`n/a` savings, never 100%.
- **Evidence retained:** retained annotation pairs divided by all required pairs. A run without a deliverable prompt receives zero.
- **Complete-evidence runs:** runs satisfying the budget and retaining every annotation.
- **Budget failures, execution errors, accounting failures:** explicitly listed rather than dropped from quality denominators.
- **Weighted savings on successful runs:** total saved tokens divided by total baseline tokens among valid prompts only. The number of successful runs is shown beside this conditional metric.

Per-case results list missing annotations and warnings. Budget-specific summaries show the tradeoff more clearly than an aggregate across different budgets. Less context with less evidence is not an unqualified improvement.

## Recorded run: 2026-10-23

The following values were produced by the runner with `o200k_base`, using the eight fixtures in this repository. The baseline across all eight cases is 4,853 tokens; individual baselines range from 563 to 688 tokens. All baseline and final-prompt counts matched independent tokenizer calls in the runner.

| Budget per case | Prompts produced | Required-content failures | Evidence retained across all 8 cases | Cases retaining all evidence | Weighted saving among produced prompts |
| --- | --- | --- | --- | --- | --- |
| 128 | 5/8 | 3 | 3/27 | 0/8 | 79.42% |
| 256 | 8/8 | 0 | 13/27 | 0/8 | 60.00% |
| 512 | 8/8 | 0 | 27/27 | 8/8 | 23.82% |
| 1,024 | 8/8 | 0 | 27/27 | 8/8 | 0.00% |
| 2,048 | 8/8 | 0 | 27/27 | 8/8 | 0.00% |

At budget 128, the three failed cases were `config-schema` (minimum 162 tokens), `renamed-slug` (255), and `unicode-config` (145). The 79.42% figure covers only the five produced prompts, whose baseline total is 2,954 tokens; failures receive no savings claim and remain in the evidence denominator.

At 256 tokens, every case produces a prompt but none retains every annotated requirement. At 512 tokens, the combined prompts shrink from 4,853 to 3,697 tokens while retaining all 27 annotations. At larger budgets, all small fixtures fit in full. These results show why a savings percentage needs an evidence-retention metric next to it.

## Limitations

Fixtures and selection heuristics are maintained in this same repository. This is a transparent regression suite, not independent validation. Tasks mention relevant concepts and identifiers; vague tasks and undocumented projects can be harder. An annotation captures an author-selected necessary piece of evidence, not proof that all necessary dependencies were identified.

Future model evaluations need fixed unseen or independently annotated tasks, identical model settings, executable task-success checks, repeated trials where appropriate, and comparisons with full context and simple retrieval. Both task quality and input/output token usage must be reported. No such results are claimed here.
