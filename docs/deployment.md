# Deployment guide / 部署指南

DiffAtlas has two deployment modes. GitHub Pages hosts the static rule-based demo. A Node.js or Docker deployment serves the UI and API together and can perform AI reviews with server-side credentials.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Unset | Server-side key for AI reviews. Without a key, use demo mode. |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Model used by AI reviews; must be available to your API account. |
| `REVIEW_ACCESS_TOKEN` | Unset | Shared bearer token required for AI HTTP requests, including local use. The web backend enables AI only when both this token and the API key are set. |
| `HOST` | `127.0.0.1` | Listener address. Use `0.0.0.0` inside a container or on a managed host. |
| `PORT` | `8787` | Backend and production UI port. |
| `BASE_PATH` | `/` | Build-time Vite asset base for a site hosted under a path, such as `/diffatlas/`. |

Never put secrets in `VITE_*` variables. Vite bundles those into public browser assets. `BASE_PATH` is a public build setting, not a secret.

## Local production service

```bash
npm ci
npm run check
npm start
```

`npm run check` includes a production build. For subsequent builds without tests, use `npm run build`. The app serves static assets from `dist/` and runs the bundled server at `dist-server/index.js`.

The default listener is local-only. Change `HOST` deliberately when deploying to a server. Terminate HTTPS at the host's reverse proxy and configure credentials in its secret environment settings.

## GitHub Pages: static demo

1. Publish the repository on GitHub with the included Pages workflow and lockfile.
2. Open **Settings → Pages → Build and deployment** and select **GitHub Actions**.
3. Push to `main`, or run **Actions → Deploy demo to GitHub Pages → Run workflow**.
4. Open the deployment URL shown by the workflow or the Pages settings page.

The workflow asks `actions/configure-pages` for the site's base path and builds with `npm run build:web`. This supports project sites hosted at `/repository-name/` as well as root sites. Enable Pages in settings before running the workflow.

For `picpk/diffatlas`, the usual project-site address is `https://picpk.github.io/diffatlas/` once Pages has been enabled and deployment succeeds. This is an expected address, not a claim that a deployment is already active.

The static app provides the rule-based demo and report exports. It cannot read `.env`, store a server key, or run Express. Do not add an API key as a GitHub Actions build variable to try to enable AI mode.

## Docker: complete app

From the repository root:

```bash
docker build -t diffatlas:local .
docker run --rm -p 127.0.0.1:8787:8787 diffatlas:local
```

This starts a local demo. For AI reviews, configure `.env` with your API key and a long random access token, then run:

```bash
docker run --rm --env-file .env -e HOST=0.0.0.0 -e PORT=8787 -p 127.0.0.1:8787:8787 diffatlas:local
```

The explicit `HOST` override matters because the example `.env` uses `127.0.0.1`, which is only the container's own loopback. This command still publishes the service only on the host's loopback. Use a reverse proxy or your hosting platform to expose it over HTTPS.

The image builds with development dependencies in a build stage, then installs only production dependencies in the runtime stage and runs as the non-root `node` user. `.env` is excluded from the Docker build context.

The image also includes the CLI and sample diff:

```bash
docker run --rm diffatlas:local node dist-server/cli.js --demo --file examples/sample.diff --format markdown
```

To run AI CLI reviews, pass your key through a private environment file. The CLI does not need `REVIEW_ACCESS_TOKEN` because it calls the provider directly.

## Render: optional hosted demo

The included `render.yaml` is a Blueprint for one Docker web service. It requests Render's `free` plan and starts in demo mode with no API key. Free-plan availability, sleeping behavior, build limits, and any future pricing changes are controlled by Render; inspect the selected plan before creating the service.

1. Connect your GitHub repository in Render and choose **New → Blueprint**.
2. Review the `diffatlas-demo` service, selected plan, and repository before applying it.
3. Wait for the build and use the service's HTTPS URL.

The Blueprint sets `HOST=0.0.0.0` and `PORT=10000`; the service checks `/api/status`. No OpenAI credential is embedded or required for this demo.

To enable live AI reviews, open the Render service's **Environment** settings and privately add `OPENAI_API_KEY` plus a long random `REVIEW_ACCESS_TOKEN`, then redeploy. Share the access token only with intended users. Keep API spending limits configured in your OpenAI account. The server's health endpoint only confirms the process is running; a successful live request is needed to verify provider access.

Do not add literal secrets to `render.yaml`. If you customize the Blueprint to prompt for credentials, Render's `sync: false` environment entries request values during setup; those values belong in Render, never in Git.

## Verification after deployment

- Load the UI and complete a demo review; export a report and inspect its content.
- Check `GET /api/status` on a full backend deployment.
- For AI mode, verify that requests without the correct access token are rejected, then submit a small non-sensitive diff with the correct token.
- Confirm that generated browser assets, public logs, and exported reports do not contain your API key or access token.

Server configuration changes require a restart or redeploy. Updating GitHub Pages affects the static demo only.
