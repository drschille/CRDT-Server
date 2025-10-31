import { Buffer } from 'node:buffer';
import type { Server as HTTPServer } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import * as Automerge from '@automerge/automerge';
import { filterForUser } from './filter.js';
import { addPost, applyLiveEdit, deletePost, editPost, likePost, unlikePost } from './actions.js';
import { resolveUserId } from './auth.js';
import { saveDoc } from './crdt.js';
import { info, warn } from './logger.js';
import { BoardDoc, UserId } from './types.js';

interface DocRef {
  doc: Automerge.Doc<BoardDoc>;
}

interface Connection {
  socket: WebSocket;
  userId: UserId;
  viewDoc: Automerge.Doc<BoardDoc>;
  syncState: Automerge.SyncState;
  rateLimiter: TokenBucket;
}

type ClientMessage =
  | { type: 'hello'; clientVersion: string }
  | { type: 'add_post'; text: string; visibility?: 'public' | 'private' }
  | { type: 'edit_post'; id: string; text: string }
  | { type: 'edit_post_live'; id: string; index: number; deleteCount: number; text: string }
  | { type: 'delete_post'; id: string }
  | { type: 'like_post'; id: string }
  | { type: 'unlike_post'; id: string }
  | { type: 'request_full_state' }
  | { type: 'sync'; data: string };

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

const RATE_LIMIT_CAPACITY = 30;
const RATE_LIMIT_REFILL_PER_SECOND = 15;
const RATE_LIMIT_COST_DEFAULT = 1;
const RATE_LIMIT_COST_LIVE_EDIT = 0.25;

export function createWSServer(server: HTTPServer, docRef: DocRef): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const connections = new Set<Connection>();

  wss.on('connection', (socket, req) => {
    const userId = resolveUserId(req);
    const connection: Connection = {
      socket,
      userId,
      viewDoc: Automerge.from<BoardDoc>({ posts: [] }),
      syncState: Automerge.initSyncState(),
      rateLimiter: new TokenBucket(RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_SECOND)
    };
    connections.add(connection);

    info('websocket connected', { userId });
    sendJson(socket, { type: 'welcome', userId });
    refreshConnectionView(connection, docRef.doc);
    sendSyncMessages(connection);
    sendSnapshot(connection, docRef.doc);

    socket.on('message', (raw) => {
      void (async () => {
        try {
          const message = parseMessage(raw);
          if (message.type === 'hello') {
            info('client hello', { userId, version: message.clientVersion });
            return;
          }

          if (message.type === 'request_full_state') {
            sendSnapshot(connection, docRef.doc);
            return;
          }

          if (message.type === 'sync') {
            handleSyncMessage(connection, message.data);
            refreshConnectionView(connection, docRef.doc);
            sendSyncMessages(connection);
            return;
          }

          const didChange = handleDomainMessage(message, connection, docRef);
          if (didChange) {
            refreshConnectionView(connection, docRef.doc);
            sendSyncMessages(connection);
            await saveDoc(docRef.doc);
            broadcastSnapshots(connections, docRef.doc);
            broadcastSyncMessages(connections, docRef.doc, connection);
          }
        } catch (error: unknown) {
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

function parseMessage(raw: RawData): ClientMessage {
  const text = rawDataToString(raw);
  const parsed = JSON.parse(text) as ClientMessage;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid payload');
  }
  if (parsed.type === 'sync' && typeof parsed.data !== 'string') {
    throw new Error('Invalid sync payload');
  }
  return parsed;
}

function toNonNegativeInt(value: unknown, field: string): number {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(`Invalid ${field}`);
  }
  return numberValue;
}

function handleDomainMessage(message: ClientMessage, connection: Connection, docRef: DocRef): boolean {
  switch (message.type) {
    case 'add_post':
      if (!consumeRateLimit(connection, RATE_LIMIT_COST_DEFAULT)) {
        return false;
      }
      docRef.doc = addPost(
        docRef.doc,
        connection.userId,
        String(message.text ?? ''),
        message.visibility ?? 'public'
      );
      return true;
    case 'edit_post':
      if (!consumeRateLimit(connection, RATE_LIMIT_COST_DEFAULT)) {
        return false;
      }
      docRef.doc = editPost(docRef.doc, connection.userId, message.id, message.text);
      return true;
    case 'edit_post_live':
      if (!consumeRateLimit(connection, RATE_LIMIT_COST_LIVE_EDIT)) {
        return false;
      }
      docRef.doc = applyLiveEdit(
        docRef.doc,
        connection.userId,
        message.id,
        toNonNegativeInt(message.index, 'index'),
        toNonNegativeInt(message.deleteCount, 'deleteCount'),
        String(message.text ?? '')
      );
      return true;
    case 'delete_post':
      if (!consumeRateLimit(connection, RATE_LIMIT_COST_DEFAULT)) {
        return false;
      }
      docRef.doc = deletePost(docRef.doc, connection.userId, message.id);
      return true;
    case 'like_post':
      if (!consumeRateLimit(connection, RATE_LIMIT_COST_DEFAULT)) {
        return false;
      }
      docRef.doc = likePost(docRef.doc, connection.userId, message.id);
      return true;
    case 'unlike_post':
      if (!consumeRateLimit(connection, RATE_LIMIT_COST_DEFAULT)) {
        return false;
      }
      docRef.doc = unlikePost(docRef.doc, connection.userId, message.id);
      return true;
    default:
      throw new Error(`Unsupported message type ${(message as { type: string }).type}`);
  }
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

function handleSyncMessage(connection: Connection, base64: string): void {
  let messageBytes: Uint8Array;
  try {
    messageBytes = fromBase64(base64);
  } catch (error) {
    throw new Error('Invalid sync payload');
  }

  const [nextDoc, nextSyncState] = Automerge.receiveSyncMessage(
    connection.viewDoc,
    connection.syncState,
    messageBytes
  );

  connection.syncState = nextSyncState;
  connection.viewDoc = nextDoc;
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

function refreshConnectionView(connection: Connection, doc: Automerge.Doc<BoardDoc>): void {
  const filtered = filterForUser(doc, connection.userId);
  connection.viewDoc = Automerge.change(connection.viewDoc, 'refresh_filtered_view', (draft) => {
    draft.posts.splice(0, draft.posts.length);
    for (const post of filtered.posts) {
      draft.posts.push({
        id: post.id,
        authorId: post.authorId,
        text: toAutomergeText(post.text),
        createdAt: post.createdAt,
        editedAt: post.editedAt,
        lastEditedBy: post.lastEditedBy,
        likes: { ...post.likes },
        visibility: post.visibility
      });
    }
  });
}

function broadcastSnapshots(connections: Set<Connection>, doc: Automerge.Doc<BoardDoc>): void {
  for (const connection of connections) {
    if (connection.socket.readyState !== WebSocket.OPEN) {
      continue;
    }
    sendSnapshot(connection, doc);
  }
}

function broadcastSyncMessages(
  connections: Set<Connection>,
  doc: Automerge.Doc<BoardDoc>,
  skip?: Connection
): void {
  for (const connection of connections) {
    if (connection === skip) {
      continue;
    }
    refreshConnectionView(connection, doc);
    sendSyncMessages(connection);
  }
}

function sendSnapshot(connection: Connection, doc: Automerge.Doc<BoardDoc>): void {
  if (connection.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  const state = filterForUser(doc, connection.userId);
  sendJson(connection.socket, { type: 'snapshot', state });
}

function sendSyncMessages(connection: Connection): void {
  if (connection.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  let syncState = connection.syncState;
  while (true) {
    const [nextSyncState, message] = Automerge.generateSyncMessage(connection.viewDoc, syncState);
    connection.syncState = nextSyncState;
    syncState = nextSyncState;
    if (!message) {
      break;
    }
    sendJson(connection.socket, { type: 'sync', data: toBase64(message) });
  }
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function fromBase64(data: string): Uint8Array {
  return Buffer.from(data, 'base64');
}

function toAutomergeText(value: string): Automerge.Text {
  const text = new Automerge.Text();
  if (value.length > 0) {
    text.insertAt(0, ...value);
  }
  return text;
}
