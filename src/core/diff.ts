import type { DiffFile, ParsedDiff } from './types';

export const MAX_DIFF_BYTES = 100 * 1024;
export const MAX_DIFF_FILES = 100;

export class DiffParseError extends Error {
  constructor(message: string, public readonly code: 'invalid_diff' | 'diff_too_large' = 'invalid_diff') {
    super(message);
    this.name = 'DiffParseError';
  }
}

function decodePath(value: string): string {
  const raw = value.trim();
  if (!raw.startsWith('"')) return raw;
  if (!raw.endsWith('"')) throw new DiffParseError('A quoted file path is incomplete.');
  const bytes: number[] = [];
  const inner = raw.slice(1, -1);
  for (let i = 0; i < inner.length;) {
    if (inner[i] !== '\\') {
      const point = inner.codePointAt(i)!;
      const character = String.fromCodePoint(point);
      bytes.push(...new TextEncoder().encode(character));
      i += character.length;
      continue;
    }
    const octal = inner.slice(i + 1).match(/^[0-7]{1,3}/);
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += octal[0].length + 1;
    } else {
      const escape = inner[++i];
      const replacements: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', a: '\x07', '\\': '\\', '"': '"' };
      if (!escape || !(escape in replacements)) throw new DiffParseError('A file path contains an invalid escape.');
      bytes.push(...new TextEncoder().encode(replacements[escape]));
      i++;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function headerPath(raw: string): string {
  // Traditional unified diffs may append a timestamp after a tab.
  const path = decodePath(raw.startsWith('"') ? raw : raw.split('\t')[0]);
  return path === '/dev/null' ? path : path.replace(/^[ab]\//, '');
}

function gitPaths(header: string): [string, string] {
  const match = header.match(/^diff --git ("(?:[^"\\]|\\.)*"|a\/.*?) ("(?:[^"\\]|\\.)*"|b\/.*)$/);
  if (!match) throw new DiffParseError('A Git file header is malformed.');
  return [headerPath(match[1]), headerPath(match[2])];
}

/** Parse a bounded unified diff. Metadata-only files are retained beside textual changes. */
export function parseDiff(text: string): ParsedDiff {
  if (typeof text !== 'string' || !text.trim()) throw new DiffParseError('Paste a non-empty unified Git diff.');
  if (new TextEncoder().encode(text).byteLength > MAX_DIFF_BYTES) {
    throw new DiffParseError('Diffs must be no larger than 100 KiB. Split this change into smaller patches.', 'diff_too_large');
  }
  if (text.includes('\0')) throw new DiffParseError('A diff must be text, without NUL bytes.');

  const result: ParsedDiff = { files: [], totalAdditions: 0, totalDeletions: 0, warnings: [] };
  let file: DiffFile | undefined;
  let oldHeaderSeen = false;
  let newHeaderSeen = false;
  let hunk: { old: number; next: number; oldRemaining: number; newRemaining: number } | undefined;
  let binaryBody = false;
  let previousOldEnd = 0;
  let previousNewEnd = 0;

  function startFile(oldPath: string, path: string) {
    if (result.files.length >= MAX_DIFF_FILES) throw new DiffParseError('A diff may contain at most 100 files.', 'diff_too_large');
    file = { oldPath, path, additions: 0, deletions: 0, lines: [], isBinary: false };
    result.files.push(file);
    oldHeaderSeen = false;
    newHeaderSeen = false;
    binaryBody = false;
    previousOldEnd = 0;
    previousNewEnd = 0;
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === '\\ No newline at end of file') {
      if (!file?.lines.length) throw new DiffParseError('A newline marker appears outside a hunk.');
      continue;
    }
    if (hunk && (hunk.oldRemaining > 0 || hunk.newRemaining > 0)) {
      if (!file) throw new DiffParseError('A hunk has no file header.');
      const prefix = line[0];
      if (prefix === ' ' && hunk.oldRemaining > 0 && hunk.newRemaining > 0) {
        file.lines.push({ kind: 'context', content: line.slice(1), oldLine: hunk.old++, newLine: hunk.next++ });
        hunk.oldRemaining--;
        hunk.newRemaining--;
      } else if (prefix === '-' && hunk.oldRemaining > 0) {
        file.lines.push({ kind: 'deletion', content: line.slice(1), oldLine: hunk.old++, newLine: null });
        hunk.oldRemaining--;
        file.deletions++;
        result.totalDeletions++;
      } else if (prefix === '+' && hunk.newRemaining > 0) {
        file.lines.push({ kind: 'addition', content: line.slice(1), oldLine: null, newLine: hunk.next++ });
        hunk.newRemaining--;
        file.additions++;
        result.totalAdditions++;
      } else {
        throw new DiffParseError(`Hunk line counts do not match the patch near line ${index + 1}.`);
      }
      continue;
    }
    hunk = undefined;

    if (line.startsWith('diff --git ')) {
      const [oldPath, path] = gitPaths(line);
      startFile(oldPath, path);
      continue;
    }
    if (binaryBody) continue;
    if (line.startsWith('--- ')) {
      if (!file || oldHeaderSeen) startFile(headerPath(line.slice(4)), headerPath(line.slice(4)));
      file!.oldPath = headerPath(line.slice(4));
      oldHeaderSeen = true;
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!file || !oldHeaderSeen || newHeaderSeen) throw new DiffParseError('A new-file header has no matching old-file header.');
      const path = headerPath(line.slice(4));
      file.path = path === '/dev/null' ? file.oldPath : path;
      if (!file.path || file.path === '/dev/null') throw new DiffParseError('A file path is missing.');
      newHeaderSeen = true;
      continue;
    }
    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/);
      if (!match || !file || !oldHeaderSeen || !newHeaderSeen) throw new DiffParseError('A hunk needs valid file headers and line ranges.');
      const old = Number(match[1]);
      const next = Number(match[3]);
      const oldRemaining = match[2] === undefined ? 1 : Number(match[2]);
      const newRemaining = match[4] === undefined ? 1 : Number(match[4]);
      if (![old, next, oldRemaining, newRemaining].every(Number.isSafeInteger) ||
          (oldRemaining > 0 && old === 0) || (newRemaining > 0 && next === 0) ||
          (oldRemaining > 0 && old < previousOldEnd) || (newRemaining > 0 && next < previousNewEnd)) {
        throw new DiffParseError('Hunk line ranges are invalid or overlap.');
      }
      previousOldEnd = old + oldRemaining;
      previousNewEnd = next + newRemaining;
      hunk = { old, next, oldRemaining, newRemaining };
      continue;
    }
    if (file && (line.startsWith('Binary files ') || line === 'GIT binary patch')) {
      file.isBinary = true;
      binaryBody = line === 'GIT binary patch';
      continue;
    }
    if (file && line.startsWith('rename from ')) { file.oldPath = decodePath(line.slice(12)); continue; }
    if (file && line.startsWith('rename to ')) { file.path = decodePath(line.slice(10)); continue; }
    if (file && /^(?:index |old mode |new mode |deleted file mode |new file mode |similarity index |dissimilarity index |copy from |copy to )/.test(line)) continue;
    if (!line.trim()) continue;
    throw new DiffParseError(`Unrecognized diff content near line ${index + 1}. Use git diff --no-ext-diff --no-color.`);
  }
  if (hunk && (hunk.oldRemaining > 0 || hunk.newRemaining > 0)) throw new DiffParseError('The last hunk is incomplete. Copy the entire diff.');
  if (!result.files.length || result.totalAdditions + result.totalDeletions === 0) {
    throw new DiffParseError('This diff has no textual changes to review. Binary-only and rename-only patches are not reviewable.');
  }
  for (const current of result.files) {
    if (current.isBinary) result.warnings.push(`${current.path}: binary content is not reviewed.`);
    else if (!current.lines.length) result.warnings.push(`${current.path}: metadata-only change has no lines to review.`);
  }
  if (result.totalAdditions === 0) result.warnings.push('This patch only removes lines. Findings require added-line evidence, so none can be returned.');
  return result;
}
