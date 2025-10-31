# spec.md — Centralized CRDT Server (TypeScript) for “Bulletin Board”

## 1) Goal (MVP)

Build a **TypeScript Node.js** server that maintains a **centralized CRDT** for a shared JSON “bulletin board” and syncs it to clients (your Kotlin Android app + any web dev tools).

* **Single shared document**: `BoardDoc = { posts: Post[] }`
* **Eventual consistency**: implemented server-side using **Automerge v2**.
* **Transport**: WebSocket for realtime; minimal REST for health/debug.
* **Auth (optional for MVP)**: anonymous or simple bearer token.
* **Clients**: Minimalistic with **Automerge replica**.

> Rationale: Server and all connected clients each hold an **Automerge replica** of the shared document. Clients apply local **domain actions** (`add_post`, `like_post`, etc.) optimistically to their replica, then exchange Automerge sync messages with the server to converge. The server remains the authoritative persistence and privacy filter (only it stores private data for all users) and still broadcasts filtered **projections** as snapshots for convenience.

---

## 2) Tech & Constraints

* **Runtime**: Node.js ≥ 20
* **Lang**: TypeScript
* **CRDT**: `@automerge/automerge` v2
* **WebSocket**: `ws`
* **REST**: `express` (health + debug only)
* **Persistence**: write `automerge.save(doc)` to `data/board.bin` (atomic write)
* **Testing**: `vitest`
* **Lint/Format**: `eslint`, `prettier`
* **Dev**: `pnpm` or `npm`

---

## 3) Data Model

```ts
type PostId = string;   // UUID v4 (server-side)
type UserId = string;   // From auth header or connection param; "anon-<connId>" if missing

type Visibility = 'public' | 'private';

interface Post {
  id: PostId;
  authorId: UserId;
  text: Automerge.Text;        // canonical doc stores CRDT text
  createdAt: string;           // ISO8601
  editedAt?: string;           // ISO8601
  likes: Record<UserId, true>; // set-as-map
  visibility: Visibility;
}

// Snapshots expose a plain string for client convenience:
interface FilteredPost {
  id: PostId;
  authorId: UserId;
  text: string;
  createdAt: string;
  editedAt?: string;
  likes: Record<UserId, true>;
  visibility: Visibility;
}

// Privacy/editing rules:
// - `public` posts can be edited live by any connected user.
// - `private` posts remain visible and editable only to their author.

interface BoardDoc {
  posts: Post[];
}
```

---

## 4) Network Protocol

### 4.1 WebSocket URL

```
ws://<HOST>/ws?token=<JWT-optional>
```

* Extract `userId` from JWT if present; else generate `anon-<shortid>` for session.

### 4.2 Client → Server messages (JSON)

```ts
type ClientMsg =
  | { type: 'hello'; clientVersion: string }
  | { type: 'add_post'; text: string; visibility?: Visibility }
  | { type: 'edit_post'; id: PostId; text: string }
  | { type: 'edit_post_live'; id: PostId; index: number; deleteCount: number; text: string }
  | { type: 'delete_post'; id: PostId }
  | { type: 'like_post'; id: PostId }
  | { type: 'unlike_post'; id: PostId }
  | { type: 'request_full_state' } // debugging
  | { type: 'sync', data: Uint8Array }; // raw Automerge sync message bytes (base64 when over JSON)
```

### 4.3 Server → Client messages (JSON)

```ts
type ServerMsg =
  | { type: 'welcome'; userId: UserId }
  | { type: 'snapshot'; state: FilteredBoard }           // full projection for this user
  | { type: 'delta'; state: FilteredBoard }              // minimal: only changed posts if time permits
  | { type: 'sync', data: Uint8Array }                   // raw Automerge sync response
  | { type: 'error'; code: string; message: string };
```

**FilteredBoard** = `BoardDoc` filtered for that user:

* Include **all public posts**.
* Include **private posts only if `authorId === userId`**.
* Never send other users’ private posts.

> MVP: Always send `snapshot` after each change (simple & robust). “Delta” is a stretch goal.

---

## 5) Server Behavior (Multi‑Replica Automerge)

1. **Startup**

  * Load persisted canonical replica: if `data/board.bin` exists, `Automerge.load()`; else create `Automerge.from<BoardDoc>({ posts: [] })`.
  * Start Express (`/healthz`, `/debug/state`).
  * Start WS server and accept connections.

2. **On connection (handshake)**

  * Resolve `userId`.
  * Initialize an in-memory sync state object per connection (`Automerge.getSyncState()`).
  * Send `{ type: 'welcome', userId }`.
  * Generate initial sync message (if any) via `Automerge.generateSyncMessage(serverDoc, syncState)` and send `{ type: 'sync', data: <base64> }`.
  * Optionally also send a convenience `{ type: 'snapshot', state: filter(serverDoc, userId) }` for fast UI bootstrap (clients can render while CRDT catches up).

3. **On client sync message**

  * Decode base64 → `Uint8Array`.
  * Call `Automerge.receiveSyncMessage(serverDoc, syncState, bytes)`; if it mutates the server doc (returns a new doc), persist and update reference.
  * After applying, attempt another `generateSyncMessage`; send if non-null.
  * Finally, may send an updated `snapshot` (optional if client fully relies on its local replica state).

4. **On domain action (client → server)**

  * Validate payload (type, required fields, length, permissions).
  * Apply change: one `Automerge.change(serverDoc, 'action:<type>', draft => { ... })`.
    * `add_post`: push new `Post` (server authoritative UUID).
    * `edit_post`: replace entire `text` or (if clients send granular deltas) integrate into `Automerge.Text`.
    * `edit_post_live`: apply `{ index, deleteCount, text }` into `Automerge.Text.splice(...)` semantics.
    * `delete_post`: author only.
    * `like_post` / `unlike_post`: toggle set membership.
  * Persist (`writeFileAtomic`).
  * For every connection: update its sync state and attempt a `generateSyncMessage`; send if available (keeps replicas converging). Also send personalized `snapshot` for UI convenience.

5. **Filtering (privacy)**

  ```ts
  function filter(doc: BoardDoc, userId: UserId): FilteredBoard {
    return {
      posts: doc.posts
        .filter(p => p.visibility === 'public' || p.authorId === userId)
        .map(p => ({
          id: p.id,
          authorId: p.authorId,
          text: p.text.toString(),
          createdAt: p.createdAt,
          editedAt: p.editedAt,
          lastEditedBy: p.lastEditedBy,
          likes: p.likes,
          visibility: p.visibility
        }))
    };
  }
  ```

6. **Validation & Limits**

   * `text` max 2,000 chars.
   * Post count cap (e.g., 2,000) to keep memory bounded.
   * Rate-limit per connection (simple token bucket in memory).

7. **Errors**

   * Send `{ type: 'error', code, message }` on invalid input or forbidden action.
   * Keep connection open unless abuse is detected.

---

## 6) REST Endpoints (debug/minimal)

* `GET /healthz` → `{ ok: true }`
* `GET /debug/state` (dev only, guarded by `NODE_ENV !== 'production'`) → returns full `BoardDoc` JSON

---

## 7) Persistence

* Directory: `data/`
* File: `board.bin` (binary from `Automerge.save`).
* Use atomic write (write temp + rename).
* On crash/restart, load and continue.

---

## 8) Project Structure

```
server/
  src/
    index.ts            // app bootstrap
    ws.ts               // websocket server + routing
    crdt.ts             // automerge doc helpers (load/save/change/filter)
    actions.ts          // domain actions & validation
    auth.ts             // parse token -> userId (stub for MVP)
    types.ts
    persist.ts          // atomic file IO
    logger.ts
  test/
    crdt.test.ts
    actions.test.ts
  data/                 // persisted state
  .env.example
  package.json
  tsconfig.json
  vitest.config.ts
  .eslintrc.cjs
  .prettierrc
```

---

## 9) Scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "lint": "eslint . --ext .ts"
  }
}
```

---

## 10) Security (MVP → later)

* **MVP**: anonymous sessions (`anon-<id>`).
* **Later**: Bearer JWT → parse `sub` as `userId`.
* **Transport**: run behind TLS (reverse proxy).
* **CORS**: N/A for WS; if adding REST writes, configure.

---

## 11) Acceptance Criteria (MVP – Multi‑Replica)

* Start server, connect 2+ clients via WS; each converges replicas via `sync` messages.
* Client A adds a **public** post locally; sends domain action; all clients converge and display it.
* Client A adds a **private** post; only A’s replica contains it; other replicas never receive it.
* Client B cannot edit/delete A’s private posts; can like/unlike A’s public posts and change appears for all.
* Restart server → persisted state loads and subsequent sync brings clients back in line.
* Basic rate limit prevents flooding of domain actions & sync messages.
* Offline scenario: Client goes offline, performs local edits (at least add + text edit), reconnects, and after sync convergence the server persists merged state without conflicts.

---

## 12) Stretch Goals (nice if time permits)

* **Per-message deltas** (send only changed posts).
* **Optimistic UI hints**: include a server op id/echo.
* **Replay log** of actions (append-only file).
* **Admin purge** endpoint.
* **Metrics**: `/metrics` (prom-client).
* **Horizontal scale**: move state to a single CRDT-owner process; others proxy, or add a small in-cluster broker.

---

## 13) Example Code Stubs (for Codex to expand)

**`src/crdt.ts`**

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as Automerge from '@automerge/automerge';
import { BoardDoc } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'board.bin');

export async function loadDoc(): Promise<Automerge.Doc<BoardDoc>> {
  try {
    const buf = await fs.readFile(DATA_FILE);
    return Automerge.load<BoardDoc>(buf);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    return Automerge.from<BoardDoc>({ posts: [] });
  }
}

export async function saveDoc(doc: Automerge.Doc<BoardDoc>) {
  const bin = Automerge.save(doc);
  const tmp = DATA_FILE + '.tmp';
  await fs.writeFile(tmp, bin);
  await fs.rename(tmp, DATA_FILE);
}
```

**`src/actions.ts`**

```ts
import * as Automerge from '@automerge/automerge';
import { BoardDoc, Visibility, UserId, PostId } from './types';
import { randomUUID } from 'node:crypto';

export function addPost(doc: Automerge.Doc<BoardDoc>, userId: UserId, text: string, visibility: Visibility = 'public') {
  return Automerge.change(doc, 'add_post', d => {
    d.posts.push({
      id: randomUUID(),
      authorId: userId,
      text,
      createdAt: new Date().toISOString(),
      editedAt: undefined,
      likes: {},
      visibility
    });
  });
}

// edit_post, delete_post, like/unlike: similar pattern with guard checks.
```

**`src/ws.ts`**

```ts
import { WebSocketServer } from 'ws';
import * as Automerge from '@automerge/automerge';
import { filterForUser } from './filter';
import { addPost /* ... */ } from './actions';
import { saveDoc } from './crdt';
import { BoardDoc, UserId } from './types';

type Conn = { userId: UserId; ws: import('ws') };

export function createWSServer(server: import('http').Server, docRef: { doc: Automerge.Doc<BoardDoc> }) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const conns = new Set<Conn>();

  wss.on('connection', (ws, req) => {
    const userId = resolveUserId(req); // anon if needed
    const conn: Conn = { userId, ws };
    conns.add(conn);

    ws.send(JSON.stringify({ type: 'welcome', userId }));
    ws.send(JSON.stringify({ type: 'snapshot', state: filterForUser(docRef.doc, userId) }));

    ws.on('message', async raw => {
      try {
        const msg = JSON.parse(raw.toString());
        let next = docRef.doc;

        if (msg.type === 'add_post') {
          next = addPost(docRef.doc, userId, String(msg.text ?? ''), msg.visibility ?? 'public');
        }
        // ... handle other actions with validation & guards

        if (next !== docRef.doc) {
          docRef.doc = next;
          await saveDoc(docRef.doc);
          // broadcast personalized snapshots
          for (const c of conns) {
            if (c.ws.readyState === c.ws.OPEN) {
              c.ws.send(JSON.stringify({ type: 'snapshot', state: filterForUser(docRef.doc, c.userId) }));
            }
          }
        }
      } catch (e: any) {
        ws.send(JSON.stringify({ type: 'error', code: 'BAD_REQUEST', message: e?.message ?? 'invalid message' }));
      }
    });

    ws.on('close', () => conns.delete(conn));
  });

  return wss;
}
```

---

## 14) How Android & Web Clients Use It (multi-replica contract)

* Maintain a local Automerge replica (`clientDoc`).
* On connect: open WS to `/ws`; receive `welcome` then `sync` messages until convergence (apply via `receiveSyncMessage`). Optionally render initial `snapshot` for faster UI.
* Apply user edits optimistically: run `Automerge.change(clientDoc, ...)` immediately, update UI, enqueue domain action JSON to server for validation & persistence.
* Periodically (or after each local change) attempt to produce a sync message: `generateSyncMessage(clientDoc, syncState)` and send `{ type: 'sync', data }` (base64).
* On server `sync` replies, integrate and re-render only the affected posts.
* Offline: keep applying changes locally; buffer outgoing `sync` + domain actions; flush when connection restores.
* Privacy: clients only store posts they are allowed to see (received via snapshots or sync convergence). Private posts of others never materialize locally.

---

## 15) Non-Goals (for this POC)

* No peer-to-peer client sync (always via server).
* No advanced delta compression beyond Automerge sync protocol.
* No replay log UI (storage may exist as stretch goal only).
* No multi-document support.

---
