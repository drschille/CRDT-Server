# spec.md — Centralized CRDT Server (TypeScript) for “Collaborative Shopping”

## 1) Goal (MVP)

Build a **TypeScript Node.js** server that maintains **collaborative shopping / wish lists** and a **separate bulletin board** using Automerge. Each shopping list lives in its own Automerge document, while the bulletin board has an independent document. A lightweight registry document keeps track of list metadata so clients can discover and subscribe to the lists they care about.

* **Documents**:
  * `ListRegistryDoc` — canonical index of lists (id, name, owner, collaborators, visibility, etc.).
  * `ShoppingListDoc` — one per list; stores the items for that list only.
  * `BulletinDoc` — holds announcement posts, independent from shopping lists.
* **Eventual consistency**: implemented server-side using **Automerge v3**.
* **Transport**: WebSocket for realtime; minimal REST for health/debug.
* **Auth (optional for MVP)**: anonymous or simple bearer token.
* **Clients**: Minimalistic with **Automerge replica**.

> Rationale: The server owns the canonical Automerge replicas for the registry, each shopping list, and the bulletin board. Clients subscribe only to the documents they are authorized to see, reducing payload size for large deployments. Users apply local **domain actions** (`create_list`, `add_item`, `set_item_quantity`, etc.) optimistically to the relevant replica, then exchange Automerge sync messages with the server to converge. Bulletin announcements remain available even if no lists are shared between users.

---

## 2) Tech & Constraints

* **Runtime**: Node.js ≥ 20
* **Lang**: TypeScript
* **CRDT**: `@automerge/automerge` v3
* **WebSocket**: `ws`
* **REST**: `express` (health + debug only)
* **Persistence**: write `automerge.save(doc)` to `data/board.bin` (atomic write)
* **Testing**: `vitest`
* **Lint/Format**: `eslint`, `prettier`
* **Dev**: `pnpm` or `npm`

---

## 3) Data Model

```ts
type ListId = string;      // UUID v4 (server-side)
type ItemId = string;      // UUID v4 (per list)
type BulletinId = string;  // UUID v4 for bulletins
type UserId = string;      // From auth header or connection param; "anon-<connId>" if missing

type Visibility = 'public' | 'private';

// 3.1 Registry document -----------------------------------------------------

interface ListRegistryEntry {
  id: ListId;
  ownerId: UserId;
  name: Automerge.Text;
  createdAt: string;
  updatedAt?: string;
  visibility: Visibility;              // public lists discoverable by others; private lists scoped to owner + collaborators
  collaborators: Record<UserId, true>; // editors besides owner
  archived?: boolean;
}

interface ListRegistryDoc {
  lists: ListRegistryEntry[];
}

// Snapshot representation for convenience:
interface FilteredRegistryEntry {
  id: ListId;
  ownerId: UserId;
  name: string;
  createdAt: string;
  updatedAt?: string;
  visibility: Visibility;
  collaborators: Record<UserId, true>;
  archived?: boolean;
}

// 3.2 Shopping list document ------------------------------------------------

interface ListItem {
  id: ItemId;
  label: Automerge.Text;
  createdAt: string;
  addedBy: UserId;
  quantity?: string;      // free-form (e.g., "3", "2 packs")
  vendor?: string;        // optional vendor / store hint
  notes?: Automerge.Text; // optional detail text
  checked?: boolean;      // toggle for purchased items
}

interface ShoppingListDoc {
  listId: ListId;
  items: ListItem[];
}

interface FilteredItem {
  id: ItemId;
  label: string;
  createdAt: string;
  addedBy: UserId;
  quantity?: string;
  vendor?: string;
  notes?: string;
  checked?: boolean;
}

interface FilteredListDoc {
  listId: ListId;
  items: FilteredItem[];
}

// 3.3 Bulletin document -----------------------------------------------------

interface Bulletin {
  id: BulletinId;
  authorId: UserId;
  text: Automerge.Text;
  createdAt: string;
  editedAt?: string;
  visibility: Visibility;
}

interface BulletinDoc {
  bulletins: Bulletin[];
}

interface FilteredBulletin {
  id: BulletinId;
  authorId: UserId;
  text: string;
  createdAt: string;
  editedAt?: string;
  visibility: Visibility;
}
```

### Privacy/editing rules

* `public` lists are visible in the registry to everyone; `private` lists appear only to their `ownerId` and `collaborators`.
* Access to a list’s items requires visibility in the registry (owner or collaborator for private lists).
* Each list document enforces that only the owner or collaborators may mutate items.
* The bulletin board is independent: `public` bulletins are visible to all users, `private` bulletins remain visible only to the author.
* Archiving a list marks it hidden but leaves historical data intact (stretch goal).

---

## 4) Network Protocol

### 4.1 WebSocket URL

```
ws://<HOST>/ws?token=<JWT-optional>
```

* Extract `userId` from JWT if present; else generate `anon-<shortid>` for session.

### 4.2 Client → Server messages (JSON)

Clients first identify themselves, then subscribe to one or more documents. Sync traffic is scoped per document.

```ts
type ClientMsg =
  | { type: 'hello'; clientVersion: string }
  | { type: 'subscribe'; doc: 'registry' | 'bulletins' | { listId: ListId } }
  | { type: 'unsubscribe'; doc: 'registry' | 'bulletins' | { listId: ListId } }
  | { type: 'registry_action'; action: RegistryAction }
  | { type: 'list_action'; listId: ListId; action: ListAction }
  | { type: 'bulletin_action'; action: BulletinAction }
  | { type: 'sync'; doc: 'registry' | 'bulletins' | { listId: ListId }; data: Uint8Array }
  | { type: 'request_full_state'; doc?: 'registry' | 'bulletins' | { listId: ListId } };

type RegistryAction =
  | { type: 'create_list'; name: string; visibility?: Visibility; collaborators?: UserId[] }
  | { type: 'rename_list'; listId: ListId; name: string }
  | { type: 'update_list_visibility'; listId: ListId; visibility: Visibility }
  | { type: 'set_collaborators'; listId: ListId; collaborators: UserId[] }
  | { type: 'archive_list'; listId: ListId }
  | { type: 'delete_list'; listId: ListId }; // hard delete (optional)

type ListAction =
  | { type: 'add_item'; label: string; quantity?: string; vendor?: string }
  | { type: 'update_item'; itemId: ItemId; label: string }
  | { type: 'set_item_quantity'; itemId: ItemId; quantity?: string }
  | { type: 'set_item_vendor'; itemId: ItemId; vendor?: string }
  | { type: 'set_item_notes'; itemId: ItemId; notes?: string }
  | { type: 'toggle_item_checked'; itemId: ItemId; checked: boolean }
  | { type: 'remove_item'; itemId: ItemId };

type BulletinAction =
  | { type: 'add_bulletin'; text: string; visibility?: Visibility }
  | { type: 'edit_bulletin'; bulletinId: BulletinId; text: string }
  | { type: 'delete_bulletin'; bulletinId: BulletinId };
```

### 4.3 Server → Client messages (JSON)

```ts
type ServerMsg =
  | { type: 'welcome'; userId: UserId }
  | { type: 'snapshot'; doc: 'registry' | 'bulletins' | { listId: ListId }; state: unknown }
  | { type: 'sync'; doc: 'registry' | 'bulletins' | { listId: ListId }; data: Uint8Array }
  | { type: 'error'; code: string; message: string };
```

Snapshots are tailored to the requesting user:

* Registry snapshot → `FilteredRegistryEntry[]`.
* List snapshot → `FilteredListDoc` for the requested list.
* Bulletin snapshot → `FilteredBulletin[]`.

> MVP: Always send `snapshot` after each successful action (simple & robust). Incremental deltas per document remain a stretch goal.

---

## 5) Server Behavior (Multi‑Replica Automerge)

1. **Startup**

   * Load the registry document (e.g., `data/registry.bin`), creating an empty one if missing.
   * Load the bulletin document (`data/bulletins.bin`).
   * Discover persisted list documents under `data/lists/<listId>.bin`; lazily load on first subscription to avoid long boot times.
   * Start Express (`/healthz`, `/debug/state`).
   * Start WS server and accept connections.

2. **On connection (handshake)**

   * Resolve `userId`.
   * Initialize sync state maps per connection: `{ registry: SyncState; bulletins?: SyncState; lists: Map<ListId, SyncState> }`.
   * Send `{ type: 'welcome', userId }`.
   * Optionally auto-subscribe to registry and bulletin docs for faster UX.

3. **Subscriptions**

   * `subscribe` message triggers server to:
     * Authorize: ensure user can see requested document (for lists, verify registry entry + collaborators).
     * Attach connection to the document’s listener set.
     * Send immediate `snapshot` plus any pending sync messages (`generateSyncMessage`).
   * `unsubscribe` removes connection from the listener set; optionally persist sync state for fast re-entry.

4. **On client sync message**

   * Determine target document (registry, bulletins, or specific list).
   * Decode base64 → `Uint8Array`.
   * Call `Automerge.receiveSyncMessage(doc, syncState, bytes)`; store new doc and sync state if mutated.
   * Emit follow-up sync messages until `null`.

5. **On domain action (client → server)**

   * Validate payload (shape, string lengths, collaborator permissions).
   * Registry actions mutate the registry doc only; list creation also spawns a new list doc persisted at `data/lists/<id>.bin`.
   * List actions mutate the corresponding list doc after verifying edit permissions via registry entry.
   * Bulletin actions mutate the bulletin doc.
   * Persist touched documents with `writeFileAtomic`.
   * Broadcast:
     * Updated registry snapshot to registry subscribers.
     * Updated list snapshot to subscribers of that list.
     * Updated bulletin snapshot to bulletin subscribers.
     * Run sync loops for each affected document.

6. **Filtering (privacy)**

   ```ts
   function filterRegistry(doc: ListRegistryDoc, userId: UserId): FilteredRegistryEntry[] {
     return doc.lists
       .filter((list) => list.visibility === 'public' || list.ownerId === userId || Boolean(list.collaborators[userId]))
       .map(toFilteredRegistryEntry);
   }

   function filterListDoc(listDoc: ShoppingListDoc, registryEntry: ListRegistryEntry, userId: UserId): FilteredListDoc | null {
     if (registryEntry.visibility === 'public' || registryEntry.ownerId === userId || registryEntry.collaborators[userId]) {
       return {
         listId: listDoc.listId,
         items: listDoc.items.map(toFilteredItem)
       };
     }
     return null;
   }

   function filterBulletins(doc: BulletinDoc, userId: UserId): FilteredBulletin[] {
     return doc.bulletins
       .filter((b) => b.visibility === 'public' || b.authorId === userId)
       .map(toFilteredBulletin);
   }
   ```

7. **Validation & Limits**

   * List name max 200 chars; item label max 200 chars.
   * Notes text max 2,000 chars.
   * Per-user list cap (e.g., 200 lists) enforced in registry.
   * Per-list item cap (e.g., 1,000 items) enforced per list doc.
   * Optional vendor/quantity strings max 200 chars.
   * Rate-limit per connection (token bucket) to avoid flooding across all documents.

8. **Errors**

   * Send `{ type: 'error', code, message }` on invalid input or forbidden action.
   * Keep connection open unless abusive; consider temporary bans for repeated violations.

---

## 6) REST Endpoints (debug/minimal)

* `GET /healthz` → `{ ok: true }`
* `GET /debug/state` (dev only, guarded by `NODE_ENV !== 'production'`) → returns full `WishlistDoc` JSON

---

## 7) Persistence

* Directory: `data/`
* Files:
  * `registry.bin` — registry document.
  * `bulletins.bin` — bulletin board document.
  * `lists/<listId>.bin` — one file per shopping list.
* Use atomic write (write temp + rename) for every document update.
* Maintain a lightweight manifest (`lists/index.json` or rely on registry doc) to detect orphaned list files.
* On crash/restart, load registry + bulletins eagerly; load list docs lazily when first requested.

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

* Start server, connect 2+ clients via WS; each converges the registry + any subscribed documents via `sync` messages.
* Client A creates a **public shopping list**; registry updates broadcast; Client B subscribes to the new list and sees items after convergence.
* Client A invites Client B as a collaborator; both subscribe to the list doc and append items with matching results.
* Client A creates a **private wish list**; only A (and explicit collaborators) can subscribe to and view the list document.
* Bulletins posted as `public` are visible to all subscribers of the bulletin doc; `private` bulletins remain scoped to the author.
* Restart server → registry, bulletins, and individual list docs persist and reload; clients resubscribe and converge.
* Basic rate limit prevents flooding across registry/list/bulletin actions and sync messages.
* Offline scenario: Client goes offline, edits a list doc locally (add items + change notes), reconnects, and merges without conflicts once sync resumes.

---

## 12) Stretch Goals (nice if time permits)

* **Per-message deltas** (send only changed lists/items/bulletins).
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
import { WishlistDoc } from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'wishlist.bin');

export async function loadDoc(): Promise<Automerge.Doc<WishlistDoc>> {
  try {
    const buf = await fs.readFile(DATA_FILE);
    return Automerge.load<WishlistDoc>(buf);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    return Automerge.from<WishlistDoc>({ lists: [], bulletins: [] });
  }
}

export async function saveDoc(doc: Automerge.Doc<WishlistDoc>) {
  const bin = Automerge.save(doc);
  const tmp = DATA_FILE + '.tmp';
  await fs.writeFile(tmp, bin);
  await fs.rename(tmp, DATA_FILE);
}
```

**`src/actions.ts`**

```ts
import * as Automerge from '@automerge/automerge';
import { WishlistDoc, Visibility, UserId, ListId, ItemId } from './types.js';
import { randomUUID } from 'node:crypto';

const MAX_NAME = 200;
const MAX_TEXT = 2000;

export function createList(
  doc: Automerge.Doc<WishlistDoc>,
  userId: UserId,
  name: string,
  visibility: Visibility = 'private',
  collaborators: UserId[] = []
): Automerge.Doc<WishlistDoc> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name required');
  if (trimmed.length > MAX_NAME) throw new Error('Name too long');

  const uniqueCollabs = Array.from(new Set(collaborators.filter((id) => id && id !== userId)));

  return Automerge.change(doc, 'create_list', (draft) => {
    draft.lists.push({
      id: randomUUID(),
      ownerId: userId,
      name: toText(trimmed),
      createdAt: new Date().toISOString(),
      updatedAt: undefined,
      visibility,
      collaborators: Object.fromEntries(uniqueCollabs.map((id) => [id, true])),
      items: []
    });
  });
}

export function addItem(
  doc: Automerge.Doc<WishlistDoc>,
  listId: ListId,
  userId: UserId,
  label: string,
  quantity?: string,
  vendor?: string
): Automerge.Doc<WishlistDoc> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Label required');
  if (trimmed.length > MAX_NAME) throw new Error('Label too long');

  return Automerge.change(doc, 'add_item', (draft) => {
    const list = draft.lists.find((l) => l.id === listId);
    if (!list) throw new Error('List not found');
    ensureCanEdit(list, userId);
    list.items.push({
      id: randomUUID(),
      label: toText(trimmed),
      createdAt: new Date().toISOString(),
      addedBy: userId,
      quantity: quantity?.slice(0, MAX_NAME),
      vendor: vendor?.slice(0, MAX_NAME),
      notes: undefined,
      checked: false
    });
    list.updatedAt = new Date().toISOString();
  });
}

export function setItemNotes(
  doc: Automerge.Doc<WishlistDoc>,
  listId: ListId,
  itemId: ItemId,
  userId: UserId,
  notes: string | undefined
): Automerge.Doc<WishlistDoc> {
  if (notes && notes.length > MAX_TEXT) throw new Error('Notes too long');

  return Automerge.change(doc, 'set_item_notes', (draft) => {
    const list = draft.lists.find((l) => l.id === listId);
    if (!list) throw new Error('List not found');
    ensureCanEdit(list, userId);
    const item = list.items.find((i) => i.id === itemId);
    if (!item) throw new Error('Item not found');
    item.notes = notes ? toText(notes) : undefined;
    list.updatedAt = new Date().toISOString();
  });
}

function ensureCanEdit(list: WishlistDoc['lists'][number], userId: UserId): void {
  if (list.ownerId === userId) return;
  if (list.collaborators[userId]) return;
  throw new Error('Forbidden');
}

function toText(value: string): Automerge.Text {
  const text = new Automerge.Text();
  if (value) {
    text.insertAt(0, ...value);
  }
  return text;
}
```

**`src/ws.ts`**

```ts
import { WebSocketServer, type WebSocket } from 'ws';
import * as Automerge from '@automerge/automerge';
import { filterForUser } from './filter.js';
import { createList, addItem /* ... */ } from './actions.js';
import { saveDoc } from './crdt.js';
import { WishlistDoc, UserId } from './types.js';

interface Connection {
  userId: UserId;
  ws: WebSocket;
  syncState: Automerge.SyncState;
}

export function createWSServer(server: import('http').Server, docRef: { doc: Automerge.Doc<WishlistDoc> }) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const connections = new Set<Connection>();

  wss.on('connection', (ws, req) => {
    const userId = resolveUserId(req);
    const connection: Connection = { userId, ws, syncState: Automerge.initSyncState() };
    connections.add(connection);

    sendJson(ws, { type: 'welcome', userId });
    sendJson(ws, { type: 'snapshot', state: filterForUser(docRef.doc, userId) });
    flushSync(connection, docRef.doc);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'sync') {
          const [nextDoc, nextState] = Automerge.receiveSyncMessage(docRef.doc, connection.syncState, msg.data);
          docRef.doc = nextDoc;
          connection.syncState = nextState;
          flushSync(connection, docRef.doc);
          return;
        }

        switch (msg.type) {
          case 'create_list':
            docRef.doc = createList(docRef.doc, userId, msg.name, msg.visibility, msg.collaborators);
            break;
          case 'add_item':
            docRef.doc = addItem(docRef.doc, msg.listId, userId, msg.label, msg.quantity, msg.vendor);
            break;
          // … other domain actions …
          default:
            throw new Error(`Unsupported message ${msg.type}`);
        }

        await saveDoc(docRef.doc);
        for (const conn of connections) {
          if (conn.ws.readyState !== WebSocket.OPEN) continue;
          sendJson(conn.ws, { type: 'snapshot', state: filterForUser(docRef.doc, conn.userId) });
          flushSync(conn, docRef.doc);
        }
      } catch (error) {
        sendJson(ws, {
          type: 'error',
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'invalid message'
        });
      }
    });

    ws.on('close', () => connections.delete(connection));
  });
}

function flushSync(connection: Connection, doc: Automerge.Doc<WishlistDoc>) {
  while (true) {
    const [nextState, message] = Automerge.generateSyncMessage(doc, connection.syncState);
    connection.syncState = nextState;
    if (!message) break;
    sendJson(connection.ws, { type: 'sync', data: message });
  }
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}
```

---

## 14) How Android & Web Clients Use It (multi-replica contract)

* Maintain local Automerge replicas per subscribed document (registry, bulletins, each list).
* On connect: open WS to `/ws`; receive `welcome`; immediately subscribe to registry + bulletins (and remembered list IDs). Apply `sync` messages via `receiveSyncMessage` until convergence. Render initial `snapshot` for faster UI.
* Apply user edits optimistically: mutate the specific document replica, update UI, then send the appropriate `*_action` message; also send sync payloads when available.
* Periodically (or after each change) run `generateSyncMessage(docReplica, docSyncState)` and send `{ type: 'sync', doc, data }` (base64).
* On server `sync` replies, integrate only the affected document and re-render relevant views.
* Offline: keep applying changes locally per document; buffer outgoing `sync` + `*_action` messages; flush when connection restores.
* Privacy: clients only subscribe to lists authorized by the registry filter; private lists and bulletins of others are never delivered.

---

## 15) Non-Goals (for this POC)

* No peer-to-peer client sync (always via server).
* No advanced delta compression beyond Automerge sync protocol.
* No replay log UI (storage may exist as stretch goal only).
* No cross-list aggregate analytics (beyond registry metadata).

---
