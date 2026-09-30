/**
 * `bun run build` — bundle both Lambda functions and package their zip artefacts.
 *
 * The AWS SDK v3 is left external: the Lambda runtime provides it, which
 * keeps the artefact small and avoids shipping a second copy of the SDK. `pg` and
 * `zod` are bundled (the runtime does not provide them), while the optional native
 * `pg-native` binding stays external so `pg` falls back to its JavaScript driver.
 *
 * The dashboard's static files are copied beside the API bundle, which is how the
 * Lambda serves `GET /`, `/app.js` and `/styles.css` from the same origin.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { build } from 'esbuild';

import { createZip } from './zip';
import type { ZipEntry } from './zip';

const ROOT = process.cwd();
const BUILD_DIR = path.join(ROOT, 'build');
const STATIC_DIR = path.join(ROOT, 'dashboard', 'static');

const EXTERNAL = ['@aws-sdk/*', 'pg-native', '@smithy/*'];

async function bundle(entry: string, outfile: string): Promise<number> {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: false,
    minify: false,
    logLevel: 'warning',
    external: EXTERNAL,
  });
  const contents = await readFile(outfile);
  return contents.length;
}

async function collectStatic(prefix: string): Promise<ZipEntry[]> {
  const names = await readdir(STATIC_DIR);
  const entries: ZipEntry[] = [];
  for (const name of names.sort()) {
    entries.push({ name: `${prefix}${name}`, data: await readFile(path.join(STATIC_DIR, name)) });
  }
  return entries;
}

async function main(): Promise<void> {
  await rm(BUILD_DIR, { recursive: true, force: true });
  await mkdir(path.join(BUILD_DIR, 'api'), { recursive: true });
  await mkdir(path.join(BUILD_DIR, 'clustering'), { recursive: true });

  const apiBytes = await bundle(
    path.join(ROOT, 'src', 'lambda', 'api-lambda.ts'),
    path.join(BUILD_DIR, 'api', 'index.js'),
  );
  const clusteringBytes = await bundle(
    path.join(ROOT, 'src', 'lambda', 'clustering-lambda.ts'),
    path.join(BUILD_DIR, 'clustering', 'index.js'),
  );

  const staticEntries = await collectStatic('static/');

  const apiZip = createZip([
    { name: 'index.js', data: await readFile(path.join(BUILD_DIR, 'api', 'index.js')) },
    ...staticEntries,
  ]);
  await writeFile(path.join(BUILD_DIR, 'api.zip'), apiZip);

  const clusteringZip = createZip([
    { name: 'index.js', data: await readFile(path.join(BUILD_DIR, 'clustering', 'index.js')) },
  ]);
  await writeFile(path.join(BUILD_DIR, 'clustering.zip'), clusteringZip);

  console.log(`[build] api bundle      ${apiBytes} bytes (index.js + ${staticEntries.length} static file(s))`);
  console.log(`[build] clustering      ${clusteringBytes} bytes`);
  console.log(`[build] build/api.zip        ${apiZip.length} bytes`);
  console.log(`[build] build/clustering.zip ${clusteringZip.length} bytes`);
}

void main();
