import express from 'express';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type * as Automerge from '@automerge/automerge';
import type { BoardDoc } from './types.js';

export interface HttpServerDeps {
  getDoc: () => Automerge.Doc<BoardDoc>;
}

export function createHttpServer(deps: HttpServerDeps): Server {
  const app = express();

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/debug/state', (_req, res) => {
    res.status(200).json({ state: deps.getDoc() });
  });

  return createServer(app);
}
