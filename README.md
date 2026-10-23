# DiffAtlas

**AI code reviews you can trace back to the diff.**

DiffAtlas turns a Git diff into a focused review with file locations, quoted evidence, suggested fixes, and a test plan. It checks findings against the supplied diff before displaying them, so a reviewer can inspect the exact changed code behind each finding.

An open-source developer tool built with TypeScript, React, Express, and the OpenAI API. Licensed under MIT.

[中文上手指南](docs/quickstart.zh-CN.md) · [Deployment](docs/deployment.md) · [Contributing](CONTRIBUTING.md) · [Open-source program notes](docs/open-source-program.zh-CN.md)

[Try the live rule-based demo](https://picpk.github.io/diffatlas/) · [CI](https://github.com/picpk/diffatlas/actions/workflows/ci.yml)

## What it does

- Review a pasted or uploaded Git diff in a browser, or run a review from the CLI.
- Try a rule-based demo without an account, API key, or model request.
- Use the OpenAI API through a server-side integration for AI reviews.
- Check each finding's file, new line number, and exact quoted evidence against an added line in the diff; unsupported findings are discarded.
- Export Markdown from the browser; use the CLI for Markdown, JSON, or SARIF reports.
- Run locally, serve the demo on GitHub Pages, or deploy the full app with Docker.

Evidence checks establish that a finding refers to supplied code. They do not establish that the finding is correct. DiffAtlas sees the diff you provide, so unchanged code, callers, configuration, and runtime behavior may require a human review. Patches containing only deletions require manual review; the AI path returns a notice without making a model request.

## Quick start

Requires **Node.js 22.12+** and npm.

```bash
git clone https://github.com/picpk/diffatlas.git
cd diffatlas
npm ci
npm run dev
```

Open the local URL printed by Vite. The development server forwards `/api` requests to `127.0.0.1:8787`. Try the sample diff in demo mode first; no API key is needed.

For AI reviews, copy `.env.example` to `.env` and set:

```dotenv
OPENAI_API_KEY=your-own-api-key
OPENAI_MODEL=gpt-4.1-mini
REVIEW_ACCESS_TOKEN=your-own-long-random-token
```

Restart the server after changing `.env`. Enter the access token in the app when requested. API usage is billed to the key's account; a ChatGPT subscription does not itself supply API credits. Keep the key on the server and never put it in a `VITE_*` variable.

## CLI

Review the included example without a model request:

```bash
npm run review -- --demo --file examples/sample.diff --format markdown --output report.md
```

Review your own changes with the OpenAI API:

```bash
git diff --output=changes.diff
npm run review -- --file changes.diff --format json --output review.json
```

Choose `markdown`, `json`, or `sarif` with `--format`. Omit `--output` to write the report to standard output. When piping the report to another tool, use `npm run --silent review` or invoke the bundled CLI directly to avoid npm's lifecycle log prefix. Use `--fail-on high`, `medium`, or `low` to return exit code `2` when a finding meets that severity threshold; the default is `none`. Input or provider errors return `1`. The CLI runs locally and reads `OPENAI_API_KEY`; the web server's access token is for HTTP requests.

After a production build, the CLI also runs without development dependencies:

```bash
npm run build
node --env-file-if-exists=.env dist-server/cli.js --demo --file examples/sample.diff --format sarif --output review.sarif
```

## Build and deploy

```bash
npm run check
npm run build
npm start
```

The production app serves the browser UI and API together at `http://127.0.0.1:8787`. `npm run check` already runs type checks, tests, and a production build; the separate build command is useful when skipping the full check locally.

- **GitHub Pages:** the included workflow publishes a static, rule-based demo. Pages cannot run the AI backend. Select **GitHub Actions** as the Pages source in repository settings.
- **Docker:** build and run the full app with server-side environment variables.
- **Render:** `render.yaml` describes an optional demo service. Add your API credentials and access token in the host's private environment settings to enable AI reviews.

See [the deployment guide](docs/deployment.md) for exact commands, environment variables, and public-host configuration.

## Privacy and security

Demo mode makes no model request. An AI review sends the supplied diff to OpenAI through the configured server. Review the diff for secrets and private data before using AI mode. The tool does not execute your patch or apply changes to your repository.

If you expose an AI-enabled server publicly, set `REVIEW_ACCESS_TOKEN` and give it only to intended users. Hosting is under your control: deploy behind HTTPS and use your provider's request and spending controls. See [SECURITY.md](SECURITY.md) for reporting and operational details.

## 中文简介

DiffAtlas 是一个开源的 Git diff 审查工具：粘贴或上传代码变更，获得带文件位置、代码证据、修改建议和测试计划的审查结果。它会校验问题是否对应输入 diff 中的代码，但仍需要人工判断问题是否成立。

无需 API Key 即可体验规则演示；真实 AI 审查通过服务端调用 OpenAI。网页支持 Markdown 导出，CLI 支持 Markdown / JSON / SARIF。提供 GitHub Pages 静态演示和 Docker 完整部署。详细步骤见[中文上手指南](docs/quickstart.zh-CN.md)。

## Project status

This is an early project. Contributions, reproducible bug reports, and feedback from real code reviews are welcome. See the [roadmap](docs/roadmap.md) and [contribution guide](CONTRIBUTING.md).

DiffAtlas is independently maintained and is not endorsed by OpenAI. An application to an open-source support program is separate from releasing this project; no approval or funding is claimed. [Official program requirements and preparation notes](docs/open-source-program.zh-CN.md) are included for maintainers.

## License

[MIT](LICENSE) © 2026 DiffAtlas contributors.
