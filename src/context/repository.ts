import { execFile } from 'node:child_process';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileExclusionReason } from './policy';
import type { OmittedFile, SourceFile } from './types';

const execute = promisify(execFile);
const TEXT_EXTENSIONS = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|c|h|cpp|hpp|cs|rb|php|swift|scala|sh|ps1|sql|graphql|gql|vue|svelte|html|css|scss|less|json|jsonc|ya?ml|toml|ini|md|mdx|txt|xml|proto)$/i;
const MAX_BYTES = 100 * 1024;
const outside = (path: string) => isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`);
const pathKey = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;

export async function readBoundedFile(path: string, maxBytes = MAX_BYTES): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('The input must be a regular file.');
    if (info.size > maxBytes) throw new Error(`File exceeds the ${maxBytes} byte limit.`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error(`File exceeds the ${maxBytes} byte limit.`);
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
  } finally { await handle.close(); }
}

export async function loadRepository(directory: string, excludePaths: string[] = []): Promise<{ root: string; files: SourceFile[]; excluded: OmittedFile[] }> {
  const root = await realpath(resolve(directory));
  let listing: string;
  let ignoredTracked: Set<string>;
  try {
    const options = { encoding: 'utf8' as const, maxBuffer: 2 * 1024 * 1024, timeout: 15_000 };
    const [result, ignored] = await Promise.all([
      execute('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], options),
      execute('git', ['-C', root, 'ls-files', '-z', '--cached', '--ignored', '--exclude-standard', '--', '.'], options),
    ]);
    listing = result.stdout;
    ignoredTracked = new Set(ignored.stdout.split('\0').filter(Boolean));
  } catch { throw new Error('--repo must be a readable Git working directory. Git must be installed.'); }
  const paths = [...new Set(listing.split('\0').filter(Boolean))].sort();
  if (paths.length > 20_000) throw new Error('More than 20,000 candidate paths. Select a smaller repository subdirectory.');
  const exclusions = new Set(excludePaths.map(path => pathKey(resolve(path))));
  for (const path of excludePaths) {
    // Existing outputs may be addressed through a directory alias or different
    // Windows casing. Exclude the same real file as well as its supplied path.
    try { exclusions.add(pathKey(await realpath(resolve(path)))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const excluded: OmittedFile[] = [];
  const files: SourceFile[] = [];
  let totalBytes = 0;
  for (const path of paths) {
    let reason = ignoredTracked.has(path) ? 'Tracked file matches Git ignore rules.' : fileExclusionReason(path);
    if (!reason && !TEXT_EXTENSIONS.test(path) && !/(?:^|\/)(?:Dockerfile|Makefile|LICENSE|README)$/i.test(path)) reason = 'Unsupported or non-source file extension.';
    const absolute = resolve(root, path);
    const relativePath = relative(root, absolute);
    if (outside(relativePath)) throw new Error('Git returned a path outside the selected directory.');
    if (exclusions.has(pathKey(absolute))) reason = 'Output file excluded from its own input.';
    if (reason) { excluded.push({ path, reason }); continue; }
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink() || !info.isFile()) { excluded.push({ path, reason: 'Symlinks and non-regular files are not read.' }); continue; }
      const resolved = await realpath(absolute);
      if (exclusions.has(pathKey(resolved))) { excluded.push({ path, reason: 'Output file excluded from its own input.' }); continue; }
      const inside = relative(root, resolved);
      if (outside(inside)) { excluded.push({ path, reason: 'Resolved file is outside the selected directory.' }); continue; }
      if (info.size > MAX_BYTES) { excluded.push({ path, reason: 'File exceeds 100 KiB.' }); continue; }
      const content = await readBoundedFile(resolved);
      if (content.includes('\0')) { excluded.push({ path, reason: 'Binary content is not included.' }); continue; }
      totalBytes += Buffer.byteLength(content, 'utf8');
      if (files.length >= 100 || totalBytes > 1024 * 1024) {
        throw new Error('Repository scope exceeds 100 source files or 1 MiB. Select a smaller --repo subdirectory; no partial pack was produced.');
      }
      files.push({ path: path.replaceAll('\\', '/'), content });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Repository scope')) throw error;
      excluded.push({ path, reason: 'Unreadable, changed, oversized, or non-UTF-8 file.' });
    }
  }
  if (!files.length) throw new Error('No eligible UTF-8 source files were found in the selected directory.');
  return { root, files, excluded };
}
