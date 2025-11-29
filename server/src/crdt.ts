import * as fs from 'node:fs/promises';
import * as Automerge from '@automerge/automerge';
import { ensureDataDir, resolveDataPath, writeFileAtomic } from './persist.js';
import { BulletinDoc } from './types.js';

const BULLETINS_FILE = resolveDataPath('bulletins.bin');

export async function loadBulletinDoc(): Promise<Automerge.Doc<BulletinDoc>> {
  await ensureDataDir();
  try {
    const bytes = await fs.readFile(BULLETINS_FILE);
    return Automerge.load<BulletinDoc>(bytes);
  } catch {
    return Automerge.from<BulletinDoc>({ bulletins: [] });
  }
}

export async function saveBulletinDoc(doc: Automerge.Doc<BulletinDoc>): Promise<void> {
  await ensureDataDir();
  const bytes = Automerge.save(doc);
  await writeFileAtomic(BULLETINS_FILE, bytes);
}
