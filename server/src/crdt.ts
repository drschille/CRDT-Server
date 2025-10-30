import * as fs from 'node:fs/promises';
import * as Automerge from '@automerge/automerge';
import { ensureDataDir, resolveDataPath, writeFileAtomic } from './persist.js';
import { BoardDoc } from './types.js';

const BOARD_FILE = resolveDataPath('board.bin');

export async function loadDoc(): Promise<Automerge.Doc<BoardDoc>> {
  try {
    const bytes = await fs.readFile(BOARD_FILE);
    const loaded = Automerge.load<BoardDoc>(bytes);
    return migrateLegacyPosts(loaded);
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

function migrateLegacyPosts(doc: Automerge.Doc<BoardDoc>): Automerge.Doc<BoardDoc> {
  const needsMigration = doc.posts.some((post) => typeof (post.text as unknown) === 'string');
  if (!needsMigration && doc.posts.every((post) => post.lastEditedBy)) {
    return doc;
  }

  return Automerge.change(doc, 'migrate_post_text_to_crdt', (draft) => {
    for (const post of draft.posts) {
      const raw = post.text as unknown;
      if (typeof raw === 'string') {
        post.text = createText(raw);
      }
      if (!post.lastEditedBy) {
        post.lastEditedBy = post.authorId;
      }
    }
  });
}

function createText(initial: string): Automerge.Text {
  const text = new Automerge.Text();
  if (initial.length > 0) {
    text.insertAt(0, ...initial);
  }
  return text;
}
