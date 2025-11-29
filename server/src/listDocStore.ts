import * as Automerge from '@automerge/automerge';
import mysql from 'mysql2/promise';
import type { ListId, ShoppingListDoc } from './types.js';

const listDocCache = new Map<ListId, Automerge.Doc<ShoppingListDoc>>();
const dirtyListIds = new Set<ListId>();

export function getCachedListDoc(listId: ListId): Automerge.Doc<ShoppingListDoc> | undefined {
  return listDocCache.get(listId);
}

export async function loadListDoc(db: mysql.Pool, listId: ListId): Promise<Automerge.Doc<ShoppingListDoc>> {
  const cached = listDocCache.get(listId);
  if (cached) {
    return cached;
  }

  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT doc FROM list_docs WHERE list_id = ?`,
    [listId]
  );

  let doc: Automerge.Doc<ShoppingListDoc>;
  if (rows.length === 0) {
    doc = Automerge.from<ShoppingListDoc>({ listId, items: [] });
  } else {
    const buf = rows[0].doc as Buffer;
    doc = Automerge.load<ShoppingListDoc>(new Uint8Array(buf));
    if (!doc.listId) {
      doc = Automerge.change(doc, 'set_list_id', (draft) => {
        draft.listId = listId;
      });
    }
  }

  listDocCache.set(listId, doc);
  return doc;
}

export function markListDocDirty(listId: ListId, doc: Automerge.Doc<ShoppingListDoc>): void {
  listDocCache.set(listId, doc);
  dirtyListIds.add(listId);
}

export async function flushDirtyListDocs(db: mysql.Pool): Promise<void> {
  if (dirtyListIds.size === 0) return;
  const ids = Array.from(dirtyListIds);
  for (const listId of ids) {
    const doc = listDocCache.get(listId);
    if (!doc) {
      dirtyListIds.delete(listId);
      continue;
    }
    const bytes = Automerge.save(doc);
    const now = new Date();
    await db.query(
      `
      INSERT INTO list_docs (list_id, doc, updated_at)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE doc = VALUES(doc), updated_at = VALUES(updated_at)
      `,
      [listId, Buffer.from(bytes), now]
    );
    dirtyListIds.delete(listId);
  }
}

export function forgetListDoc(listId: ListId): void {
  listDocCache.delete(listId);
  dirtyListIds.delete(listId);
}
