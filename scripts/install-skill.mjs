import { cp, lstat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildSkill } from './build-skill.mjs';

export async function installSkill(source, destination) {
  const target = resolve(destination);
  try {
    await lstat(target);
    throw new Error(`Destination already exists: ${target}. Back up or rename that folder first, or use --dest with a new folder.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: false, errorOnExist: true });
  return target;
}

async function main() {
  const { values } = parseArgs({ options: { dest: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    process.stdout.write('Usage: npm run install:skill -- [--dest <exact-skill-directory>]\nDefault: $CODEX_HOME/skills/diffatlas-context, or ~/.codex/skills/diffatlas-context.\nBuilds a self-contained Node runtime. Existing destinations are never overwritten.\n');
    return;
  }
  const destination = values.dest ?? join(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'), 'skills', 'diffatlas-context');
  const target = await installSkill(await buildSkill(), destination);
  process.stdout.write(`Installed DiffAtlas Context at ${target}\nInvoke $diffatlas-context in a new Agent session, or run: node "${join(target, 'scripts', 'pack.mjs')}" --help\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
