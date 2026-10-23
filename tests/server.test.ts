import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { analyzeDemo } from '../src/core/demo';
import { parseDiff } from '../src/core/diff';
import { ReviewServiceError } from '../src/core/review';
import { sampleDiff } from '../src/core/sample';

const token = 'test-access-token-not-a-real-secret';
const env = { OPENAI_API_KEY: 'test-api-key', REVIEW_ACCESS_TOKEN: token };
const output = { ...analyzeDemo(parseDiff(sampleDiff)), mode: 'ai' as const, model: 'test-model' };

describe('review HTTP API', () => {
  it.each([{}, { OPENAI_API_KEY: 'key-only' }, { REVIEW_ACCESS_TOKEN: token }])('disables live review unless both credentials are configured', async disabledEnv => {
    const reviewer = vi.fn();
    const app = createApp({ env: disabledEnv, reviewer });
    const status = await request(app).get('/api/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ aiEnabled: false, requiresToken: false, demoOnly: true });
    expect(status.headers['cache-control']).toBe('no-store');
    const response = await request(app).post('/api/review').send({ diff: sampleDiff });
    expect(response.status).toBe(503);
    expect(reviewer).not.toHaveBeenCalled();
  });

  it('reports live availability without exposing credentials and requires the bearer token', async () => {
    const reviewer = vi.fn().mockResolvedValue(output);
    const app = createApp({ env, reviewer });
    const status = await request(app).get('/api/status');
    expect(status.body).toMatchObject({ aiEnabled: true, requiresToken: true, demoOnly: false, model: 'gpt-4.1-mini' });
    expect(JSON.stringify(status.body)).not.toContain(token);
    for (const authorization of ['', 'Bearer wrong-token', `Basic ${token}`]) {
      const response = await request(app).post('/api/review').set('Authorization', authorization).send({ diff: sampleDiff });
      expect(response.status).toBe(401);
    }
    expect(reviewer).not.toHaveBeenCalled();
    const response = await request(app).post('/api/review').set('Authorization', `Bearer ${token}`).send({ diff: sampleDiff });
    expect(response.status).toBe(200);
    expect(response.body.findings).toHaveLength(3);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(reviewer).toHaveBeenCalledExactlyOnceWith(sampleDiff);
  });

  it.each([{}, { diff: 42 }, { diff: 'not a diff' }, ['not-an-object']])('rejects invalid requests before calling AI', async body => {
    const reviewer = vi.fn();
    const response = await request(createApp({ env, reviewer })).post('/api/review').set('Authorization', `Bearer ${token}`).send(body);
    expect(response.status).toBe(400);
    expect(reviewer).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and unsupported media types with safe responses', async () => {
    const app = createApp({ env, reviewer: vi.fn() });
    const malformed = await request(app).post('/api/review').set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/json').send('{"diff":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('invalid_json');
    const text = await request(app).post('/api/review').set('Authorization', `Bearer ${token}`).set('Content-Type', 'text/plain').send(sampleDiff);
    expect(text.status).toBe(415);
  });

  it('enforces both the patch byte limit and JSON body limit', async () => {
    const reviewer = vi.fn();
    for (const size of [103_000, 700_000]) {
      const response = await request(createApp({ env, reviewer })).post('/api/review').set('Authorization', `Bearer ${token}`).send({ diff: 'x'.repeat(size) });
      expect(response.status).toBe(413);
    }
    expect(reviewer).not.toHaveBeenCalled();
  });

  it('accepts a bounded diff even when JSON escapes make its request body larger', async () => {
    const reviewer = vi.fn().mockResolvedValue(output);
    const diff = '--- a/escaped.txt\n+++ b/escaped.txt\n@@ -0,0 +1 @@\n+' + '\\'.repeat(90_000) + '\n';
    const response = await request(createApp({ env, reviewer })).post('/api/review').set('Authorization', `Bearer ${token}`).send({ diff });
    expect(response.status).toBe(200);
    expect(reviewer).toHaveBeenCalledExactlyOnceWith(diff);
  });

  it('rate limits requests without trusting a forwarded client IP', async () => {
    const app = createApp({ env, reviewer: vi.fn().mockResolvedValue(output), rateLimitMax: 1 });
    const first = await request(app).post('/api/review').set('Authorization', `Bearer ${token}`).send({ diff: sampleDiff });
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/review').set('Authorization', `Bearer ${token}`).send({ diff: sampleDiff });
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('rate_limited');
  });

  it('returns refusals as 422 and never leaks unknown exception details', async () => {
    const refusalApp = createApp({ env, reviewer: async () => { throw new ReviewServiceError('The AI provider declined to review this content.', 'provider_refused', 422); } });
    const refusal = await request(refusalApp).post('/api/review').set('Authorization', `Bearer ${token}`).send({ diff: sampleDiff });
    expect(refusal.status).toBe(422);
    expect(refusal.body.code).toBe('provider_refused');
    const brokenApp = createApp({ env, reviewer: async () => { throw new Error('secret-key private-source-code'); } });
    const broken = await request(brokenApp).post('/api/review').set('Authorization', `Bearer ${token}`).send({ diff: sampleDiff });
    expect(broken.status).toBe(500);
    expect(broken.body).toEqual({ error: 'The server could not complete the review.', code: 'internal_error' });
  });
});
