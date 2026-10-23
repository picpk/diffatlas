# DiffAtlas Context

**Give your AI the code it needs, within a token budget.**

DiffAtlas v0.2 packs repository context for a coding task without calling a model. It ranks code against your task, preserves complete JavaScript/TypeScript declarations and selected dependencies, and produces a prompt within your token budget. Use it with your local AI, an editor assistant, or a hosted model.

The browser app and CLI perform real context selection locally. No API key is required. Token reduction is measured against the same task and formatting applied to all accepted input files; smaller input alone does not prove better answers.

[Browser app](https://picpk.github.io/diffatlas/) · [中文上手](docs/quickstart.zh-CN.md) · [Selection method](docs/context-packing.md) · [Benchmark](docs/context-benchmark.md) · [Deployment](docs/deployment.md)

## Why use this with a local AI?

You already have the model. DiffAtlas helps prepare its input when a repository is too large to paste in full, or when you want to inspect exactly what context you send.

- Set a task and budget; inspect selected code, omissions, and selection reasons.
- Preserve complete JS/TS top-level statements instead of cutting a function halfway through.
- Prioritize changed statements from a Git diff and pin files that must be included.
- Include relevant same-file declarations and one-hop relative imports where resolvable.
- Count the final prompt with `o200k_base` or `cl100k_base`, including task and formatting.
- Copy or export the prompt and compare it with the same-format full-input baseline.

Selection is deterministic and lexical. It does not know every dependency or which code a model will need. Inspect omissions and pin important files. The selected encoding's BPE count is not a universal token count for all local models.

## Run locally

Requires Git and **Node.js 22.12+**.

```bash
git clone https://github.com/picpk/diffatlas.git
cd diffatlas
npm ci
npm run dev
```

Open the Vite URL, select source files, describe the task, and choose a budget. Generate context, inspect it, then copy or download it for your AI tool. Packing does not need `.env` or model credentials.

## CLI workflow

From the DiffAtlas directory:

```bash
npm run pack -- --repo /path/to/your/repository --task "Check getCachedUser when a cached result is null" --budget 4000 --format prompt --output context.md
```

Open `context.md`, inspect the selected code, and paste it into your local AI. Use `--format json` for the prompt, token counts, reasons, omissions, and warnings in a machine-readable report. To try this repository:

```bash
npm run pack -- --repo src/context --task "Review countTextTokens encoding validation" --budget 4000 --format prompt --output context.md
```

Add a diff or pin files:

```bash
git diff --output=changes.diff
npm run pack -- --repo . --task "Review these changes and their callers" --diff changes.diff --pin src/context/types.ts --budget 6000 --encoding o200k_base --format json --output context-report.json
```

`--pin` can be repeated or use comma-separated paths relative to `--repo`. Pinned files and changed statements are required; if they cannot fit, the tool returns a budget failure and the required minimum, without a truncated prompt.

The CLI uses Git's tracked and untracked file listing while respecting `.gitignore`. It excludes recognized secret filenames and reports exclusions. It does **not** detect every inline secret. Inspect exported source before sharing or committing it. When piping output, use `npm run --silent pack` to suppress npm's lifecycle prefix.

The current input limit is 100 eligible files, 100 KiB per file, and 1 MiB total. For a larger repository, point `--repo` at a relevant Git subdirectory. Exit codes are `0` for a produced prompt, `1` for an input/read error, and `2` when required context exceeds the budget.

## Check the measurements

```bash
npm run benchmark -- --format markdown --output benchmark.md
npm run benchmark -- --encoding cl100k_base --output benchmark.json
npm run check
```

Eight authored synthetic repositories are evaluated at 128, 256, 512, 1,024, and 2,048 tokens. Results include token reduction, budget failures, and retention of annotated code evidence. Missing evidence and failed runs remain visible. This is a small selection regression suite; it makes no model calls and is not independent model-quality validation. See [the method and limitations](docs/context-benchmark.md).

## Existing diff review tools

The earlier review CLI and server API remain available. The rule-based mode runs locally:

```bash
npm run review -- --demo --file examples/sample.diff --format markdown --output review.md
```

For an OpenAI review, copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and omit `--demo`. The CLI supports Markdown, JSON, and SARIF; the HTTP API additionally requires `REVIEW_ACCESS_TOKEN`. Evidence validation checks a finding's reference to supplied code, not whether the finding is correct. AI review sends the provided diff to OpenAI and is separate from local context packing. See [deployment](docs/deployment.md).

## 中文简介

DiffAtlas Context 是本地代码上下文打包工具：给出任务、代码文件和 token 预算，生成可直接交给本地 AI 或其他模型的上下文。它保留完整代码单元，按任务和 Git 变更选择内容，展示所选编码的精确计数、省量及被省略的代码。

它不调用模型，也不声称让模型变聪明。价值是控制输入大小，并检查为了省 token 舍弃了什么。详见[中文上手指南](docs/quickstart.zh-CN.md)。

## Contribute

Useful contributions include reproducible selection failures, compact fixtures with justified evidence annotations, and real task comparisons that report both quality and token usage. See [CONTRIBUTING.md](CONTRIBUTING.md), [the roadmap](docs/roadmap.md), and [SECURITY.md](SECURITY.md).

DiffAtlas is independently maintained and is not endorsed by OpenAI. No support-program approval or funding is claimed.

## License

[MIT](LICENSE) © 2026 DiffAtlas contributors.
