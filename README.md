# CRDT-Server

A small POC of Conflict-Free Replicated Data Types (CRDTs).

## Development

The TypeScript server lives under `server/` and targets Node.js 20+.

```bash
cd server
pnpm install
pnpm dev
```

Key scripts (see `package.json`):

- `pnpm dev` – run the server in watch mode with `tsx`.
- `pnpm build` – emit compiled JavaScript to `dist/`.
- `pnpm test` – execute Vitest test suite.
- `pnpm lint` – run ESLint with TypeScript rules.

## Web Frontend

A lightweight dashboard lives in `web/` for sending actions and viewing live snapshots.

1. Start the CRDT server (`pnpm dev` from `server/`).
2. Serve the static assets, e.g.
   ```bash
   python -m http.server 4173 --directory web
   ```
3. Open http://localhost:4173, optionally enter a username to reuse an identity, and press **Connect** (default URL targets `ws://localhost:3000/ws`).
