import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as Automerge from '@automerge/automerge';
import type { BoardDoc } from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'board.bin');

export async function loadDoc(): Promise<Automerge.Doc<BoardDoc>> {
  try {
    const buf = await fs.readFile(DATA_FILE);
    return Automerge.load<BoardDoc>(buf);
  } catch (error) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    return Automerge.from<BoardDoc>({ posts: [] });
  }
}

export async function saveDoc(doc: Automerge.Doc<BoardDoc>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const bin = Automerge.save(doc);
  const tmp = DATA_FILE + '.tmp';
  await fs.writeFile(tmp, bin);
  await fs.rename(tmp, DATA_FILE);
}
