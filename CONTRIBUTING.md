# Contributing to DiffAtlas

Small, focused contributions are welcome: a reproducible context-selection bug, a token accounting error, a missing dependency, an accessibility improvement, or documentation that helps someone get started. The earlier diff-review tools also remain supported.

## Run the project

Use Node.js 22.12+:

```bash
npm ci
npm run dev
```

Context packing requires no API credentials. For optional AI review integration work, copy `.env.example` to `.env` and use your own key. Never include credentials or private repository source in commits, issues, test fixtures, or screenshots.

Before opening a pull request:

```bash
npm run check
```

This runs TypeScript checks, tests, and the production build. For context selection or CLI changes, also run:

```bash
node dist-server/context-cli.js --repo src/core --task "Explain parseDiff line coordinate validation" --budget 2500 --format json
npm run --silent benchmark -- --output benchmark-results.json
```

For the Agent interface, skill, or packaging changes, run `npm run verify:skill`. It builds and installs the standalone runtime into a temporary directory, invokes it without checkout dependencies, and checks that an existing installation is preserved. Validate `skills/diffatlas-context/SKILL.md` with your skill host's validator when available.

For the legacy review CLI:

```bash
node dist-server/cli.js --demo --file examples/sample.diff --format json
```

## Propose a change

1. Check existing issues and open a short discussion in an issue for substantial behavior changes.
2. Create a branch in your fork and keep the change focused on one problem.
3. Include a regression test when fixing behavior such as context selection, token accounting, diff parsing, evidence validation, authentication, or report formatting. Use small synthetic source or diff fixtures.
4. Describe the problem, resulting behavior, and checks you ran in the pull request. Add a screenshot for visible UI changes.

Do not include unrelated formatting or generated build output. Keep the lockfile updated when changing dependencies. Contributions are licensed under the project's MIT license.

## Review principles

- Compare token counts with the same eligible inputs and renderer. Report missing evidence alongside savings; fewer tokens alone do not prove better model answers.
- Preserve complete code units and make required-content budget failures explicit.
- Findings should identify a concrete risk and point to evidence that exists in the supplied diff.
- Keep rule-based demo results clearly distinguished from model-generated reviews.
- Treat patches and model output as untrusted data; neither should be executed or inserted as raw HTML.
- Preserve local use without an API key.
- Keep API keys on the server. Any new public endpoint that spends API credits must retain authentication and resource limits.
- Use synthetic examples with clear labels. Do not claim user adoption, benchmark results, or program support without verifiable evidence.

Report vulnerabilities privately using [SECURITY.md](SECURITY.md). For ordinary bugs, include the steps to reproduce, runtime version, and a redacted example diff.
