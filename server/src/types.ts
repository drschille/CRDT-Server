import type { Text } from '@automerge/automerge';

export type ListId = string;
export type ItemId = string;
export type BulletinId = string;
export type UserId = string;

export type Visibility = 'public' | 'private';

// Registry doc -----------------------------------------------------------------

export interface ListRegistryEntry {
  id: ListId;
  ownerId: UserId;
  name: Text;
  createdAt: string;
  updatedAt?: string;
  visibility: Visibility;
  collaborators: Record<UserId, true>;
  archived?: boolean;
}

export interface ListRegistryDoc extends Record<string, unknown> {
  lists: ListRegistryEntry[];
}

export interface FilteredRegistryEntry {
  id: ListId;
  ownerId: UserId;
  name: string;
  createdAt: string;
  updatedAt?: string;
  visibility: Visibility;
  collaborators: Record<UserId, true>;
  archived?: boolean;
}

// Shopping list doc -----------------------------------------------------------

export interface ListItem {
  id: ItemId;
  label: Text;
  createdAt: string;
  addedBy: UserId;
  quantity?: string;
  vendor?: string;
  notes?: Text;
  checked?: boolean;
}

export interface ShoppingListDoc extends Record<string, unknown> {
  listId: ListId;
  items: ListItem[];
}

export interface FilteredItem {
  id: ItemId;
  label: string;
  createdAt: string;
  addedBy: UserId;
  quantity?: string;
  vendor?: string;
  notes?: string;
  checked?: boolean;
}

export interface FilteredListDoc {
  listId: ListId;
  items: FilteredItem[];
}

// Bulletins doc ----------------------------------------------------------------

export interface Bulletin {
  id: BulletinId;
  authorId: UserId;
  text: Text;
  createdAt: string;
  editedAt?: string;
  visibility: Visibility;
}

export interface BulletinDoc extends Record<string, unknown> {
  bulletins: Bulletin[];
}

export interface FilteredBulletin {
  id: BulletinId;
  authorId: UserId;
  text: string;
  createdAt: string;
  editedAt?: string;
  visibility: Visibility;
}
