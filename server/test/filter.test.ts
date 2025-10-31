import { describe, expect, it } from 'vitest';
import {
  filterBulletins,
  filterListDoc,
  filterRegistryDoc,
  isListVisibleTo
} from '../src/filter.js';
import {
  BulletinDoc,
  ListRegistryDoc,
  ListRegistryEntry,
  ShoppingListDoc
} from '../src/types.js';

describe('filterRegistryDoc', () => {
  it('includes public and authorized private lists', () => {
    const doc: ListRegistryDoc = {
      lists: [
        {
          id: 'list-public',
          ownerId: 'alice',
          name: { toString: () => 'Groceries' } as unknown as ListRegistryEntry['name'],
          createdAt: '2024-01-01T00:00:00Z',
          visibility: 'public',
          collaborators: {},
          archived: false
        },
        {
          id: 'list-private',
          ownerId: 'bob',
          name: { toString: () => 'Secret' } as unknown as ListRegistryEntry['name'],
          createdAt: '2024-01-02T00:00:00Z',
          visibility: 'private',
          collaborators: { carol: true },
          archived: false
        }
      ]
    };

    const filtered = filterRegistryDoc(doc, 'carol');
    expect(filtered.map((entry) => entry.id)).toEqual(['list-public', 'list-private']);
  });
});

describe('filterListDoc', () => {
  it('returns list items only when user has visibility', () => {
    const entry: ListRegistryEntry = {
      id: 'list1',
      ownerId: 'alice',
      name: { toString: () => 'Groceries' } as unknown as ListRegistryEntry['name'],
      createdAt: '2024-01-01T00:00:00Z',
      visibility: 'private',
      collaborators: { bob: true },
      archived: false
    };
    const doc: ShoppingListDoc = {
      listId: 'list1',
      items: [
        {
          id: 'item1',
          label: { toString: () => 'Milk' } as unknown as ShoppingListDoc['items'][number]['label'],
          createdAt: '2024-01-01T00:00:00Z',
          addedBy: 'alice',
          checked: false
        }
      ]
    };

    expect(filterListDoc(doc, entry, 'bob')?.items[0]?.label).toBe('Milk');
    expect(filterListDoc(doc, entry, 'carol')).toBeNull();
  });
});

describe('filterBulletins', () => {
  it('excludes private bulletins from other users', () => {
    const doc: BulletinDoc = {
      bulletins: [
        {
          id: 'b1',
          authorId: 'alice',
          text: { toString: () => 'Hello' } as unknown as BulletinDoc['bulletins'][number]['text'],
          createdAt: '2024-01-01T00:00:00Z',
          visibility: 'public'
        },
        {
          id: 'b2',
          authorId: 'bob',
          text: { toString: () => 'Secret' } as unknown as BulletinDoc['bulletins'][number]['text'],
          createdAt: '2024-01-01T01:00:00Z',
          visibility: 'private'
        }
      ]
    };

    const filtered = filterBulletins(doc, 'alice');
    expect(filtered.map((b) => b.id)).toEqual(['b1']);
  });
});

describe('isListVisibleTo', () => {
  it('checks ownership and collaborators', () => {
    const entry: ListRegistryEntry = {
      id: 'list1',
      ownerId: 'alice',
      name: { toString: () => 'Groceries' } as unknown as ListRegistryEntry['name'],
      createdAt: '2024-01-01T00:00:00Z',
      visibility: 'private',
      collaborators: { bob: true },
      archived: false
    };

    expect(isListVisibleTo(entry, 'alice')).toBe(true);
    expect(isListVisibleTo(entry, 'bob')).toBe(true);
    expect(isListVisibleTo(entry, 'carol')).toBe(false);
  });
});
