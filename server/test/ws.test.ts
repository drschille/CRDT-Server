import * as Automerge from '@automerge/automerge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSyncMessage } from '../src/ws.js';
import { createList } from '../src/actions.js';
import { saveListDoc, saveRegistryDoc } from '../src/crdt.js';
import type { BulletinDoc, ListRegistryDoc, ShoppingListDoc } from '../src/types.js';

vi.mock('../src/crdt.js', () => ({
  deleteListDoc: vi.fn(),
  forgetListDoc: vi.fn(),
  loadListDoc: vi.fn(),
  saveBulletinDoc: vi.fn().mockResolvedValue(undefined),
  saveListDoc: vi.fn().mockResolvedValue(undefined),
  saveRegistryDoc: vi.fn().mockResolvedValue(undefined)
}));

const OPEN_STATE = 1;

function descriptorKey(kind: 'registry'): string;
function descriptorKey(kind: 'bulletins'): string;
function descriptorKey(kind: 'list', listId: string): string;
function descriptorKey(kind: 'registry' | 'bulletins' | 'list', listId?: string): string {
  if (kind === 'list') {
    return `list:${listId ?? ''}`;
  }
  return kind;
}

describe('handleSyncMessage persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists registry updates received via sync and notifies subscribers', async () => {
    const baseRegistry = Automerge.from<ListRegistryDoc>({ lists: [] });
    const context = {
      registryDoc: baseRegistry,
      bulletinsDoc: Automerge.from<BulletinDoc>({ bulletins: [] }),
      listDocs: new Map()
    };

    let serverSyncState = Automerge.initSyncState();
    const serverHandshake = Automerge.generateSyncMessage(context.registryDoc, serverSyncState);
    serverSyncState = serverHandshake[0];
    const handshakeMsg = serverHandshake[1];

    let clientDoc = Automerge.load<ListRegistryDoc>(Automerge.save(context.registryDoc));
    let clientSyncState = Automerge.initSyncState();
    if (handshakeMsg) {
      const clientHandshake = Automerge.receiveSyncMessage(clientDoc, clientSyncState, handshakeMsg);
      clientDoc = clientHandshake[0];
      clientSyncState = clientHandshake[1];
    }

    const listId = 'sync-list';
    clientDoc = Automerge.change(clientDoc, 'client adds list', (draft) => {
      const name = new Automerge.Text();
      name.insertAt(0, ...'Synced List');
      draft.lists.push({
        id: listId,
        ownerId: 'alice',
        name,
        createdAt: '2024-01-01T00:00:00.000Z',
        visibility: 'private',
        collaborators: {},
        archived: false
      });
    });

    const update = Automerge.generateSyncMessage(clientDoc, clientSyncState);
    clientSyncState = update[0];
    const updateMsg = update[1];
    if (!updateMsg) {
      throw new Error('expected sync message');
    }

    const subscription = {
      descriptor: { kind: 'registry' } as const,
      syncState: serverSyncState
    };
    const connection = {
      socket: { readyState: OPEN_STATE, send: vi.fn() },
      userId: 'alice',
      rateLimiter: { tryRemove: vi.fn() },
      subscriptions: new Map([[descriptorKey('registry'), subscription]])
    } as unknown as Parameters<typeof handleSyncMessage>[0];
    const connections = new Set([connection]);

    await handleSyncMessage(
      connection,
      connections,
      context,
      subscription.descriptor,
      Buffer.from(updateMsg).toString('base64')
    );

    expect(saveRegistryDoc).toHaveBeenCalledTimes(1);
    expect(saveRegistryDoc).toHaveBeenCalledWith(context.registryDoc);

    const lists = Automerge.toJS(context.registryDoc).lists as Array<{ id: string }>;
    expect(lists.some((entry) => entry.id === listId)).toBe(true);
    expect(connection.socket.send).toHaveBeenCalled();
  });

  it('persists list updates received via sync and notifies subscribers', async () => {
    let registryDoc = Automerge.from<ListRegistryDoc>({ lists: [] });
    const { doc: registryWithList, listId } = createList(registryDoc, 'alice', 'Groceries');
    registryDoc = registryWithList;

    const serverListDoc = Automerge.from<ShoppingListDoc>({ listId, items: [] });
    const clientListDocBytes = Automerge.save(serverListDoc);

    const context = {
      registryDoc,
      bulletinsDoc: Automerge.from<BulletinDoc>({ bulletins: [] }),
      listDocs: new Map([[listId, serverListDoc]])
    };

    let serverSyncState = Automerge.initSyncState();
    const serverHandshake = Automerge.generateSyncMessage(serverListDoc, serverSyncState);
    serverSyncState = serverHandshake[0];
    const handshakeMsg = serverHandshake[1];

    let clientDoc = Automerge.load<ShoppingListDoc>(clientListDocBytes);
    let clientSyncState = Automerge.initSyncState();
    if (handshakeMsg) {
      const clientHandshake = Automerge.receiveSyncMessage(clientDoc, clientSyncState, handshakeMsg);
      clientDoc = clientHandshake[0];
      clientSyncState = clientHandshake[1];
    }

    const newItemId = 'sync-item';
    const createdAt = '2024-01-01T00:00:00.000Z';
    clientDoc = Automerge.change(clientDoc, 'client adds item', (draft) => {
      const label = new Automerge.Text();
      label.insertAt(0, ...'Milk');
      draft.items.push({
        id: newItemId,
        label,
        createdAt,
        addedBy: 'alice',
        checked: false
      });
    });

    const update = Automerge.generateSyncMessage(clientDoc, clientSyncState);
    clientSyncState = update[0];
    const updateMsg = update[1];
    if (!updateMsg) {
      throw new Error('expected sync message');
    }

    const subscription = {
      descriptor: { kind: 'list', listId } as const,
      syncState: serverSyncState
    };

    const connection = {
      socket: { readyState: OPEN_STATE, send: vi.fn() },
      userId: 'alice',
      rateLimiter: { tryRemove: vi.fn() },
      subscriptions: new Map([[descriptorKey('list', listId), subscription]])
    } as unknown as Parameters<typeof handleSyncMessage>[0];
    const connections = new Set([connection]);

    await handleSyncMessage(
      connection,
      connections,
      context,
      subscription.descriptor,
      Buffer.from(updateMsg).toString('base64')
    );

    expect(saveListDoc).toHaveBeenCalledTimes(1);
    const persistedDoc = context.listDocs.get(listId);
    expect(persistedDoc).toBeTruthy();
    expect(persistedDoc?.items.some((item) => item.id === newItemId)).toBe(true);
    expect(connection.socket.send).toHaveBeenCalled();
  });
});
