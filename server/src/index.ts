import http from 'node:http';
import express from 'express';
import * as Automerge from '@automerge/automerge';
import { createWSServer } from './ws.js';
import { loadDoc } from './crdt.js';
import { info, error } from './logger.js';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);

async function main() {
  const app = express();
  const server = http.createServer(app);

  const doc = await loadDoc();
  const docRef = { doc };

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/debug/state', (_req, res) => {
    if (process.env.NODE_ENV === 'production') {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ state: Automerge.toJS(docRef.doc) });
  });

  createWSServer(server, docRef);

  server.listen(PORT, () => {
    info('server listening', { port: PORT });
  });
}

main().catch((err) => {
  error('fatal error during startup', { error: err instanceof Error ? err.message : err });
  process.exitCode = 1;
});
