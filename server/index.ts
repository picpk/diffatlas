import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { createApp } from './app';

const host = process.env.HOST?.trim() || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const app = createApp();
const frontend = resolve(process.cwd(), 'dist');
if (existsSync(resolve(frontend, 'index.html'))) {
  app.use(express.static(frontend, { index: 'index.html', maxAge: 0 }));
  app.get('/{*path}', (_request, response) => response.sendFile(resolve(frontend, 'index.html')));
}
const staticError: ErrorRequestHandler = (_error, _request, response, _next) => {
  response.status(500).json({ error: 'The server could not serve this page.', code: 'internal_error' });
};
app.use(staticError);
const server = app.listen(port, host, () => {
  console.log(`DiffAtlas is listening at http://${host}:${port}`);
  if (!process.env.OPENAI_API_KEY?.trim() || !process.env.REVIEW_ACCESS_TOKEN?.trim()) {
    console.log('Offline demo mode: configure OPENAI_API_KEY and REVIEW_ACCESS_TOKEN to enable AI review.');
  }
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
