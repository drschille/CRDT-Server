import { Buffer } from 'node:buffer';
import type { Server as HTTPServer } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import * as Automerge from '@automerge/automerge';
import {
  addBulletin,
  addItem,
  archiveList,
  createList,
  deleteBulletin,
  deleteListEntry,
  renameList,
  removeItem,
  setCollaborators,
  setItemNotes,
  setItemQuantity,
  setItemVendor,
  toggleItemChecked,
  updateListVisibility,
  updateItemLabel,
  editBulletin
} from './actions.js';
import {
  deleteListDoc,
  forgetListDoc,
  loadListDoc,
  saveBulletinDoc,
  saveListDoc,
  saveRegistryDoc
} from './crdt.js';
import { filterBulletins, filterListDoc, filterRegistryDoc, isListVisibleTo } from './filter.js';
import { resolveUserId } from './auth.js';
import { info, warn } from './logger.js';
import {
  BulletinDoc,
  ListId,
  ListRegistryDoc,
  ListRegistryEntry,
  ShoppingListDoc,
  UserId,
  Visibility
} from './types.js';

const RATE_LIMIT_CAPACITY = 40;
const RATE_LIMIT_REFILL_PER_SECOND = 20;
const RATE_LIMIT_COST_ACTION = 1;
const RATE_LIMIT_COST_SYNC = 0.25;

type DocDescriptor =
  | { kind: 'registry' }
  | { kind: 'bulletins' }
  | { kind: 'list'; listId: ListId };

type ClientMessage =
  | { type: 'hello'; clientVersion: string }
  | { type: 'subscribe'; doc: DocSelector }
  | { type: 'unsubscribe'; doc: DocSelector }
  | { type: 'registry_action'; action: RegistryAction }
  | { type: 'list_action'; listId: ListId; action: ListAction }
  | { type: 'bulletin_action'; action: BulletinAction }
  | { type: 'sync'; doc: DocSelector; data: string }
  | { type: 'request_full_state'; doc?: DocSelector };

type DocSelector = 'registry' | 'bulletins' | { listId: ListId };

type RegistryAction =
  | { type: 'create_list'; name: string; visibility?: Visibility; collaborators?: UserId[] }
  | { type: 'rename_list'; listId: ListId; name: string }
  | { type: 'update_list_visibility'; listId: ListId; visibility: Visibility }
  | { type: 'set_collaborators'; listId: ListId; collaborators: UserId[] }
  | { type: 'archive_list'; listId: ListId }
  | { type: 'restore_list'; listId: ListId }
  | { type: 'delete_list'; listId: ListId };

type ListAction =
  | { type: 'add_item'; label: string; quantity?: string; vendor?: string }
  | { type: 'update_item'; itemId: string; label: string }
  | { type: 'set_item_quantity'; itemId: string; quantity?: string }
  | { type: 'set_item_vendor'; itemId: string; vendor?: string }
  | { type: 'set_item_notes'; itemId: string; notes?: string }
  | { type: 'toggle_item_checked'; itemId: string; checked: boolean }
  | { type: 'remove_item'; itemId: string };

type BulletinAction =
  | { type: 'add_bulletin'; text: string; visibility?: Visibility }
  | { type: 'edit_bulletin'; bulletinId: string; text: string }
  | { type: 'delete_bulletin'; bulletinId: string };

interface ServerContext {
  registryDoc: Automerge.Doc<ListRegistryDoc>;
  bulletinsDoc: Automerge.Doc<BulletinDoc>;
  listDocs: Map<ListId, Automerge.Doc<ShoppingListDoc>>;
}

interface Subscription {
  descriptor: DocDescriptor;
  syncState: Automerge.SyncState;
}

interface Connection {
  socket: WebSocket;
  userId: UserId;
  rateLimiter: TokenBucket;
  subscriptions: Map<string, Subscription>;
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly refillPerMs: number;

  constructor(private readonly capacity: number, refillPerSecond: number) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
    this.refillPerMs = refillPerSecond / 1000;
  }

  tryRemove(cost: number): boolean {
    this.refill();
    if (this.tokens < cost) {
      return false;
    }
    this.tokens -= cost;
    return true;
  }

  private refill(): void {
    const now = Date.now();
    if (now <= this.lastRefill) {
      return;
    }
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }
}

export function createWSServer(server: HTTPServer, context: ServerContext): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const connections = new Set<Connection>();

  wss.on('connection', (socket, req) => {
    const userId = resolveUserId(req);
    const connection: Connection = {
      socket,
      userId,
      rateLimiter: new TokenBucket(RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_SECOND),
      subscriptions: new Map()
    };
    connections.add(connection);

    info('websocket connected', { userId });
    sendJson(socket, { type: 'welcome', userId });

    // Auto-subscribe to registry and bulletins for convenience.
    subscribe(connection, context, { kind: 'registry' });
    subscribe(connection, context, { kind: 'bulletins' });
    flushSync(connection, context, { kind: 'registry' });
    flushSync(connection, context, { kind: 'bulletins' });
    sendSnapshot(connection, context, { kind: 'registry' });
    sendSnapshot(connection, context, { kind: 'bulletins' });

    socket.on('message', (raw) => {
      void (async () => {
        try {
          const message = parseMessage(raw);
          if (message.type === 'hello') {
            info('client hello', { userId, version: (message as { clientVersion?: string }).clientVersion });
            return;
          }

          switch (message.type) {
            case 'subscribe':
              subscribe(connection, context, parseDocSelector(message.doc));
              sendSnapshot(connection, context, parseDocSelector(message.doc));
              flushSync(connection, context, parseDocSelector(message.doc));
              break;
            case 'unsubscribe':
              unsubscribe(connection, parseDocSelector(message.doc));
              break;
            case 'registry_action':
              if (!consumeRateLimit(connection, RATE_LIMIT_COST_ACTION)) {
                return;
              }
              await handleRegistryAction(connection, context, message.action);
              await saveRegistryDoc(context.registryDoc);
              broadcastDoc(connections, context, { kind: 'registry' });
              break;
            case 'list_action':
              if (!consumeRateLimit(connection, RATE_LIMIT_COST_ACTION)) {
                return;
              }
              await handleListAction(connection, context, message.listId, message.action);
              broadcastDoc(connections, context, { kind: 'list', listId: message.listId });
              break;
            case 'bulletin_action':
              if (!consumeRateLimit(connection, RATE_LIMIT_COST_ACTION)) {
                return;
              }
              handleBulletinAction(connection, context, message.action);
              await saveBulletinDoc(context.bulletinsDoc);
              broadcastDoc(connections, context, { kind: 'bulletins' });
              break;
            case 'sync':
              if (!consumeRateLimit(connection, RATE_LIMIT_COST_SYNC)) {
                return;
              }
              handleSyncMessage(connection, context, parseDocSelector(message.doc), message.data);
              break;
            case 'request_full_state':
              if (message.doc) {
                sendSnapshot(connection, context, parseDocSelector(message.doc));
              } else {
                for (const subscription of connection.subscriptions.values()) {
                  sendSnapshot(connection, context, subscription.descriptor);
                }
              }
              break;
            default:
              throw new Error(`Unsupported message type ${(message as { type: string }).type}`);
          }
        } catch (error) {
          warn('failed to handle message', {
            error: error instanceof Error ? error.message : String(error),
            userId
          });
          sendJson(socket, {
            type: 'error',
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : 'Invalid message'
          });
        }
      })();
    });

    socket.on('close', () => {
      connections.delete(connection);
      info('websocket disconnected', { userId });
    });
  });

  return wss;
}

async function handleRegistryAction(
  connection: Connection,
  context: ServerContext,
  action: RegistryAction
): Promise<void> {
  switch (action.type) {
    case 'create_list': {
      const { doc, listId } = createList(
        context.registryDoc,
        connection.userId,
        action.name,
        action.visibility ?? 'private',
        action.collaborators ?? []
      );
      context.registryDoc = doc;
      const listDoc = await loadListDoc(listId);
      context.listDocs.set(listId, listDoc);
      await saveListDoc(listId, listDoc);
      break;
    }
    case 'rename_list':
      context.registryDoc = renameList(context.registryDoc, connection.userId, action.listId, action.name);
      break;
    case 'update_list_visibility':
      context.registryDoc = updateListVisibility(
        context.registryDoc,
        connection.userId,
        action.listId,
        action.visibility
      );
      break;
    case 'set_collaborators':
      context.registryDoc = setCollaborators(
        context.registryDoc,
        connection.userId,
        action.listId,
        action.collaborators
      );
      break;
    case 'archive_list':
      context.registryDoc = archiveList(context.registryDoc, connection.userId, action.listId, true);
      break;
    case 'restore_list':
      context.registryDoc = archiveList(context.registryDoc, connection.userId, action.listId, false);
      break;
    case 'delete_list':
      context.registryDoc = deleteListEntry(context.registryDoc, connection.userId, action.listId);
      context.listDocs.delete(action.listId);
      await deleteListDoc(action.listId);
      break;
    default:
      throw new Error(`Unsupported registry action ${(action as { type: string }).type}`);
  }
}

async function handleListAction(
  connection: Connection,
  context: ServerContext,
  listId: ListId,
  action: ListAction
): Promise<void> {
  const entry = context.registryDoc.lists.find((l) => l.id === listId);
  if (!entry || !isListVisibleTo(entry, connection.userId)) {
    throw new Error('List not accessible');
  }

  const listDoc = await loadOrGetListDoc(context, listId);

  let nextDoc: Automerge.Doc<ShoppingListDoc>;

  switch (action.type) {
    case 'add_item':
      nextDoc = addItem(listDoc, entry, connection.userId, action.label, action.quantity, action.vendor);
      break;
    case 'update_item':
      nextDoc = updateItemLabel(listDoc, entry, connection.userId, action.itemId, action.label);
      break;
    case 'set_item_quantity':
      nextDoc = setItemQuantity(listDoc, entry, connection.userId, action.itemId, action.quantity);
      break;
    case 'set_item_vendor':
      nextDoc = setItemVendor(listDoc, entry, connection.userId, action.itemId, action.vendor);
      break;
    case 'set_item_notes':
      nextDoc = setItemNotes(listDoc, entry, connection.userId, action.itemId, action.notes);
      break;
    case 'toggle_item_checked':
      nextDoc = toggleItemChecked(listDoc, entry, connection.userId, action.itemId, action.checked);
      break;
    case 'remove_item':
      nextDoc = removeItem(listDoc, entry, connection.userId, action.itemId);
      break;
    default:
      throw new Error(`Unsupported list action ${(action as { type: string }).type}`);
  }

  context.listDocs.set(listId, nextDoc);
  await saveListDoc(listId, nextDoc);
}

function handleBulletinAction(
  connection: Connection,
  context: ServerContext,
  action: BulletinAction
): void {
  switch (action.type) {
    case 'add_bulletin':
      context.bulletinsDoc = addBulletin(
        context.bulletinsDoc,
        connection.userId,
        action.text,
        action.visibility ?? 'public'
      );
      break;
    case 'edit_bulletin':
      context.bulletinsDoc = editBulletin(context.bulletinsDoc, connection.userId, action.bulletinId, action.text);
      break;
    case 'delete_bulletin':
      context.bulletinsDoc = deleteBulletin(context.bulletinsDoc, connection.userId, action.bulletinId);
      break;
    default:
      throw new Error(`Unsupported bulletin action ${(action as { type: string }).type}`);
  }
}

function subscribe(connection: Connection, context: ServerContext, descriptor: DocDescriptor): void {
  const key = descriptorKey(descriptor);
  if (!connection.subscriptions.has(key)) {
    connection.subscriptions.set(key, { descriptor, syncState: Automerge.initSyncState() });
  }

  // Ensure list doc is cached when subscribing.
  if (descriptor.kind === 'list') {
    void loadOrGetListDoc(context, descriptor.listId).catch((error) => {
      warn('failed to load list doc during subscribe', {
        error: error instanceof Error ? error.message : String(error),
        listId: descriptor.listId
      });
      forgetListDoc(descriptor.listId);
    });
  }
}

function unsubscribe(connection: Connection, descriptor: DocDescriptor): void {
  connection.subscriptions.delete(descriptorKey(descriptor));
}

function broadcastDoc(
  connections: Set<Connection>,
  context: ServerContext,
  descriptor: DocDescriptor
): void {
  for (const connection of connections) {
    if (!connection.subscriptions.has(descriptorKey(descriptor))) {
      continue;
    }
    sendSnapshot(connection, context, descriptor);
    flushSync(connection, context, descriptor);
  }
}

function sendSnapshot(connection: Connection, context: ServerContext, descriptor: DocDescriptor): void {
  switch (descriptor.kind) {
    case 'registry': {
      const state = filterRegistryDoc(context.registryDoc, connection.userId);
      sendJson(connection.socket, { type: 'snapshot', doc: 'registry', state });
      break;
    }
    case 'bulletins': {
      const state = filterBulletins(context.bulletinsDoc, connection.userId);
      sendJson(connection.socket, { type: 'snapshot', doc: 'bulletins', state });
      break;
    }
    case 'list': {
      const entry = context.registryDoc.lists.find((l) => l.id === descriptor.listId);
      if (!entry || !isListVisibleTo(entry, connection.userId)) {
        sendJson(connection.socket, {
          type: 'error',
          code: 'FORBIDDEN',
          message: 'No access to list'
        });
        return;
      }
      const doc = context.listDocs.get(descriptor.listId);
      if (!doc) {
        sendJson(connection.socket, {
          type: 'error',
          code: 'NOT_FOUND',
          message: 'List document unavailable'
        });
        return;
      }
      const filtered = filterListDoc(doc, entry, connection.userId);
      if (!filtered) {
        sendJson(connection.socket, {
          type: 'error',
          code: 'FORBIDDEN',
          message: 'No access to list'
        });
        return;
      }
      sendJson(connection.socket, { type: 'snapshot', doc: { listId: descriptor.listId }, state: filtered });
      break;
    }
    default:
      break;
  }
}

function flushSync(connection: Connection, context: ServerContext, descriptor: DocDescriptor): void {
  const subscription = connection.subscriptions.get(descriptorKey(descriptor));
  if (!subscription || connection.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const doc = resolveDocForDescriptor(context, descriptor);
  if (!doc) {
    return;
  }

  let syncState = subscription.syncState;
  while (true) {
    const [nextSyncState, message] = Automerge.generateSyncMessage(doc, syncState);
    subscription.syncState = nextSyncState;
    syncState = nextSyncState;
    if (!message) {
      break;
    }
    const wireDoc =
      descriptor.kind === 'list' ? { listId: descriptor.listId } : descriptor.kind;
    sendJson(connection.socket, { type: 'sync', doc: wireDoc, data: toBase64(message) });
  }
}

function handleSyncMessage(
  connection: Connection,
  context: ServerContext,
  descriptor: DocDescriptor,
  base64: string
): void {
  const subscription = connection.subscriptions.get(descriptorKey(descriptor));
  if (!subscription) {
    throw new Error('Not subscribed to document');
  }
  const doc = resolveDocForDescriptor(context, descriptor);
  if (!doc) {
    throw new Error('Document unavailable');
  }

  const messageBytes = fromBase64(base64);
  const [nextDoc, nextSyncState] = Automerge.receiveSyncMessage(doc, subscription.syncState, messageBytes);

  subscription.syncState = nextSyncState;

  switch (descriptor.kind) {
    case 'registry':
      context.registryDoc = nextDoc as Automerge.Doc<ListRegistryDoc>;
      break;
    case 'bulletins':
      context.bulletinsDoc = nextDoc as Automerge.Doc<BulletinDoc>;
      break;
    case 'list':
      context.listDocs.set(descriptor.listId, nextDoc as Automerge.Doc<ShoppingListDoc>);
      break;
    default:
      break;
  }
}

function resolveDocForDescriptor(
  context: ServerContext,
  descriptor: DocDescriptor
): Automerge.Doc<ListRegistryDoc | BulletinDoc | ShoppingListDoc> | undefined {
  switch (descriptor.kind) {
    case 'registry':
      return context.registryDoc;
    case 'bulletins':
      return context.bulletinsDoc;
    case 'list':
      return context.listDocs.get(descriptor.listId);
    default:
      return undefined;
  }
}

function loadOrGetListDoc(context: ServerContext, listId: ListId): Promise<Automerge.Doc<ShoppingListDoc>> {
  const cached = context.listDocs.get(listId);
  if (cached) {
    return Promise.resolve(cached);
  }
  return loadListDoc(listId).then((doc) => {
    context.listDocs.set(listId, doc);
    return doc;
  });
}

function consumeRateLimit(connection: Connection, cost: number): boolean {
  if (connection.rateLimiter.tryRemove(cost)) {
    return true;
  }
  sendJson(connection.socket, {
    type: 'error',
    code: 'RATE_LIMITED',
    message: 'Too many requests'
  });
  return false;
}

function parseMessage(raw: RawData): ClientMessage {
  const text = rawDataToString(raw);
  const parsed = JSON.parse(text) as ClientMessage;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid payload');
  }
  return parsed;
}

function parseDocSelector(selector: DocSelector): DocDescriptor {
  if (selector === 'registry') {
    return { kind: 'registry' };
  }
  if (selector === 'bulletins') {
    return { kind: 'bulletins' };
  }
  if (selector && typeof selector === 'object' && typeof selector.listId === 'string') {
    return { kind: 'list', listId: selector.listId };
  }
  throw new Error('Invalid doc selector');
}

function descriptorKey(descriptor: DocDescriptor): string {
  switch (descriptor.kind) {
    case 'registry':
      return 'registry';
    case 'bulletins':
      return 'bulletins';
    case 'list':
      return `list:${descriptor.listId}`;
    default:
      return 'unknown';
  }
}

function rawDataToString(raw: RawData): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString('utf8');
  }
  return raw.toString('utf8');
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function fromBase64(data: string): Uint8Array {
  return Buffer.from(data, 'base64');
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}
