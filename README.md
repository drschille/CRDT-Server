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
