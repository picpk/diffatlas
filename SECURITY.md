# Security policy

DiffAtlas is an early project. Security fixes target the latest code on `main`; no long-term support branches are currently maintained.

## Report a vulnerability

Use GitHub's **Security → Report a vulnerability** option if private vulnerability reporting is enabled for this repository. Include the affected version or commit, impact, reproduction steps, and a small synthetic example. Do not post API keys, access tokens, private code, or exploitable production details in a public issue.

If private reporting is unavailable, open an issue asking the maintainer to enable a private reporting channel, without disclosing vulnerability details. There is no promised response-time SLA at this stage.

## Deployment responsibilities

- Keep `OPENAI_API_KEY` in the server's private environment. Never add it to frontend code, a `VITE_*` variable, an image layer, a public issue, or a report.
- Set a strong `REVIEW_ACCESS_TOKEN` before exposing a server that can make AI requests. Requests for AI reviews use `Authorization: Bearer <token>`.
- Use HTTPS on public deployments. Rotate the access token when access changes, and rotate an API key if it is disclosed.
- Set account-level API spending limits and monitor usage. Authentication and request limits reduce abuse but do not replace account-level controls.
- Review patches for credentials and sensitive content before sending them to an AI provider. API requests leave the machine running DiffAtlas; provider handling follows the API account's applicable terms and settings.
- Treat exported reports as potentially sensitive: they can contain code snippets and paths from the supplied patch.
- Only review code you are authorized to share and inspect.

## Scope and limitations

DiffAtlas analyzes text supplied by the user. It does not execute patches, install dependencies from reviewed repositories, or apply fixes. Its evidence checks verify references to supplied code, not the correctness or completeness of the security analysis. A clean result is not a security certification.

GitHub Pages runs the static demo and has no AI backend or server-side secret storage. Never try to enable live API access by embedding a key in that build. Use a backend deployment for AI reviews.
