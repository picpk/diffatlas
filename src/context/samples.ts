import type { SourceFile } from './types';

export const sampleTask = '修复 verifyResetToken 的过期时间边界：当当前时间等于 expiresAt 时，密码重置令牌也应失效。保留有效令牌的行为，并补充边界测试。';

export const sampleFiles: SourceFile[] = [
  { path: 'src/auth/reset-token.ts', content: `import { RESET_TOKEN_TTL_MS } from './constants';
import type { ResetToken, TokenRepository } from './types';

export async function issueResetToken(
  userId: string,
  repository: TokenRepository,
  now: number = Date.now(),
): Promise<ResetToken> {
  const token: ResetToken = {
    value: crypto.randomUUID(),
    userId,
    expiresAt: now + RESET_TOKEN_TTL_MS,
    usedAt: null,
  };
  await repository.save(token);
  return token;
}

export async function verifyResetToken(
  value: string,
  repository: TokenRepository,
  now: number = Date.now(),
): Promise<ResetToken | null> {
  const token = await repository.findByValue(value);
  if (!token || token.usedAt !== null) return null;
  if (now > token.expiresAt) return null;
  return token;
}

export async function consumeResetToken(
  token: ResetToken,
  repository: TokenRepository,
  now: number = Date.now(),
): Promise<void> {
  await repository.markUsed(token.value, now);
}
` },
  { path: 'src/auth/constants.ts', content: `export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const RESET_TOKEN_TTL_MS = 15 * MINUTE_MS;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_RESET_ATTEMPTS = 5;
` },
  { path: 'src/auth/types.ts', content: `export interface ResetToken {
  value: string;
  userId: string;
  expiresAt: number;
  usedAt: number | null;
}

export interface TokenRepository {
  save(token: ResetToken): Promise<void>;
  findByValue(value: string): Promise<ResetToken | null>;
  markUsed(value: string, usedAt: number): Promise<void>;
}

export interface PasswordRepository {
  updateHash(userId: string, passwordHash: string): Promise<void>;
}
` },
  { path: 'src/routes/reset-password.ts', content: `import { verifyResetToken, consumeResetToken } from '../auth/reset-token';
import { MIN_PASSWORD_LENGTH } from '../auth/constants';
import type { TokenRepository, PasswordRepository } from '../auth/types';

interface ResetRequest {
  token: string;
  newPassword: string;
}

export async function resetPassword(
  input: ResetRequest,
  tokens: TokenRepository,
  passwords: PasswordRepository,
  hashPassword: (password: string) => Promise<string>,
) {
  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    return { status: 400, error: 'Password is too short' };
  }
  const token = await verifyResetToken(input.token, tokens);
  if (!token) return { status: 400, error: 'Invalid or expired token' };
  const passwordHash = await hashPassword(input.newPassword);
  await passwords.updateHash(token.userId, passwordHash);
  await consumeResetToken(token, tokens);
  return { status: 200, message: 'Password updated' };
}
` },
  { path: 'tests/reset-token.test.ts', content: `import { describe, expect, it } from 'vitest';
import { verifyResetToken } from '../src/auth/reset-token';
import type { ResetToken, TokenRepository } from '../src/auth/types';

const expiresAt = 1_700_000_900_000;
const fixture: ResetToken = {
  value: 'test-token', userId: 'user-1', expiresAt, usedAt: null,
};

function repository(token: ResetToken | null): TokenRepository {
  return {
    async save() {},
    async findByValue() { return token; },
    async markUsed() {},
  };
}

describe('verifyResetToken', () => {
  it('accepts an unused token before expiry', async () => {
    expect(await verifyResetToken('test-token', repository(fixture), expiresAt - 1)).toEqual(fixture);
  });
  it('rejects a token after expiry', async () => {
    expect(await verifyResetToken('test-token', repository(fixture), expiresAt + 1)).toBeNull();
  });
  it('rejects a previously used token', async () => {
    const used = { ...fixture, usedAt: expiresAt - 100 };
    expect(await verifyResetToken('test-token', repository(used), expiresAt - 1)).toBeNull();
  });
  it('rejects unknown tokens', async () => {
    expect(await verifyResetToken('missing', repository(null), expiresAt - 1)).toBeNull();
  });
});
` },
  { path: 'src/profile/preferences.ts', content: `export type Theme = 'light' | 'dark' | 'system';
export interface Preferences {
  locale: string;
  theme: Theme;
  weeklyDigest: boolean;
  timezone: string;
}

export const defaultPreferences: Preferences = {
  locale: 'zh-CN',
  theme: 'system',
  weeklyDigest: false,
  timezone: 'Asia/Shanghai',
};

export function mergePreferences(current: Preferences, patch: Partial<Preferences>): Preferences {
  const next = { ...current, ...patch };
  if (!['light', 'dark', 'system'].includes(next.theme)) throw new Error('Unsupported theme');
  try {
    new Intl.DateTimeFormat(next.locale, { timeZone: next.timezone });
  } catch {
    throw new Error('Invalid locale or timezone');
  }
  return next;
}

export function formatLocalDate(date: Date, preferences: Preferences): string {
  return new Intl.DateTimeFormat(preferences.locale, {
    dateStyle: 'medium', timeZone: preferences.timezone,
  }).format(date);
}
` },
  { path: 'src/catalog/search.ts', content: `export interface Product {
  id: string;
  title: string;
  category: string;
  priceCents: number;
  available: boolean;
}

export interface SearchOptions {
  query?: string;
  category?: string;
  maxPriceCents?: number;
  page?: number;
  pageSize?: number;
}

export function searchProducts(products: Product[], options: SearchOptions) {
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
  const page = Math.max(1, options.page ?? 1);
  const matches = products.filter(product => {
    if (!product.available) return false;
    if (query && !product.title.toLocaleLowerCase().includes(query)) return false;
    if (options.category && product.category !== options.category) return false;
    if (options.maxPriceCents !== undefined && product.priceCents > options.maxPriceCents) return false;
    return true;
  });
  const start = (page - 1) * pageSize;
  return {
    items: matches.slice(start, start + pageSize),
    total: matches.length, page,
    hasNextPage: start + pageSize < matches.length,
  };
}
` },
  { path: 'src/email/templates.ts', content: `interface DigestItem {
  title: string;
  url: string;
  description: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]!));
}

function safeLink(url: string): string {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '#';
  } catch {
    return '#';
  }
}

export function weeklyDigest(name: string, items: DigestItem[]): string {
  const rows = items.map(item =>
    '<li><a href="' + escapeHtml(safeLink(item.url)) + '">' + escapeHtml(item.title)
    + '</a><p>' + escapeHtml(item.description) + '</p></li>',
  );
  return '<h1>Hello, ' + escapeHtml(name) + '</h1>'
    + '<p>Your reading list for this week.</p><ul>' + rows.join('') + '</ul>';
}
` },
  { path: 'README.md', content: `# Account service

A small account service used by the storefront.

## Development

Install dependencies with npm install. Run npm test before submitting changes.
Business logic lives in src and unit tests live in tests.

## Password reset

Tokens are valid for fifteen minutes and may be consumed once.
All timestamps are Unix milliseconds. The expiry instant is exclusive:
a token must not be accepted when now is equal to expiresAt.

## Other modules

The profile module formats dates using the user's locale and timezone.
The catalog module supports text search, category filters, and pagination.
The weekly digest template escapes user-provided display values.

## API conventions

Handlers return objects with a numeric status and a message or error.
Storage adapters implement the interfaces defined in src/auth/types.ts.
` },
];
