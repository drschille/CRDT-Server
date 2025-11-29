import http from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWSServer } from './ws.js';
import { loadBulletinDoc } from './crdt.js';
import { info, error } from './logger.js';
import * as Automerge from '@automerge/automerge';
import { ensureTables, getPool } from './db.js';
import { fetchAccessibleRegistry } from './registryStore.js';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, '../../web');

async function main() {
  const app = express();
  const server = http.createServer(app);

  const db = getPool();
  await ensureTables(db);
  const bulletinsDoc = await loadBulletinDoc();

  const context = {
    db,
    bulletinsDoc
  };

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    express.static(WEB_ROOT, {
      setHeaders(res, servedPath) {
        if (servedPath.endsWith('.wasm')) {
          res.type('application/wasm');
        }
      }
    })
  );

  app.get('/debug/state', (_req, res) => {
    void (async () => {
      if (process.env.NODE_ENV === 'production') {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const registry = await fetchAccessibleRegistry(db, 'debug-user');
      res.json({
        registry,
        bulletins: Automerge.toJS(context.bulletinsDoc)
      });
    })();
  });

  createWSServer(server, context);

  server.listen(PORT, () => {
    info('server listening', { port: PORT });
  });
}

main().catch((err) => {
  error('fatal error during startup', { error: err instanceof Error ? err.message : err });
  process.exitCode = 1;
});
