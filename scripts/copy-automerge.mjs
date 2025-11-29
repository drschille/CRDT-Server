#!/usr/bin/env node
import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC = path.resolve(
  __dirname,
  '..',
  'node_modules',
  '.pnpm',
  '@automerge+automerge@2.2.9',
  'node_modules',
  '@automerge',
  'automerge',
  'dist',
  'mjs'
);
const DEST = path.resolve(__dirname, '..', 'web', 'vendor', 'automerge');

async function main() {
  try {
    await stat(SRC);
  } catch (error) {
    console.error('Automerge ESM build not found. Did you run `pnpm install`?', error?.message ?? error);
    process.exitCode = 1;
    return;
  }

  await rm(DEST, { recursive: true, force: true });
  await cp(SRC, DEST, { recursive: true });
  console.log('Copied Automerge ESM dist to', DEST);
}

main().catch((error) => {
  console.error('Failed to copy Automerge ESM dist:', error);
  process.exitCode = 1;
});
