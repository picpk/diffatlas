import { timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { DiffParseError, parseDiff } from '../src/core/diff';
import { DEFAULT_MODEL, ReviewServiceError, reviewWithAI } from '../src/core/review';
import type { Review } from '../src/core/types';

export interface AppOptions {
  env?: NodeJS.ProcessEnv;
  reviewer?: (diff: string) => Promise<Review>;
  rateLimitMax?: number;
}

function equalToken(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createApp(options: AppOptions = {}) {
  const env = options.env ?? process.env;
  const apiKeyConfigured = Boolean(env.OPENAI_API_KEY?.trim());
  const accessToken = env.REVIEW_ACCESS_TOKEN?.trim() ?? '';
  const aiEnabled = apiKeyConfigured && Boolean(accessToken);
  const model = env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  const reviewer = options.reviewer ?? ((diff: string) => reviewWithAI(diff, env));
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet({
    // Vite's production bundle has no inline scripts. Inline CSS supports React style attributes.
    contentSecurityPolicy: { directives: {
      'script-src': ["'self'"], 'connect-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"],
      'upgrade-insecure-requests': null,
    } },
    // The default local deployment uses HTTP. Enable HSTS at the public TLS proxy.
    strictTransportSecurity: false,
  }));
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/status', (_request, response) => {
    response.json({ aiEnabled, model, requiresToken: aiEnabled, demoOnly: !aiEnabled });
  });
  app.post('/api/review', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: options.rateLimitMax ?? 20,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many review requests. Try again later.', code: 'rate_limited' },
  }), (request, response, next) => {
    if (!aiEnabled) {
      response.status(503).json({ error: 'AI review is disabled. The server needs OPENAI_API_KEY and REVIEW_ACCESS_TOKEN.', code: 'ai_unavailable' });
      return;
    }
    const authorization = request.get('authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!equalToken(token, accessToken)) {
      response.status(401).json({ error: 'A valid review access token is required.', code: 'unauthorized' });
      return;
    }
    if (!request.is('application/json')) {
      response.status(415).json({ error: 'Send the request as application/json.', code: 'unsupported_media_type' });
      return;
    }
    next();
  // JSON escaping may expand a valid 100 KiB diff to six times its UTF-8 size.
  // parseDiff enforces the source limit after this bounded transport decode.
  }, express.json({ limit: '650kb', strict: true }), async (request, response, next) => {
    try {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) || typeof request.body.diff !== 'string') {
        response.status(400).json({ error: 'The JSON body must contain a string field named diff.', code: 'invalid_request' });
        return;
      }
      parseDiff(request.body.diff);
      response.json(await reviewer(request.body.diff));
    } catch (error) { next(error); }
  });
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API route not found.', code: 'not_found' });
  });
  const onError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof DiffParseError) {
      response.status(error.code === 'diff_too_large' ? 413 : 400).json({ error: error.message, code: error.code });
    } else if (error instanceof ReviewServiceError) {
      response.status(error.status).json({ error: error.message, code: error.code });
    } else if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      response.status(413).json({ error: 'The request is too large. Diffs are limited to 100 KiB.', code: 'request_too_large' });
    } else if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'The request body is not valid JSON.', code: 'invalid_json' });
    } else {
      response.status(500).json({ error: 'The server could not complete the review.', code: 'internal_error' });
    }
  };
  app.use(onError);
  return app;
}
