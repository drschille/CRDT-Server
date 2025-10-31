import * as fs from 'node:fs/promises';
import * as Automerge from '@automerge/automerge';
import {
  ensureDataDir,
  ensureListsDir,
  resolveDataPath,
  resolveListPath,
  writeFileAtomic
} from './persist.js';
import {
  BulletinDoc,
  ListId,
  ListRegistryDoc,
  ShoppingListDoc
} from './types.js';

const REGISTRY_FILE = resolveDataPath('registry.bin');
const BULLETINS_FILE = resolveDataPath('bulletins.bin');

const listDocCache = new Map<ListId, Automerge.Doc<ShoppingListDoc>>();

export async function loadRegistryDoc(): Promise<Automerge.Doc<ListRegistryDoc>> {
  await ensureDataDir();
  try {
    const bytes = await fs.readFile(REGISTRY_FILE);
    return Automerge.load<ListRegistryDoc>(bytes);
  } catch {
    return Automerge.from<ListRegistryDoc>({ lists: [] });
  }
}

export async function saveRegistryDoc(doc: Automerge.Doc<ListRegistryDoc>): Promise<void> {
  await ensureDataDir();
  const bytes = Automerge.save(doc);
  await writeFileAtomic(REGISTRY_FILE, bytes);
}

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

export async function loadListDoc(listId: ListId): Promise<Automerge.Doc<ShoppingListDoc>> {
  const cached = listDocCache.get(listId);
  if (cached) {
    return cached;
  }

  await ensureListsDir();
  const filePath = resolveListPath(listId);
  let doc: Automerge.Doc<ShoppingListDoc>;

  try {
    const bytes = await fs.readFile(filePath);
    doc = Automerge.load<ShoppingListDoc>(bytes);
  } catch {
    doc = Automerge.from<ShoppingListDoc>({ listId, items: [] });
  }

  listDocCache.set(listId, doc);
  return doc;
}

export async function saveListDoc(listId: ListId, doc: Automerge.Doc<ShoppingListDoc>): Promise<void> {
  await ensureListsDir();
  const filePath = resolveListPath(listId);
  const bytes = Automerge.save(doc);
  listDocCache.set(listId, doc);
  await writeFileAtomic(filePath, bytes);
}

export async function deleteListDoc(listId: ListId): Promise<void> {
  const filePath = resolveListPath(listId);
  listDocCache.delete(listId);
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore missing file
  }
}

export function forgetListDoc(listId: ListId): void {
  listDocCache.delete(listId);
}
