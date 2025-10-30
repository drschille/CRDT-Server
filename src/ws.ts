import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import * as Automerge from '@automerge/automerge';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { addPost, deletePost, editPost, likePost, unlikePost } from './actions.js';
import { saveDoc } from './crdt.js';
import { filterForUser } from './filter.js';
import type { BoardDoc, ClientMessage, UserId } from './types.js';

interface Connection {
  userId: UserId;
  socket: WebSocket;
}

export interface DocRef {
  doc: Automerge.Doc<BoardDoc>;
}

function parseMessage(raw: string): ClientMessage {
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.type !== 'string') {
    throw new Error('Invalid message.');
  }
  return parsed as ClientMessage;
}

function resolveUserId(req: http.IncomingMessage): UserId {
  const url = new URL(req.url ?? '/ws', `http://${req.headers.host ?? 'localhost'}`);
  const token = url.searchParams.get('token');
  if (token && token.trim()) {
    return token.trim();
  }
  return `anon-${randomUUID().slice(0, 8)}`;
}

function sendSnapshot(connection: Connection, doc: Automerge.Doc<BoardDoc>) {
  const state = filterForUser(doc, connection.userId);
  connection.socket.send(JSON.stringify({ type: 'snapshot', state }));
}

async function broadcast(docRef: DocRef, connections: Set<Connection>) {
  for (const conn of connections) {
    if (conn.socket.readyState === conn.socket.OPEN) {
      sendSnapshot(conn, docRef.doc);
    }
  }
}

export function createWSServer(server: http.Server, docRef: DocRef) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const connections = new Set<Connection>();

  wss.on('connection', (socket, req) => {
    const userId = resolveUserId(req);
    const connection: Connection = { userId, socket };
    connections.add(connection);

    socket.send(JSON.stringify({ type: 'welcome', userId }));
    sendSnapshot(connection, docRef.doc);

    socket.on('message', async (data) => {
      try {
        const message = parseMessage(data.toString());
        let next = docRef.doc;

        switch (message.type) {
          case 'hello':
            break;
          case 'add_post':
            next = addPost(docRef.doc, userId, String(message.text ?? ''), message.visibility ?? 'public');
            break;
          case 'edit_post':
            next = editPost(docRef.doc, userId, message.id, String(message.text ?? ''));
            break;
          case 'delete_post':
            next = deletePost(docRef.doc, userId, message.id);
            break;
          case 'like_post':
            next = likePost(docRef.doc, userId, message.id);
            break;
          case 'unlike_post':
            next = unlikePost(docRef.doc, userId, message.id);
            break;
          case 'request_full_state':
            sendSnapshot(connection, docRef.doc);
            break;
          default:
            throw new Error('Unknown message type.');
        }

        if (next !== docRef.doc) {
          docRef.doc = next;
          await saveDoc(docRef.doc);
          await broadcast(docRef, connections);
        }
      } catch (error: any) {
        const message = typeof error?.message === 'string' ? error.message : 'Unexpected error';
        socket.send(
          JSON.stringify({
            type: 'error',
            code: 'BAD_REQUEST',
            message,
          }),
        );
      }
    });

    socket.on('close', () => {
      connections.delete(connection);
    });
  });

  return wss;
}
