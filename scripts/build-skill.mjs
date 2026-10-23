import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const skillPackagePath = join(projectRoot, '.local', 'skill-package', 'diffatlas-context');

export async function buildSkill() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node.js 22.12 or newer is required.');
  await mkdir(join(skillPackagePath, 'scripts'), { recursive: true });
  await cp(join(projectRoot, 'skills', 'diffatlas-context'), skillPackagePath, { recursive: true });
  const result = await build({
    absWorkingDir: projectRoot,
    entryPoints: ['agent-cli.ts'],
    outfile: join(skillPackagePath, 'scripts', 'pack.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node22.12',
    format: 'esm',
    minify: true,
    legalComments: 'eof',
    // TypeScript's bundled CommonJS uses Node builtins. Resolve those from this
    // installed file rather than depending on the original checkout.
    banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; import { fileURLToPath as bundleFilePath } from 'node:url'; import { dirname as bundleDirectory } from 'node:path'; const require = createNodeRequire(import.meta.url); const __filename = bundleFilePath(import.meta.url); const __dirname = bundleDirectory(__filename);" },
    metafile: true,
    logLevel: 'warning',
  });
  const bundledPackages = [...new Set(Object.keys(result.metafile.inputs)
    .filter(path => path.replaceAll('\\', '/').includes('node_modules/'))
    .map(path => path.replaceAll('\\', '/').split('node_modules/').at(-1).split('/')[0]))].sort();
  const licenses = { 'gpt-tokenizer': 'LICENSE', typescript: 'LICENSE.txt' };
  const notices = ['DiffAtlas Context bundles the following dependencies. Their original license texts follow.\n'];
  for (const dependency of bundledPackages) {
    if (!licenses[dependency]) throw new Error(`Add the license notice for new bundled dependency: ${dependency}`);
    const directory = join(projectRoot, 'node_modules', dependency);
    const info = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    notices.push(`\n=== ${dependency} ${info.version} ===\n\n${await readFile(join(directory, licenses[dependency]), 'utf8')}`);
  }
  await cp(join(projectRoot, 'LICENSE'), join(skillPackagePath, 'LICENSE'));
  await writeFile(join(skillPackagePath, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'), 'utf8');
  const { version } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  await writeFile(join(skillPackagePath, 'skill-package.json'), JSON.stringify({ name: 'diffatlas-context', version, node: '>=22.12.0', requires: ['git'], bundledPackages }, null, 2) + '\n');
  return skillPackagePath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildSkill().then(path => process.stdout.write(`Skill package ready: ${path}\n`)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
