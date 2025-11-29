import * as Automerge from '@automerge/automerge';
import { randomUUID } from 'node:crypto';
import {
  BulletinDoc,
  BulletinId,
  ListId,
  ListRegistryDoc,
  ListRegistryEntry,
  ListItem,
  ShoppingListDoc,
  UserId,
  Visibility
} from './types.js';

export interface ListAccess {
  ownerId: UserId;
  visibility: Visibility;
  collaborators: Record<UserId, true>;
  archived?: boolean;
}

export const MAX_NAME_LENGTH = 200;
export const MAX_NOTES_LENGTH = 2000;
export const MAX_STRING_FIELD_LENGTH = 200;
export const MAX_LISTS_PER_USER = 200;
export const MAX_ITEMS_PER_LIST = 1000;
export const MAX_BULLETIN_TEXT = 2000;

// Registry actions -------------------------------------------------------------

export function createList(
  doc: Automerge.Doc<ListRegistryDoc>,
  userId: UserId,
  rawName: string,
  visibility: Visibility = 'private',
  collaborators: UserId[] = []
): { doc: Automerge.Doc<ListRegistryDoc>; listId: ListId } {
  const name = requireListName(rawName);
  const cleanedCollabs = uniqueCollaborators(collaborators, userId);

  const ownedCount = doc.lists.filter((entry) => entry.ownerId === userId && !entry.archived).length;
  if (ownedCount >= MAX_LISTS_PER_USER) {
    throw new Error('List limit reached');
  }

  const listId = randomUUID();
  const next = Automerge.change(doc, 'create_list', (draft) => {
    draft.lists.push({
      id: listId,
      ownerId: userId,
      name: toText(name),
      createdAt: new Date().toISOString(),
      visibility,
      collaborators: arrayToRecord(cleanedCollabs),
      archived: false
    });
  });

  return { doc: next, listId };
}

export function renameList(
  doc: Automerge.Doc<ListRegistryDoc>,
  userId: UserId,
  listId: ListId,
  rawName: string
): Automerge.Doc<ListRegistryDoc> {
  const name = requireListName(rawName);
  return Automerge.change(doc, 'rename_list', (draft) => {
    const entry = requireListEntry(draft, listId);
    ensureCanEditMetadata(entry, userId);
    replaceText(entry.name, name);
    entry.updatedAt = new Date().toISOString();
  });
}

export function updateListVisibility(
  doc: Automerge.Doc<ListRegistryDoc>,
  userId: UserId,
  listId: ListId,
  visibility: Visibility
): Automerge.Doc<ListRegistryDoc> {
  return Automerge.change(doc, 'update_list_visibility', (draft) => {
    const entry = requireListEntry(draft, listId);
    ensureOwner(entry, userId);
    entry.visibility = visibility;
    entry.updatedAt = new Date().toISOString();
  });
}

export function setCollaborators(
  doc: Automerge.Doc<ListRegistryDoc>,
  userId: UserId,
  listId: ListId,
  collaborators: UserId[]
): Automerge.Doc<ListRegistryDoc> {
  return Automerge.change(doc, 'set_collaborators', (draft) => {
    const entry = requireListEntry(draft, listId);
    ensureOwner(entry, userId);
    entry.collaborators = arrayToRecord(uniqueCollaborators(collaborators, userId));
    entry.updatedAt = new Date().toISOString();
  });
}

export function archiveList(
  doc: Automerge.Doc<ListRegistryDoc>,
  userId: UserId,
  listId: ListId,
  archived: boolean
): Automerge.Doc<ListRegistryDoc> {
  return Automerge.change(doc, archived ? 'archive_list' : 'restore_list', (draft) => {
    const entry = requireListEntry(draft, listId);
    ensureOwner(entry, userId);
    entry.archived = archived;
    entry.updatedAt = new Date().toISOString();
  });
}

export function deleteListEntry(
  doc: Automerge.Doc<ListRegistryDoc>,
  userId: UserId,
  listId: ListId
): Automerge.Doc<ListRegistryDoc> {
  return Automerge.change(doc, 'delete_list', (draft) => {
    const index = draft.lists.findIndex((entry) => entry.id === listId);
    if (index === -1) {
      throw new Error('List not found');
    }
    ensureOwner(draft.lists[index]!, userId);
    draft.lists.splice(index, 1);
  });
}

// List document actions --------------------------------------------------------

export function addItem(
  doc: Automerge.Doc<ShoppingListDoc>,
  entry: ListAccess,
  userId: UserId,
  rawLabel: string,
  quantity?: string,
  vendor?: string
): Automerge.Doc<ShoppingListDoc> {
  ensureListEditable(entry, userId);
  const label = requireItemLabel(rawLabel);

  if (doc.items.length >= MAX_ITEMS_PER_LIST) {
    throw new Error('Item limit reached');
  }

  return Automerge.change(doc, 'add_item', (draft) => {
    const item: ListItem = {
      id: randomUUID(),
      label: toText(label),
      createdAt: new Date().toISOString(),
      addedBy: userId,
      checked: false
    };
    const qty = trimOptionalField(quantity);
    if (qty) {
      item.quantity = qty;
    }
    const vend = trimOptionalField(vendor);
    if (vend) {
      item.vendor = vend;
    }
    draft.items.push(item);
  });
}

export function updateItemLabel(
  doc: Automerge.Doc<ShoppingListDoc>,
  entry: ListAccess,
  userId: UserId,
  itemId: string,
  rawLabel: string
): Automerge.Doc<ShoppingListDoc> {
  ensureListEditable(entry, userId);
  const label = requireItemLabel(rawLabel);

  return Automerge.change(doc, 'update_item', (draft) => {
    const item = requireListItem(draft, itemId);
    replaceText(item.label, label);
  });
}

export function setItemQuantity(
  doc: Automerge.Doc<ShoppingListDoc>,
  entry: ListAccess,
  userId: UserId,
  itemId: string,
  quantity?: string
): Automerge.Doc<ShoppingListDoc> {
  ensureListEditable(entry, userId);
  return Automerge.change(doc, 'set_item_quantity', (draft) => {
    const item = requireListItem(draft, itemId);
    const trimmed = trimOptionalField(quantity);
    if (trimmed) {
      item.quantity = trimmed;
    } else {
      delete item.quantity;
    }
  });
}

export function setItemVendor(
  doc: Automerge.Doc<ShoppingListDoc>,
  entry: ListAccess,
  userId: UserId,
  itemId: string,
  vendor?: string
): Automerge.Doc<ShoppingListDoc> {
  ensureListEditable(entry, userId);
  return Automerge.change(doc, 'set_item_vendor', (draft) => {
    const item = requireListItem(draft, itemId);
    const trimmed = trimOptionalField(vendor);
    if (trimmed) {
      item.vendor = trimmed;
    } else {
      delete item.vendor;
    }
  });
}

export function setItemNotes(
  doc: Automerge.Doc<ShoppingListDoc>,
  entry: ListAccess,
  userId: UserId,
  itemId: string,
  notes?: string
): Automerge.Doc<ShoppingListDoc> {
  ensureListEditable(entry, userId);
  const trimmed = trimNotes(notes);
  return Automerge.change(doc, 'set_item_notes', (draft) => {
    const item = requireListItem(draft, itemId);
    if (trimmed) {
      item.notes = toText(trimmed);
    } else {
      delete item.notes;
    }
  });
}

export function toggleItemChecked(
  doc: Automerge.Doc<ShoppingListDoc>,
  entry: ListAccess,
  userId: UserId,
  itemId: string,
  checked: boolean
): Automerge.Doc<ShoppingListDoc> {
  ensureListEditable(entry, userId);
  return Automerge.change(doc, 'toggle_item_checked', (draft) => {
    const item = requireListItem(draft, itemId);
    item.checked = checked;
  });
}

export function removeItem(
  doc: Automerge.Doc<ShoppingListDoc>,
  entry: ListAccess,
  userId: UserId,
  itemId: string
): Automerge.Doc<ShoppingListDoc> {
  ensureListEditable(entry, userId);
  return Automerge.change(doc, 'remove_item', (draft) => {
    const index = draft.items.findIndex((item) => item.id === itemId);
    if (index === -1) {
      throw new Error('Item not found');
    }
    draft.items.splice(index, 1);
  });
}

// Bulletin actions -------------------------------------------------------------

export function addBulletin(
  doc: Automerge.Doc<BulletinDoc>,
  userId: UserId,
  rawText: string,
  visibility: Visibility = 'public'
): Automerge.Doc<BulletinDoc> {
  const text = requireBulletinText(rawText);
  return Automerge.change(doc, 'add_bulletin', (draft) => {
    draft.bulletins.push({
      id: randomUUID(),
      authorId: userId,
      text: toText(text),
      createdAt: new Date().toISOString(),
      visibility
    });
  });
}

export function editBulletin(
  doc: Automerge.Doc<BulletinDoc>,
  userId: UserId,
  bulletinId: BulletinId,
  rawText: string
): Automerge.Doc<BulletinDoc> {
  const text = requireBulletinText(rawText);
  return Automerge.change(doc, 'edit_bulletin', (draft) => {
    const bulletin = draft.bulletins.find((b) => b.id === bulletinId);
    if (!bulletin) {
      throw new Error('Bulletin not found');
    }
    if (bulletin.authorId !== userId) {
      throw new Error('Forbidden');
    }
    replaceText(bulletin.text, text);
    bulletin.editedAt = new Date().toISOString();
  });
}

export function deleteBulletin(
  doc: Automerge.Doc<BulletinDoc>,
  userId: UserId,
  bulletinId: BulletinId
): Automerge.Doc<BulletinDoc> {
  return Automerge.change(doc, 'delete_bulletin', (draft) => {
    const index = draft.bulletins.findIndex((b) => b.id === bulletinId);
    if (index === -1) {
      throw new Error('Bulletin not found');
    }
    if (draft.bulletins[index]!.authorId !== userId) {
      throw new Error('Forbidden');
    }
    draft.bulletins.splice(index, 1);
  });
}

// Helpers ----------------------------------------------------------------------

function requireListEntry(doc: ListRegistryDoc, listId: ListId): ListRegistryEntry {
  const entry = doc.lists.find((l) => l.id === listId);
  if (!entry) {
    throw new Error('List not found');
  }
  return entry;
}

function ensureOwner(entry: ListRegistryEntry, userId: UserId): void {
  if (entry.ownerId !== userId) {
    throw new Error('Forbidden');
  }
}

function ensureCanEditMetadata(entry: ListAccess, userId: UserId): void {
  if (entry.ownerId === userId) {
    return;
  }
  if (entry.collaborators[userId]) {
    return;
  }
  throw new Error('Forbidden');
}

function ensureListEditable(entry: ListAccess, userId: UserId): void {
  if (entry.archived) {
    throw new Error('List is archived');
  }
  if (entry.visibility === 'public') {
    return;
  }
  ensureCanEditMetadata(entry, userId);
}

function requireListItem(doc: ShoppingListDoc, itemId: string): ShoppingListDoc['items'][number] {
  const item = doc.items.find((i) => i.id === itemId);
  if (!item) {
    throw new Error('Item not found');
  }
  return item;
}

function requireListName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Name required');
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error('Name too long');
  }
  return trimmed;
}

function requireItemLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Label required');
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error('Label too long');
  }
  return trimmed;
}

function requireBulletinText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Text must be non-empty');
  }
  if (trimmed.length > MAX_BULLETIN_TEXT) {
    throw new Error('Text exceeds allowed length');
  }
  return trimmed;
}

function trimOptionalField(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, MAX_STRING_FIELD_LENGTH);
}

function trimNotes(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > MAX_NOTES_LENGTH) {
    throw new Error('Notes too long');
  }
  return trimmed;
}

function toText(value: string): Automerge.Text {
  const text = new Automerge.Text();
  if (value.length > 0) {
    text.insertAt(0, ...value);
  }
  return text;
}

function replaceText(target: Automerge.Text, next: string): void {
  for (let i = target.length - 1; i >= 0; i -= 1) {
    target.deleteAt(i);
  }
  if (next.length > 0) {
    target.insertAt(0, ...next);
  }
}

function uniqueCollaborators(collaborators: UserId[], ownerId: UserId): UserId[] {
  const set = new Set<UserId>();
  for (const id of collaborators) {
    const trimmed = id?.trim();
    if (!trimmed || trimmed === ownerId) {
      continue;
    }
    set.add(trimmed);
  }
  return Array.from(set);
}

function arrayToRecord(ids: UserId[]): Record<UserId, true> {
  return Object.fromEntries(ids.map((id) => [id, true] as const));
}
