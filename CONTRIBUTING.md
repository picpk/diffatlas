# Contributing to DiffAtlas

Thank you for helping make code reviews easier to verify. Small, focused contributions are welcome: a reproducible parser bug, a misleading demo finding, a clearer error message, an accessibility improvement, or documentation that helps someone get started.

## Run the project

Use Node.js 22.12+:

```bash
npm ci
npm run dev
```

Demo mode requires no API credentials. For AI integration work, copy `.env.example` to `.env` and use your own key. Never include credentials or private repository diffs in commits, issues, test fixtures, or screenshots.

Before opening a pull request:

```bash
npm run check
```

This runs TypeScript checks, tests, and the production build. For a CLI change, also exercise the built command with the sample diff:

```bash
node dist-server/cli.js --demo --file examples/sample.diff --format json
```

## Propose a change

1. Check existing issues and open a short discussion in an issue for substantial behavior changes.
2. Create a branch in your fork and keep the change focused on one problem.
3. Include a regression test when fixing behavior such as diff parsing, evidence validation, authentication, or report formatting. A minimized diff makes a useful fixture.
4. Describe the problem, resulting behavior, and checks you ran in the pull request. Add a screenshot for visible UI changes.

Do not include unrelated formatting or generated build output. Keep the lockfile updated when changing dependencies. Contributions are licensed under the project's MIT license.

## Review principles

- Findings should identify a concrete risk and point to evidence that exists in the supplied diff.
- Keep rule-based demo results clearly distinguished from model-generated reviews.
- Treat patches and model output as untrusted data; neither should be executed or inserted as raw HTML.
- Preserve local use without an API key.
- Keep API keys on the server. Any new public endpoint that spends API credits must retain authentication and resource limits.
- Use synthetic examples with clear labels. Do not claim user adoption, benchmark results, or program support without verifiable evidence.

Report vulnerabilities privately using [SECURITY.md](SECURITY.md). For ordinary bugs, include the steps to reproduce, runtime version, and a redacted example diff.
