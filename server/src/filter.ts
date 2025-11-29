import {
  BulletinDoc,
  FilteredBulletin,
  FilteredItem,
  FilteredListDoc,
  FilteredRegistryEntry,
  ListRegistryDoc,
  ListRegistryEntry,
  ShoppingListDoc,
  UserId
} from './types.js';

export function filterRegistryDoc(doc: ListRegistryDoc, userId: UserId): FilteredRegistryEntry[] {
  return doc.lists
    .filter((entry) => isListVisibleTo(entry, userId))
    .map((entry) => ({
      id: entry.id,
      ownerId: entry.ownerId,
      name: entry.name.toString(),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      visibility: entry.visibility,
      collaborators: entry.collaborators,
      archived: entry.archived
    }));
}

export function filterListDoc(
  doc: ShoppingListDoc,
  entry: ListRegistryEntry,
  userId: UserId
): FilteredListDoc | null {
  if (!isListVisibleTo(entry, userId)) {
    return null;
  }
  const listId = doc.listId ?? entry.id;
  return {
    listId,
    items: doc.items.map(toFilteredItem)
  };
}

export function filterBulletins(doc: BulletinDoc, userId: UserId): FilteredBulletin[] {
  return doc.bulletins
    .filter((b) => b.visibility === 'public' || b.authorId === userId)
    .map((b) => ({
      id: b.id,
      authorId: b.authorId,
      text: b.text.toString(),
      createdAt: b.createdAt,
      editedAt: b.editedAt,
      visibility: b.visibility
    }));
}

export function isListVisibleTo(entry: ListRegistryEntry, userId: UserId): boolean {
  if (entry.visibility === 'public') {
    return true;
  }
  if (entry.ownerId === userId) {
    return true;
  }
  return Boolean(entry.collaborators[userId]);
}

function toFilteredItem(item: ShoppingListDoc['items'][number]): FilteredItem {
  return {
    id: item.id,
    label: item.label.toString(),
    createdAt: item.createdAt,
    addedBy: item.addedBy,
    quantity: item.quantity,
    vendor: item.vendor,
    notes: item.notes?.toString(),
    checked: item.checked
  };
}
