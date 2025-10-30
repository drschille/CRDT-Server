import type { Server as HTTPServer } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import * as Automerge from '@automerge/automerge';
import { filterForUser } from './filter.js';
import { addPost, deletePost, editPost, likePost, unlikePost } from './actions.js';
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
}

type ClientMessage =
  | { type: 'hello'; clientVersion: string }
  | { type: 'add_post'; text: string; visibility?: 'public' | 'private' }
  | { type: 'edit_post'; id: string; text: string }
  | { type: 'delete_post'; id: string }
  | { type: 'like_post'; id: string }
  | { type: 'unlike_post'; id: string }
  | { type: 'request_full_state' };

export function createWSServer(server: HTTPServer, docRef: DocRef): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const connections = new Set<Connection>();

  wss.on('connection', (socket, req) => {
    const userId = resolveUserId(req);
    const connection: Connection = { socket, userId };
    connections.add(connection);

    info('websocket connected', { userId });
    sendJson(socket, { type: 'welcome', userId });
    sendSnapshot(socket, docRef.doc, userId);

    socket.on('message', (raw) => {
      void (async () => {
        try {
          const message = parseMessage(raw);
          if (message.type === 'hello') {
            info('client hello', { userId, version: message.clientVersion });
            return;
          }

          if (message.type === 'request_full_state') {
            sendSnapshot(socket, docRef.doc, userId);
            return;
          }

          const didChange = handleDomainMessage(message, userId, docRef);
          if (didChange) {
            await saveDoc(docRef.doc);
            broadcastSnapshots(connections, docRef.doc);
          }
        } catch (error: unknown) {
          warn('failed to handle message', { error, userId });
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
  return parsed;
}

function handleDomainMessage(
  message: ClientMessage,
  userId: UserId,
  docRef: DocRef
): boolean {
  switch (message.type) {
    case 'add_post':
      docRef.doc = addPost(
        docRef.doc,
        userId,
        String(message.text ?? ''),
        message.visibility ?? 'public'
      );
      return true;
    case 'edit_post':
      docRef.doc = editPost(docRef.doc, userId, message.id, message.text);
      return true;
    case 'delete_post':
      docRef.doc = deletePost(docRef.doc, userId, message.id);
      return true;
    case 'like_post':
      docRef.doc = likePost(docRef.doc, userId, message.id);
      return true;
    case 'unlike_post':
      docRef.doc = unlikePost(docRef.doc, userId, message.id);
      return true;
    default:
      throw new Error(`Unsupported message type ${(message as { type: string }).type}`);
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

function broadcastSnapshots(connections: Set<Connection>, doc: Automerge.Doc<BoardDoc>): void {
  for (const { socket, userId } of connections) {
    if (socket.readyState !== WebSocket.OPEN) {
      continue;
    }
    sendSnapshot(socket, doc, userId);
  }
}

function sendSnapshot(socket: WebSocket, doc: Automerge.Doc<BoardDoc>, userId: UserId): void {
  const state = filterForUser(doc, userId);
  sendJson(socket, { type: 'snapshot', state });
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}
