import * as Automerge from '@automerge/automerge';
import { describe, expect, it } from 'vitest';
import {
  MAX_ITEMS_PER_LIST,
  MAX_LISTS_PER_USER,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  addBulletin,
  addItem,
  archiveList,
  createList,
  renameList,
  setItemNotes,
  toggleItemChecked
} from '../src/actions.js';
import {
  BulletinDoc,
  ListRegistryDoc,
  ShoppingListDoc,
  Visibility
} from '../src/types.js';

function createRegistryDoc(): Automerge.Doc<ListRegistryDoc> {
  return Automerge.from<ListRegistryDoc>({ lists: [] });
}

function createListDoc(listId: string): Automerge.Doc<ShoppingListDoc> {
  return Automerge.from<ShoppingListDoc>({ listId, items: [] });
}

function createBulletinDoc(): Automerge.Doc<BulletinDoc> {
  return Automerge.from<BulletinDoc>({ bulletins: [] });
}

describe('createList', () => {
  it('creates a list owned by the user', () => {
    let registry = createRegistryDoc();
    const { doc: next, listId } = createList(registry, 'alice', 'Groceries');
    registry = next;

    const entry = registry.lists.find((l) => l.id === listId);
    expect(entry).toBeTruthy();
    expect(entry?.ownerId).toBe('alice');
    expect(entry?.name.toString()).toBe('Groceries');
    expect(entry?.visibility).toBe('private');
  });

  it('enforces maximum lists per user', () => {
    let registry = createRegistryDoc();
    for (let i = 0; i < MAX_LISTS_PER_USER; i += 1) {
      const result = createList(registry, 'alice', `List ${i}`);
      registry = result.doc;
    }
    expect(() => createList(registry, 'alice', 'Overflow')).toThrow('List limit reached');
  });

  it('rejects names exceeding length limit', () => {
    const registry = createRegistryDoc();
    const longName = 'x'.repeat(MAX_NAME_LENGTH + 1);
    expect(() => createList(registry, 'alice', longName)).toThrow('Name too long');
  });
});

describe('list item actions', () => {
  it('adds an item to a list', () => {
    const { doc: nextRegistry, listId } = createList(createRegistryDoc(), 'alice', 'Groceries');
    const entry = nextRegistry.lists.find((l) => l.id === listId)!;
    const listDoc = createListDoc(listId);

    const updated = addItem(listDoc, entry, 'alice', 'Apples', '3', 'Market');
    const item = updated.items[0];
    expect(item?.label.toString()).toBe('Apples');
    expect(item?.quantity).toBe('3');
    expect(item?.vendor).toBe('Market');
  });

  it('limits number of items per list', () => {
    const { doc: nextRegistry, listId } = createList(createRegistryDoc(), 'alice', 'Groceries');
    const entry = nextRegistry.lists.find((l) => l.id === listId)!;
    let listDoc = createListDoc(listId);

    for (let i = 0; i < MAX_ITEMS_PER_LIST; i += 1) {
      listDoc = addItem(listDoc, entry, 'alice', `Item ${i}`);
    }

    expect(() => addItem(listDoc, entry, 'alice', 'Overflow')).toThrow('Item limit reached');
  });

  it('toggles item checked state', () => {
    const { doc: nextRegistry, listId } = createList(createRegistryDoc(), 'alice', 'Groceries');
    const entry = nextRegistry.lists.find((l) => l.id === listId)!;
    let listDoc = createListDoc(listId);
    listDoc = addItem(listDoc, entry, 'alice', 'Milk');
    const itemId = listDoc.items[0]?.id ?? '';

    listDoc = toggleItemChecked(listDoc, entry, 'alice', itemId, true);
    expect(listDoc.items[0]?.checked).toBe(true);
  });

  it('rejects notes beyond limit', () => {
    const { doc: nextRegistry, listId } = createList(createRegistryDoc(), 'alice', 'Groceries');
    const entry = nextRegistry.lists.find((l) => l.id === listId)!;
    let listDoc = createListDoc(listId);
    listDoc = addItem(listDoc, entry, 'alice', 'Milk');
    const itemId = listDoc.items[0]?.id ?? '';

    const longNotes = 'y'.repeat(MAX_NOTES_LENGTH + 1);
    expect(() => setItemNotes(listDoc, entry, 'alice', itemId, longNotes)).toThrow('Notes too long');
  });
});

describe('renameList', () => {
  it('updates the list name and timestamp', () => {
    let registry = createRegistryDoc();
    const { doc: next, listId } = createList(registry, 'alice', 'Groceries');
    registry = next;

    registry = renameList(registry, 'alice', listId, 'Weekly Groceries');
    const entry = registry.lists.find((l) => l.id === listId);
    expect(entry?.name.toString()).toBe('Weekly Groceries');
    expect(entry?.updatedAt).toBeTruthy();
  });
});

describe('archiveList', () => {
  it('marks the list as archived', () => {
    let registry = createRegistryDoc();
    const { doc: next, listId } = createList(registry, 'alice', 'Groceries');
    registry = next;

    registry = archiveList(registry, 'alice', listId, true);
    const entry = registry.lists.find((l) => l.id === listId);
    expect(entry?.archived).toBe(true);
  });
});

describe('bulletin actions', () => {
  it('adds a bulletin entry', () => {
    let doc = createBulletinDoc();
    doc = addBulletin(doc, 'alice', 'Welcome everyone', 'public');
    const bulletin = doc.bulletins[0];
    expect(bulletin?.text.toString()).toBe('Welcome everyone');
    expect(bulletin?.visibility).toBe('public');
  });
});
