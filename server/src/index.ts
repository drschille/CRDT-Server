import http from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWSServer } from './ws.js';
import { loadBulletinDoc, loadRegistryDoc } from './crdt.js';
import { info, error } from './logger.js';
import * as Automerge from '@automerge/automerge';
import type { ShoppingListDoc } from './types.js';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, '../../web');

async function main() {
  const app = express();
  const server = http.createServer(app);

  const registryDoc = await loadRegistryDoc();
  const bulletinsDoc = await loadBulletinDoc();
  const listDocs = new Map<string, Automerge.Doc<ShoppingListDoc>>();

  const context = {
    registryDoc,
    bulletinsDoc,
    listDocs
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
    if (process.env.NODE_ENV === 'production') {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({
      registry: Automerge.toJS(context.registryDoc),
      bulletins: Automerge.toJS(context.bulletinsDoc),
      lists: Object.fromEntries(
        Array.from(context.listDocs.entries()).map(([id, doc]) => [id, Automerge.toJS(doc)])
      )
    });
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
