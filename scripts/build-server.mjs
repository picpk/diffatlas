import { build } from 'esbuild';

await build({
  entryPoints: { index: 'server/index.ts', cli: 'cli.ts', 'context-cli': 'context-cli.ts' },
  outdir: 'dist-server',
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
});
