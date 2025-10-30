import * as fs from 'node:fs/promises';
import * as Automerge from '@automerge/automerge';
import { ensureDataDir, resolveDataPath, writeFileAtomic } from './persist.js';
import { BoardDoc } from './types.js';

const BOARD_FILE = resolveDataPath('board.bin');

export async function loadDoc(): Promise<Automerge.Doc<BoardDoc>> {
  try {
    const bytes = await fs.readFile(BOARD_FILE);
    return Automerge.load<BoardDoc>(bytes);
  } catch (error: unknown) {
    await ensureDataDir();
    return Automerge.from<BoardDoc>({ posts: [] });
  }
}

export async function saveDoc(doc: Automerge.Doc<BoardDoc>): Promise<void> {
  await ensureDataDir();
  const bytes = Automerge.save(doc);
  await writeFileAtomic(BOARD_FILE, bytes);
}
