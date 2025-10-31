import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const LISTS_DIR = path.join(DATA_DIR, 'lists');

export function resolveDataPath(fileName: string): string {
  return path.join(DATA_DIR, fileName);
}

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function ensureListsDir(): Promise<void> {
  await fs.mkdir(LISTS_DIR, { recursive: true });
}

export async function writeFileAtomic(targetPath: string, data: Uint8Array): Promise<void> {
  const tmpPath = `${targetPath}.tmp`;
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, targetPath);
}

export function resolveListPath(listId: string): string {
  return path.join(LISTS_DIR, `${listId}.bin`);
}
