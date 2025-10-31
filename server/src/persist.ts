import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
  const dir = path.dirname(targetPath);
  const baseName = path.basename(targetPath);
  const tmpPath = path.join(dir, `${baseName}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  await fs.writeFile(tmpPath, data);
  try {
    await fs.rename(tmpPath, targetPath);
  } catch (error) {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}

export function resolveListPath(listId: string): string {
  return path.join(LISTS_DIR, `${listId}.bin`);
}
