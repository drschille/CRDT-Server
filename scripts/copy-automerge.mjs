#!/usr/bin/env node
import { cp, rm, stat, readFile, writeFile } from 'node:fs/promises';
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
  await patchUuid(path.join(DEST, 'uuid.js'));
  console.log('Copied Automerge ESM dist to', DEST);
}

async function patchUuid(filePath) {
  try {
    const original = await readFile(filePath, 'utf8');
    if (original.includes('crypto.randomUUID')) {
      return;
    }
    const patched = `function defaultFactory() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  const bytes = (typeof crypto !== "undefined" && crypto.getRandomValues)
    ? crypto.getRandomValues(new Uint8Array(16))
    : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return hex;
}
let factory = defaultFactory;
export const uuid = () => factory();
uuid.setFactory = (newFactory) => {
  factory = newFactory;
};
uuid.reset = () => {
  factory = defaultFactory;
};
`;
    await writeFile(filePath, patched, 'utf8');
  } catch (error) {
    console.warn('Failed to patch uuid.js', error);
  }
}

main().catch((error) => {
  console.error('Failed to copy Automerge ESM dist:', error);
  process.exitCode = 1;
});
