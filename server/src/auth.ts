import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { UserId } from './types.js';

function createAnonymousId(): UserId {
  return `anon-${randomUUID().slice(0, 8)}`;
}

export function resolveUserId(req: IncomingMessage): UserId {
  const token = extractBearerToken(req.headers['authorization']);
  if (!token) {
    return createAnonymousId();
  }
  // TODO: parse JWT when auth is implemented. For now echo hash for determinism.
  return `user-${hashToken(token).slice(0, 8)}`;
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = header.match(/^Bearer\s+(.*)$/i);
  return match ? match[1] : null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
