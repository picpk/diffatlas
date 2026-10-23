import type { SourceFile } from '../src/context/types';

export interface BenchmarkCase {
  id: string;
  title: string;
  task: string;
  files: SourceFile[];
  requiredEvidence: { path: string; includes: string }[];
  diff?: string;
  pinnedPaths?: string[];
}

const file = (path: string, content: string): SourceFile => ({ path, content: `${content.trim()}\n` });

// Authored synthetic repositories. These are selection checks, not model-quality evaluations.
export const benchmarkCases: BenchmarkCase[] = [
  {
    id: 'reset-expiry',
    title: 'Password reset expiry and its caller',
    task: 'Check resetPassword and tokenIsExpired for an expired password-reset token, including the boundary test and expiry duration.',
    files: [
      file('src/auth/reset.ts', String.raw`
import { tokenIsExpired } from './token';
import { findToken, consumeToken } from './store';
export function resetPassword(token: string, now: number): string {
  const record = findToken(token);
  if (!record || tokenIsExpired(record.issuedAt, now)) {
    throw new Error('Reset token expired or missing');
  }
  consumeToken(token);
  return record.userId;
}`),
      file('src/auth/token.ts', String.raw`
export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
export function tokenIsExpired(issuedAt: number, now: number): boolean {
  return now - issuedAt >= RESET_TOKEN_TTL_MS;
}
export function tokenExpiresAt(issuedAt: number): number {
  return issuedAt + RESET_TOKEN_TTL_MS;
}`),
      file('src/auth/store.ts', String.raw`
type ResetToken = { userId: string; issuedAt: number };
const tokens = new Map<string, ResetToken>();
export function findToken(token: string): ResetToken | undefined {
  return tokens.get(token);
}
export function consumeToken(token: string): void {
  tokens.delete(token);
}
export function saveToken(token: string, record: ResetToken): void {
  tokens.set(token, record);
}`),
      file('tests/reset-expiry.test.ts', String.raw`
import { strict as assert } from 'node:assert';
import { tokenIsExpired, RESET_TOKEN_TTL_MS } from '../src/auth/token';
export function testResetExpiryBoundary(): void {
  const issuedAt = 1000;
  assert.equal(tokenIsExpired(issuedAt, issuedAt + RESET_TOKEN_TTL_MS - 1), false);
  assert.equal(tokenIsExpired(issuedAt, issuedAt + RESET_TOKEN_TTL_MS), true);
}`),
      file('src/mail/welcome.ts', String.raw`
export function welcomeSubject(name: string): string {
  return 'Welcome, ' + name.trim();
}
export function welcomeText(name: string, loginUrl: string): string {
  return ['Hello ' + name, 'Your account is ready.', 'Sign in: ' + loginUrl].join('\n');
}`),
      file('src/health.ts', String.raw`
export type Health = { status: 'ok' | 'degraded'; uptime: number };
export function health(startedAt: number, databaseReady: boolean): Health {
  return {
    status: databaseReady ? 'ok' : 'degraded',
    uptime: Math.max(0, Date.now() - startedAt),
  };
}`),
    ],
    requiredEvidence: [
      { path: 'src/auth/reset.ts', includes: 'if (!record || tokenIsExpired(record.issuedAt, now))' },
      { path: 'src/auth/token.ts', includes: 'export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;' },
      { path: 'src/auth/token.ts', includes: 'return now - issuedAt >= RESET_TOKEN_TTL_MS;' },
      { path: 'tests/reset-expiry.test.ts', includes: 'issuedAt + RESET_TOKEN_TTL_MS), true' },
    ],
  },
  {
    id: 'cached-null',
    title: 'Cache null is a hit, not an absent key',
    task: 'Review getCachedUser handling of a cached null and a cache miss; preserve the null cache hit test.',
    files: [
      file('src/users/cache.ts', String.raw`
import { loadUser, type User } from './repository';
const userCache = new Map<string, User | null>();
export async function getCachedUser(id: string): Promise<User | null> {
  if (userCache.has(id)) return userCache.get(id) ?? null;
  const user = await loadUser(id);
  userCache.set(id, user);
  return user;
}
export function clearUserCache(): void {
  userCache.clear();
}`),
      file('src/users/repository.ts', String.raw`
export interface User { id: string; name: string }
const users = new Map<string, User>();
let reads = 0;
export async function loadUser(id: string): Promise<User | null> {
  reads += 1;
  return users.get(id) ?? null;
}
export function readCount(): number {
  return reads;
}`),
      file('tests/cached-null.test.ts', String.raw`
import { strict as assert } from 'node:assert';
import { getCachedUser, clearUserCache } from '../src/users/cache';
import { readCount } from '../src/users/repository';
export async function testNullCacheHit(): Promise<void> {
  clearUserCache();
  const before = readCount();
  assert.equal(await getCachedUser('missing'), null);
  assert.equal(await getCachedUser('missing'), null);
  assert.equal(readCount() - before, 1);
}`),
      file('src/users/display.ts', String.raw`
import type { User } from './repository';
export function displayName(user: User | null): string {
  return user?.name.trim() || 'Guest';
}
export function initials(user: User): string {
  return user.name.split(/\s+/).map(word => word[0]).slice(0, 2).join('');
}`),
      file('src/pagination.ts', String.raw`
export function pageRange(page: number, size: number): [number, number] {
  if (!Number.isInteger(page) || page < 1) throw new Error('Invalid page');
  if (!Number.isInteger(size) || size < 1) throw new Error('Invalid size');
  const start = (page - 1) * size;
  return [start, start + size];
}`),
    ],
    requiredEvidence: [
      { path: 'src/users/cache.ts', includes: 'if (userCache.has(id)) return userCache.get(id) ?? null;' },
      { path: 'src/users/repository.ts', includes: 'return users.get(id) ?? null;' },
      { path: 'tests/cached-null.test.ts', includes: 'assert.equal(readCount() - before, 1);' },
    ],
  },
  {
    id: 'invoice-rounding',
    title: 'Invoice discount and cents rounding',
    task: 'Check invoiceTotal discount rounding, the money roundCents helper, and the half-cent rounding regression test.',
    files: [
      file('src/billing/invoice.ts', String.raw`
import { roundCents } from './money';
export interface InvoiceLine { price: number; quantity: number }
export function invoiceTotal(lines: InvoiceLine[], discount: number): number {
  if (discount < 0 || discount > 1) throw new Error('Invalid discount');
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  return roundCents(subtotal * (1 - discount));
}`),
      file('src/billing/money.ts', String.raw`
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Invalid amount');
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}`),
      file('tests/invoice-rounding.test.ts', String.raw`
import { strict as assert } from 'node:assert';
import { invoiceTotal } from '../src/billing/invoice';
import { roundCents } from '../src/billing/money';
export function testInvoiceRounding(): void {
  assert.equal(roundCents(1.005), 1.01);
  assert.equal(invoiceTotal([{ price: 10.05, quantity: 1 }], 0.1), 9.05);
}`),
      file('src/shipping/rate.ts', String.raw`
export function shippingRate(weightKg: number, country: string): number {
  if (weightKg <= 0) throw new Error('Weight must be positive');
  const base = country === 'US' ? 5 : 12;
  return base + Math.ceil(weightKg) * 2;
}
export function freeShipping(subtotal: number): boolean {
  return subtotal >= 100;
}`),
      file('src/catalog/search.ts', String.raw`
export interface Product { sku: string; name: string; active: boolean }
export function searchProducts(products: Product[], term: string): Product[] {
  const query = term.trim().toLowerCase();
  return products.filter(product => product.active && product.name.toLowerCase().includes(query));
}
export function productBySku(products: Product[], sku: string): Product | undefined {
  return products.find(product => product.sku === sku);
}`),
    ],
    requiredEvidence: [
      { path: 'src/billing/invoice.ts', includes: 'return roundCents(subtotal * (1 - discount));' },
      { path: 'src/billing/money.ts', includes: 'Math.round((value + Number.EPSILON) * 100) / 100' },
      { path: 'tests/invoice-rounding.test.ts', includes: 'assert.equal(roundCents(1.005), 1.01);' },
    ],
  },
  {
    id: 'download-path',
    title: 'Download path containment',
    task: 'Audit downloadFile and resolveWithin for path traversal; include the download containment test for ../ and a sibling directory.',
    files: [
      file('src/download/route.ts', String.raw`
import { readFile } from 'node:fs/promises';
import { resolveWithin } from './paths';
export async function downloadFile(root: string, requestedPath: string): Promise<Buffer> {
  const path = resolveWithin(root, requestedPath);
  return readFile(path);
}`),
      file('src/download/paths.ts', String.raw`
import { isAbsolute, relative, resolve, sep } from 'node:path';
export function resolveWithin(root: string, requested: string): string {
  const absolute = resolve(root, requested);
  const child = relative(resolve(root), absolute);
  if (child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) {
    throw new Error('Path outside download root');
  }
  return absolute;
}`),
      file('tests/download-path.test.ts', String.raw`
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { resolveWithin } from '../src/download/paths';
export function testDownloadContainment(): void {
  const root = resolve('data');
  assert.throws(() => resolveWithin(root, '../private.txt'));
  assert.throws(() => resolveWithin(root, '../data-backup/file.txt'));
  assert.equal(resolveWithin(root, 'report.txt'), resolve(root, 'report.txt'));
}`),
      file('src/download/headers.ts', String.raw`
export function contentType(extension: string): string {
  const known: Record<string, string> = { pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv' };
  return known[extension.toLowerCase()] ?? 'application/octet-stream';
}
export function cacheHeader(privateFile: boolean): string {
  return privateFile ? 'private, no-store' : 'public, max-age=300';
}`),
      file('src/upload/limits.ts', String.raw`
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export function validateUpload(size: number, filename: string): void {
  if (!Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) throw new Error('Invalid size');
  if (!filename.trim()) throw new Error('Filename required');
}
export function remainingBytes(uploaded: number): number {
  return Math.max(0, MAX_UPLOAD_BYTES - uploaded);
}`),
    ],
    requiredEvidence: [
      { path: 'src/download/route.ts', includes: 'const path = resolveWithin(root, requestedPath);' },
      { path: 'src/download/paths.ts', includes: "child.startsWith('..' + sep) || isAbsolute(child)" },
      { path: 'tests/download-path.test.ts', includes: "resolveWithin(root, '../data-backup/file.txt')" },
    ],
  },
  {
    id: 'abort-cleanup',
    title: 'Timeout cleanup after an aborted fetch',
    task: 'Review fetchWithTimeout cancellation and timer cleanup, including the cleanup regression test and the caller loadProfile.',
    files: [
      file('src/net/fetch.ts', String.raw`
export async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}`),
      file('src/profile/load.ts', String.raw`
import { fetchWithTimeout } from '../net/fetch';
export async function loadProfile(id: string): Promise<unknown> {
  const response = await fetchWithTimeout('/profiles/' + encodeURIComponent(id), 3000);
  if (!response.ok) throw new Error('Profile unavailable');
  return response.json();
}`),
      file('tests/abort-cleanup.test.ts', String.raw`
import { strict as assert } from 'node:assert';
import { mock } from 'node:test';
import { fetchWithTimeout } from '../src/net/fetch';
export async function testTimeoutCleanup(): Promise<void> {
  const clear = mock.method(globalThis, 'clearTimeout');
  const request = mock.method(globalThis, 'fetch', async () => { throw new Error('Aborted'); });
  try {
    await assert.rejects(fetchWithTimeout('https://example.invalid', 1000), /Aborted/);
    assert.equal(clear.mock.callCount(), 1);
  } finally {
    clear.mock.restore();
    request.mock.restore();
  }
}`),
      file('src/net/status.ts', String.raw`
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503;
}
export function retryAfterSeconds(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}`),
      file('src/profile/avatar.ts', String.raw`
export function avatarUrl(id: string, size = 64): string {
  const dimension = Math.min(512, Math.max(16, Math.round(size)));
  return '/avatars/' + encodeURIComponent(id) + '?size=' + dimension;
}
export function avatarAlt(name: string): string {
  return 'Profile picture for ' + name;
}`),
    ],
    requiredEvidence: [
      { path: 'src/net/fetch.ts', includes: 'clearTimeout(timeout);' },
      { path: 'src/profile/load.ts', includes: "fetchWithTimeout('/profiles/' + encodeURIComponent(id), 3000)" },
      { path: 'tests/abort-cleanup.test.ts', includes: 'assert.equal(clear.mock.callCount(), 1);' },
    ],
  },
  {
    id: 'config-schema',
    title: 'Changed config type and its consumer',
    task: 'Check the Config retryLimit type change in the diff against parseConfig, runJob and the retry configuration test.',
    files: [
      file('src/config/types.ts', String.raw`
export interface Config {
  endpoint: string;
  retryLimit: number;
}
export const DEFAULT_RETRY_LIMIT = 3;`),
      file('src/config/parse.ts', String.raw`
import { DEFAULT_RETRY_LIMIT, type Config } from './types';
export function parseConfig(value: Record<string, unknown>): Config {
  if (typeof value.endpoint !== 'string') throw new Error('endpoint required');
  const retryLimit = value.retryLimit ?? DEFAULT_RETRY_LIMIT;
  if (!Number.isInteger(retryLimit) || Number(retryLimit) < 0) throw new Error('Invalid retryLimit');
  return { endpoint: value.endpoint, retryLimit: Number(retryLimit) };
}`),
      file('src/jobs/run.ts', String.raw`
import type { Config } from '../config/types';
export async function runJob(config: Config, send: (url: string) => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { await send(config.endpoint); return; }
    catch (error) { if (attempt >= config.retryLimit) throw error; }
  }
}`),
      file('tests/config-retry.test.ts', String.raw`
import { strict as assert } from 'node:assert';
import { parseConfig } from '../src/config/parse';
export function testRetryConfig(): void {
  assert.equal(parseConfig({ endpoint: '/jobs' }).retryLimit, 3);
  assert.equal(parseConfig({ endpoint: '/jobs', retryLimit: 0 }).retryLimit, 0);
  assert.throws(() => parseConfig({ endpoint: '/jobs', retryLimit: '3' }));
}`),
      file('src/logging/level.ts', String.raw`
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ranks: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
export function shouldLog(level: LogLevel, minimum: LogLevel): boolean {
  return ranks[level] >= ranks[minimum];
}
export function logLabel(level: LogLevel): string {
  return level.toUpperCase();
}`),
    ],
    diff: 'diff --git a/src/config/types.ts b/src/config/types.ts\n--- a/src/config/types.ts\n+++ b/src/config/types.ts\n@@ -1,4 +1,4 @@\n export interface Config {\n   endpoint: string;\n-  retryLimit: string;\n+  retryLimit: number;\n }\n',
    requiredEvidence: [
      { path: 'src/config/types.ts', includes: 'retryLimit: number;' },
      { path: 'src/config/parse.ts', includes: 'Number.isInteger(retryLimit)' },
      { path: 'src/jobs/run.ts', includes: 'attempt >= config.retryLimit' },
      { path: 'tests/config-retry.test.ts', includes: "retryLimit: '3'" },
    ],
  },
  {
    id: 'renamed-slug',
    title: 'Changed code under a renamed file path',
    task: 'Review normalizeSlug after its file rename, including createArticle and the slug punctuation regression test.',
    files: [
      file('src/text/slug.ts', String.raw`
export function normalizeSlug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}`),
      file('src/articles/create.ts', String.raw`
import { normalizeSlug } from '../text/slug';
export interface Article { title: string; slug: string }
export function createArticle(title: string): Article {
  const slug = normalizeSlug(title);
  if (!slug) throw new Error('Title must contain letters or digits');
  return { title: title.trim(), slug };
}`),
      file('tests/slug.test.ts', String.raw`
import { strict as assert } from 'node:assert';
import { normalizeSlug } from '../src/text/slug';
export function testSlugPunctuation(): void {
  assert.equal(normalizeSlug('Hello, World!'), 'hello-world');
  assert.equal(normalizeSlug('---Release 2---'), 'release-2');
  assert.equal(normalizeSlug('!!!'), '');
}`),
      file('src/articles/date.ts', String.raw`
export function publishedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) throw new Error('Invalid publication date');
  return date.toISOString().slice(0, 10);
}
export function isScheduled(iso: string, now: number): boolean {
  return new Date(iso).valueOf() > now;
}`),
      file('src/text/excerpt.ts', String.raw`
export function excerpt(body: string, maxLength: number): string {
  if (maxLength < 1) return '';
  const words = body.replace(/\s+/g, ' ').trim();
  return words.length <= maxLength ? words : words.slice(0, maxLength - 1) + '…';
}
export function wordCount(body: string): number {
  return body.trim() ? body.trim().split(/\s+/).length : 0;
}`),
    ],
    diff: "diff --git a/src/slug.ts b/src/text/slug.ts\nsimilarity index 70%\nrename from src/slug.ts\nrename to src/text/slug.ts\n--- a/src/slug.ts\n+++ b/src/text/slug.ts\n@@ -1,3 +1,3 @@\n export function normalizeSlug(title: string): string {\n-  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');\n+  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');\n }\n",
    requiredEvidence: [
      { path: 'src/text/slug.ts', includes: ".replace(/^-+|-+$/g, '')" },
      { path: 'src/articles/create.ts', includes: 'const slug = normalizeSlug(title);' },
      { path: 'tests/slug.test.ts', includes: "normalizeSlug('---Release 2---'), 'release-2'" },
    ],
  },
  {
    id: 'unicode-config',
    title: 'Chinese task and Unicode configuration',
    task: '检查 parseRetryConfig 的重试次数配置：保留零次重试，并查看中文错误提示和 testRetryZero 测试。',
    pinnedPaths: ['docs/configuration.md'],
    files: [
      file('src/settings/retry.ts', String.raw`
export interface RetryConfig { retries: number; label: string }
// 重试次数为零代表只发送一次请求，不额外重试。
export function parseRetryConfig(value: Record<string, unknown>): RetryConfig {
  const retries = value.retries ?? 3;
  if (!Number.isInteger(retries) || Number(retries) < 0) throw new Error('重试次数必须是非负整数');
  return { retries: Number(retries), label: String(value.label ?? '任务 🚀') };
}`),
      file('tests/retry-zero.test.ts', String.raw`
import { strict as assert } from 'node:assert';
import { parseRetryConfig } from '../src/settings/retry';
export function testRetryZero(): void {
  assert.equal(parseRetryConfig({ retries: 0 }).retries, 0);
  assert.equal(parseRetryConfig({}).label, '任务 🚀');
  assert.throws(() => parseRetryConfig({ retries: -1 }), /重试次数必须是非负整数/);
}`),
      file('docs/configuration.md', String.raw`
# 请求配置

retries 表示失败后额外重试的次数；默认值是 3。
设置 retries: 0 时只发送一次请求。label 用于界面显示，支持中文和 emoji。
无效配置会抛出错误，调用方应提示用户修正配置。`),
      file('src/settings/locale.ts', String.raw`
export const supportedLocales = ['zh-CN', 'en-US', 'ja-JP'] as const;
export function selectLocale(requested: string): string {
  return supportedLocales.find(locale => locale === requested) ?? 'zh-CN';
}
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}`),
      file('src/ui/notification.ts', String.raw`
export interface Notice { message: string; kind: 'info' | 'error' }
export function noticeText(notice: Notice): string {
  return (notice.kind === 'error' ? '错误：' : '提示：') + notice.message;
}
export function dismissNotice(notices: Notice[], index: number): Notice[] {
  return notices.filter((_, current) => current !== index);
}`),
    ],
    requiredEvidence: [
      { path: 'src/settings/retry.ts', includes: 'const retries = value.retries ?? 3;' },
      { path: 'src/settings/retry.ts', includes: "throw new Error('重试次数必须是非负整数')" },
      { path: 'tests/retry-zero.test.ts', includes: 'parseRetryConfig({ retries: 0 }).retries, 0' },
      { path: 'docs/configuration.md', includes: '设置 retries: 0 时只发送一次请求。' },
    ],
  },
];
