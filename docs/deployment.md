# Deployment guide / 部署指南

DiffAtlas Context runs in the browser or CLI without a model backend. A static deployment provides the working context packer, token counting, and exports. The existing diff-review API is optional and needs a Node.js service only when you use that workflow.

## Local development and CLI

```bash
npm ci
npm run dev
```

Open the Vite URL. Packing does not require `.env`. Without starting a server:

```bash
npm run pack -- --repo src/context --task "Review countTextTokens encoding validation" --budget 4000 --format prompt --output context.md
```

The CLI reads locally; the browser processes selected files. Neither packing mode calls a model.

## GitHub Pages

1. Select **Settings → Pages → Build and deployment → GitHub Actions**.
2. Push to `main` or run the included Pages workflow manually.
3. Wait for the deployment job and open its reported URL.

The workflow reads the site base path from `actions/configure-pages`, builds with `npm run build:web`, and publishes `dist/`. The project URL is [https://picpk.github.io/diffatlas/](https://picpk.github.io/diffatlas/).

Static hosting supports the full context workflow. Pages cannot run the legacy Express review API. An API key in a build variable does not create a backend and can expose the key.

For another static host, publish `dist/` after `npm run build:web`. Set `BASE_PATH` at build time for a subpath. Keep all generated assets together so the tokenizer and application can load.

## Production Node.js service

```bash
npm run check
npm start
```

`check` includes tests, type checks, and a production build. The service serves `dist/` and the existing API at `http://127.0.0.1:8787`. Use `npm run build` for subsequent builds without the full checks.

## Docker

```bash
docker build -t diffatlas:local .
docker run --rm -p 127.0.0.1:8787:8787 diffatlas:local
```

This serves the context app without model credentials. The image runs as a non-root user; `.env` is excluded from the build context. To enable the optional legacy AI review API with runtime credentials:

```bash
docker run --rm --env-file .env -e HOST=0.0.0.0 -e PORT=8787 -p 127.0.0.1:8787:8787 diffatlas:local
```

The explicit host override exposes the service inside the container while the published port remains local to the host. Use your host's HTTPS reverse proxy for public access.

## Optional legacy review configuration

Context packing does not require these credentials.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Unset | Server-side OpenAI key for diff reviews |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Model used by the review integration |
| `REVIEW_ACCESS_TOKEN` | Unset | Shared bearer token required by the AI HTTP endpoint |
| `HOST` | `127.0.0.1` | Server address; use `0.0.0.0` in containers |
| `PORT` | `8787` | Server port |
| `BASE_PATH` | `/` | Public build-time asset path |

Copy `.env.example` to `.env` only if needed. Never put secrets in `VITE_*` variables, which become browser assets. Changes to server configuration require a restart.

The existing review CLI does not need the HTTP access token:

```bash
npm run review -- --demo --file examples/sample.diff --format markdown --output review.md
# Set OPENAI_API_KEY and omit --demo to call OpenAI.
```

After a production build, the bundled review CLI is available:

```bash
node --env-file-if-exists=.env dist-server/cli.js --demo --file examples/sample.diff --format json
```

The included Render Blueprint remains an optional Docker service. Inspect Render's current plan and pricing before creating it. `/api/status` verifies the process, not model access. Add credentials only through the host's private environment settings.

## Verify deployment

- Load the app, select files, provide a task and budget, and generate context.
- Inspect and download the prompt; check the budget and selected encoding.
- Try a budget below required content and verify the failure is shown without a truncated success prompt.
- If using the legacy API, test `/api/status` and review authentication separately.

Exports contain user source. Filename filtering does not detect every inline secret. See [SECURITY.md](../SECURITY.md) for vulnerability reporting.
