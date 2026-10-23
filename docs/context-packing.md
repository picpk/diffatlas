# Context packing

DiffAtlas Context prepares a coding prompt locally. Inputs are a task, source files, a token budget, a tokenizer encoding, and optional Git diff and pinned paths. Outputs include the prompt, selected chunks, omissions, warnings, and token accounting. It does not invoke a model or execute repository code.

## Selection

1. Normalize paths and reject excluded or unsupported inputs. The CLI obtains tracked and untracked files from Git while respecting ignore rules. Recognized secret filenames are excluded; inline secrets are not comprehensively detected.
2. Parse JavaScript and TypeScript into complete top-level statements. Functions, classes, interfaces, types, and variable statements stay intact. Other supported text formats are treated as whole files. Inspect warnings for parsing or input limitations.
3. Score task terms against paths, symbols, and source text. Identifier terms such as camelCase and snake_case provide signals. This is lexical retrieval, not semantic model inference.
4. Preserve required content from pinned files and statements intersecting new-side Git diff ranges. Resolve relevant same-file references and one-hop relative imports within the candidate inputs where possible.
5. Select optional complete units within the remaining budget. Render and count the entire final prompt, including the task, paths, locations, and code formatting.

The diff is a selection signal, not a substitute for current source files. Use a diff corresponding to the supplied source. Stale paths, deleted code, and unavailable dependencies may leave gaps. Pin callers, tests, and configuration when needed.

The current limit is 100 source files, 100 KiB per file, 1 MiB total source, and 1,000 context units overall. A JS/TS file with more than 1,000 top-level statements falls back to one whole-file unit and produces a warning. Tasks are limited to 8,000 characters and diff text to 100 KiB. A CLI repository scan can exclude ineligible files before these accepted-input limits. Use a relevant Git subdirectory for a larger project.

## Required content and small budgets

Pinned paths require their file contents. Diff-selected statements also receive required status. Required content is not silently truncated to force success.

When required content cannot fit, `budgetExceeded` is `true`, `prompt` is empty, and `minimumRequiredTokens` reports the minimum needed for required content. This is a failure to produce a prompt, not a 100% saving. Increase the budget or narrow the required inputs. Even a prompt that fits may lack optional evidence.

## Token accounting

The baseline and packed prompt use the same rendering method and task. The baseline includes all accepted input content; the packed prompt includes selected content. Files rejected before selection are excluded from both.

```text
savedTokens = originalTokens - packedTokens
savingsPercent = 100 × savedTokens / originalTokens
```

The denominator is the accepted candidate set, not every file in a repository. A large percentage can reflect unrelated inputs. Inspect the input set and evidence retention alongside savings.

`o200k_base` is the default; `cl100k_base` is also supported. Counts are exact for the rendered text under the chosen encoding. Local models may use other tokenizers. Provider chat wrappers, attached content, cached-token pricing, reasoning, and output are outside this calculation. Input reduction does not by itself establish lower bills or measured latency improvements.

## Inspect before use

The JSON result includes each chunk's path, line range, kind, symbols, selection reasons, and required status. Inspect omissions and warnings, export the prompt, then copy it into your AI tool.

When a recognized explicit task target is omitted, the report includes an `Explicit task target omitted:` warning. Naming a function or file in the task raises lexical relevance but does not automatically make it required. A large target or its declaration dependencies may still be skipped when they do not fit. Pin its file if it must be present; then an insufficient budget produces an explicit failure instead of an optional omission.

Complete statements are not necessarily complete programs. The packer does not promise compilable output or every transitive dependency. Dynamic imports, framework conventions, aliases, generated sources, reflection, and runtime configuration may need extra context. One-hop import expansion is deliberately finite.

Source text may contain misleading comments or instructions. Packing preserves source as data and does not establish trust in it. The packer does not run imports or repository scripts.

The included [benchmark](context-benchmark.md) checks annotated evidence retention. It does not establish that a model understands that evidence, solves a task, or outperforms another workflow.
