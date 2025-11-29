import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import type { Visibility, UserId } from './types.js';

export interface RegistryEntryRow {
  id: string;
  ownerId: string;
  name: string;
  visibility: Visibility;
  archived: boolean;
  collaborators: Record<UserId, true>;
  createdAt: string;
  updatedAt?: string;
}

async function fetchCollaborators(db: mysql.Pool, listId: string): Promise<Record<UserId, true>> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    'SELECT user_id FROM list_collaborators WHERE list_id = ?',
    [listId]
  );
  const rec: Record<UserId, true> = {};
  for (const row of rows) {
    rec[row.user_id as UserId] = true;
  }
  return rec;
}

export async function fetchAccessibleRegistry(
  db: mysql.Pool,
  userId: UserId
): Promise<RegistryEntryRow[]> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `
    SELECT l.id, l.owner_id, l.name, l.visibility, l.archived, l.created_at, l.updated_at
    FROM lists l
    LEFT JOIN list_collaborators c ON l.id = c.list_id AND c.user_id = ?
    WHERE l.visibility = 'public' OR l.owner_id = ? OR c.user_id = ?
    GROUP BY l.id
    ORDER BY l.created_at DESC
    `,
    [userId, userId, userId]
  );

  const entries: RegistryEntryRow[] = [];
  for (const row of rows) {
    const collaborators = await fetchCollaborators(db, row.id as string);
    entries.push({
      id: row.id as string,
      ownerId: row.owner_id as string,
      name: row.name as string,
      visibility: row.visibility as Visibility,
      archived: Boolean(row.archived),
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: row.updated_at ? (row.updated_at as Date).toISOString() : undefined,
      collaborators
    });
  }
  return entries;
}

export async function fetchRegistryEntry(
  db: mysql.Pool,
  listId: string
): Promise<RegistryEntryRow | null> {
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT id, owner_id, name, visibility, archived, created_at, updated_at FROM lists WHERE id = ?`,
    [listId]
  );
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  const collaborators = await fetchCollaborators(db, row.id as string);
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    name: row.name as string,
    visibility: row.visibility as Visibility,
    archived: Boolean(row.archived),
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: row.updated_at ? (row.updated_at as Date).toISOString() : undefined,
    collaborators
  };
}

export async function createListEntry(
  db: mysql.Pool,
  ownerId: UserId,
  name: string,
  visibility: Visibility,
  collaborators: UserId[]
): Promise<string> {
  const listId = randomUUID();
  const now = new Date();
  const cleanedCollaborators = normalizeCollaborators(collaborators, ownerId);
  await db.query(
    `INSERT INTO lists (id, owner_id, name, visibility, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, FALSE, ?, NULL)`,
    [listId, ownerId, name, visibility, now]
  );
  await setCollaborators(db, listId, cleanedCollaborators);
  return listId;
}

export async function renameList(
  db: mysql.Pool,
  listId: string,
  userId: UserId,
  name: string
): Promise<void> {
  const entry = await fetchRegistryEntry(db, listId);
  ensureOwner(entry, userId);
  const now = new Date();
  await db.query(`UPDATE lists SET name = ?, updated_at = ? WHERE id = ?`, [name, now, listId]);
}

export async function updateListVisibility(
  db: mysql.Pool,
  listId: string,
  userId: UserId,
  visibility: Visibility
): Promise<void> {
  const entry = await fetchRegistryEntry(db, listId);
  ensureOwner(entry, userId);
  const now = new Date();
  await db.query(`UPDATE lists SET visibility = ?, updated_at = ? WHERE id = ?`, [
    visibility,
    now,
    listId
  ]);
}

export async function setCollaborators(
  db: mysql.Pool,
  listId: string,
  collaborators: UserId[]
): Promise<void> {
  await db.query(`DELETE FROM list_collaborators WHERE list_id = ?`, [listId]);
  if (collaborators.length === 0) {
    return;
  }
  const placeholders = collaborators.map(() => '(?, ?)').join(', ');
  const params: (string | UserId)[] = collaborators.flatMap((id) => [listId, id]);
  await db.query(`INSERT INTO list_collaborators (list_id, user_id) VALUES ${placeholders}`, params);
}

export async function archiveList(
  db: mysql.Pool,
  listId: string,
  userId: UserId,
  archived: boolean
): Promise<void> {
  const entry = await fetchRegistryEntry(db, listId);
  ensureOwner(entry, userId);
  const now = new Date();
  await db.query(`UPDATE lists SET archived = ?, updated_at = ? WHERE id = ?`, [
    archived,
    now,
    listId
  ]);
}

export async function deleteList(
  db: mysql.Pool,
  listId: string,
  userId: UserId
): Promise<void> {
  const entry = await fetchRegistryEntry(db, listId);
  ensureOwner(entry, userId);
  await db.query(`DELETE FROM lists WHERE id = ?`, [listId]);
}

function ensureOwner(entry: RegistryEntryRow | null, userId: UserId): void {
  if (!entry) {
    throw new Error('List not found');
  }
  if (entry.ownerId !== userId) {
    throw new Error('Forbidden');
  }
}

export function isListVisibleTo(entry: RegistryEntryRow, userId: UserId): boolean {
  if (entry.visibility === 'public') {
    return true;
  }
  if (entry.ownerId === userId) {
    return true;
  }
  return Boolean(entry.collaborators[userId]);
}

function normalizeCollaborators(collaborators: UserId[], ownerId: UserId): UserId[] {
  const set = new Set<UserId>();
  for (const id of collaborators) {
    const trimmed = id?.trim();
    if (!trimmed || trimmed === ownerId) continue;
    set.add(trimmed);
  }
  return Array.from(set);
}
