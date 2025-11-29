import * as Automerge from '@automerge/automerge';
import mysql from 'mysql2/promise';
import type { BulletinDoc } from './types.js';

export async function loadBulletinDoc(db: mysql.Pool): Promise<Automerge.Doc<BulletinDoc>> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT doc FROM bulletin_docs WHERE id = 1`
  );
  if (rows.length === 0) {
    return Automerge.from<BulletinDoc>({ bulletins: [] });
  }
  const buf = rows[0].doc as Buffer;
  return Automerge.load<BulletinDoc>(new Uint8Array(buf));
}

export async function saveBulletinDoc(
  db: mysql.Pool,
  doc: Automerge.Doc<BulletinDoc>
): Promise<void> {
  const bytes = Automerge.save(doc);
  const now = new Date();
  await db.query(
    `
    INSERT INTO bulletin_docs (id, doc, updated_at)
    VALUES (1, ?, ?)
    ON DUPLICATE KEY UPDATE doc = VALUES(doc), updated_at = VALUES(updated_at)
    `,
    [Buffer.from(bytes), now]
  );
}
