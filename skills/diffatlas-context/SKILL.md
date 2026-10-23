---
name: diffatlas-context
description: Reduce code input tokens for a local coding agent by packing task-relevant source from a Git repository into a measured token budget. Use for repository exploration, debugging, or review when the agent would otherwise load many files; keep direct reads for small, known targets.
---

# DiffAtlas Context

Use the bundled local packer to select source before loading a large repository into the conversation. It does not call a model or upload code. Continue the user's coding task after obtaining context; packing is preparation, not the deliverable.

## Run

Requires Node.js 22.12+ and Git on PATH. Resolve `scripts/pack.mjs` relative to this `SKILL.md`; the installed bundle needs no npm install. The GitHub source directory alone is not a built skill: if the runtime is missing, use the published skill ZIP or the repository's `npm run install:skill` command. Run the installed runtime directly without reading its implementation or full repository files first. Existing file names, a narrow `rg` search, and the user's task are enough to choose a repository or subdirectory.

```sh
node "<skill-dir>/scripts/pack.mjs" --repo "<absolute-repository-or-subdirectory>" --task "Fix password reset token expiry; inspect its callers and tests" --budget 4000
```

Replace angle-bracket paths with actual absolute paths. Preserve the user's task details, including named files or symbols. Choose a useful input budget rather than treating 4000 as a universal limit. Optional flags:

- `--encoding o200k_base|cl100k_base`: defaults to `o200k_base`.
- `--diff <path>`: include an existing unified Git diff and retain matched changed source.
- `--pin <repository-relative-path>`: require a file; repeat the flag or use comma-separated paths. Paths are relative to the `--repo` directory.
- `--output-dir <directory>`: choose the parent for a fresh output subdirectory.

## Read the result

Stdout is a compact JSON summary with `schemaVersion`, `status`, artifact paths, token counts, selection counts, and alerts. It deliberately excludes source text. Check it before reading the generated context.

| Status | Exit | Action |
| --- | --- | --- |
| `ready` | 0 | Read `context.md` at `promptPath`, then continue the task. Inspect `reportPath` if coverage needs explanation. |
| `needs_attention` | 3 | Read alerts and the omission report first. Check whether a named target, required caller, or relevant test is missing before relying on the prompt. |
| `empty` | 3 | No useful source was selected; no context file is produced. Narrow the task or inspect a known target directly. |
| `budget_exceeded` | 2 | Required content cannot fit; no context file is produced. Use the reported minimum to rebudget, narrow scope, or make a focused direct read. |
| `error` | 1 | Read the error and correct the specific input or runtime problem. |

The report records selected locations, exclusions, omitted ranges, and dependency warnings without duplicating full source. Do not read a full baseline or every omitted file into context. If the relevant target is missing, make a focused search/read or rerun with that file pinned. Repack only when evidence shows a coverage gap; after one unhelpful retry, use focused file reads. A packed prompt is a starting view of the code, not proof of completeness or correctness.

## Limits that affect decisions

- JS/TS selection keeps whole top-level declarations and follows limited local dependencies. Other supported text files are selected as whole files; dynamic imports, aliases, and deeper dependency chains may need targeted reads.
- The scanner respects Git ignore rules and skips common credential filenames, generated files, and unsupported/binary files. It is not a content-level secret scanner. A selected source file can still contain secrets; use the user's normal rules before sharing artifacts externally.
- Counts apply to the rendered code prompt under the selected BPE encoding. They do not include this skill, tool messages, reports, model output, or provider overhead. A local model with another tokenizer can count differently. Report measured input reduction without claiming improved answer quality or guaranteed total-token savings.
