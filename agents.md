# Agents

This document captures the human and software "agents" that participate in the centralized CRDT server defined in `specs.md`. Treat each agent as an operational role with clear inputs, outputs, and hand-offs so the team can reason about behavior, testing needs, and future automation.

## 1. System-Level Picture
- **Single Node.js process** orchestrates all server-side agents. It is responsible for loading the Automerge document, wiring network transports, and persisting state.
- **Clients (Android, web tools, CLI)** are out of scope for this repository, but the server assumes they speak the JSON protocol in Section 4 of `specs.md`.
- **Data gravity** stays server-side: the server runs the only Automerge replica and ships filtered snapshots to each client.

Client actions flow through the WebSocket session agent, which invokes domain action helpers, updates the Automerge document, persists via the persistence agent, and finally broadcasts filtered snapshots back to every client.

## 2. Server-Side Agents

### 2.1 Bootstrap Agent (`src/index.ts`)
- **Responsibilities**: Startup coordination. Loads persisted Automerge state, instantiates HTTP (Express) and WebSocket servers, and shares the live document reference with downstream agents.
- **Inputs**: `loadDoc()` output, ENV configuration (port, persistence paths), logger.
- **Outputs**: Running Express app (`/healthz`, `/debug/state`) and WebSocketServer bound to `/ws`.
- **Failure handling**: Exit on unrecoverable bootstrap errors; rely on process manager to restart.

### 2.2 Automerge Document Agent (`src/crdt.ts`)
- **Responsibilities**: Encapsulates reading/writing the canonical `BoardDoc`. Creates an empty document when no persisted file exists, and flushes changes after every accepted action.
- **Inputs**: File system (`data/board.bin`), Automerge API, atomic write helper.
- **Outputs**: Mutable Automerge document handle used by action and broadcast agents.
- **Invariants**: Always write via temp file + rename; ensures durability promised in Section 7 of `specs.md`.

### 2.3 Domain Action Agent (`src/actions.ts`)
- **Responsibilities**: Apply validated client intent to the Automerge document. Each exported helper wraps a single `Automerge.change()` invocation.
- **Inputs**: Current Automerge doc, caller userId, message payload.
- **Outputs**: New Automerge doc reference (immutability per Automerge v2).
- **Guards**:
  - `authorId` ownership checks for `edit_post` and `delete_post`.
  - Like/unlike ensures idempotent toggling (map membership).
  - Default visibility `public` when unspecified.
- **Error Surface**: Throw descriptive errors for invalid input; WebSocket agent converts them to `{ type: 'error' }`.

### 2.4 WebSocket Session Agent (`src/ws.ts`)
- **Responsibilities**:
  1. Resolve `userId` from JWT token or synthesize `anon-<shortid>`.
  2. Send welcome + initial snapshot.
  3. Parse and route client messages to domain action agent.
  4. After a successful change, persist state and broadcast personalized snapshots to all open connections.
- **Inputs**: HTTP upgrade request, incoming JSON frames, live Automerge reference.
- **Outputs**: JSON messages serialized to each WebSocket.
- **Privacy contract**: Use `filterForUser` to prevent leakage of private posts to other users.
- **Reliability**: Remove connections on close, guard `ws.readyState` before sending, and catch parse/validation errors.

### 2.5 Filtering Agent (`src/filter.ts`)
- **Responsibilities**: Given the canonical `BoardDoc` and a `userId`, produce `FilteredBoard` containing:
  - All public posts.
  - Private posts authored by the user.
- **Usage**: Called on every snapshot broadcast and by `/debug/state` endpoints with elevated visibility.

### 2.6 Persistence Agent (`src/persist.ts`)
- **Responsibilities**: Provide atomic write APIs (`writeFileAtomic`) and shared filesystem utilities. Underpins the Automerge Document Agent.
- **Notes**: Uses `fs.promises` with `writeFile` + `rename`. Ensures directories exist.

### 2.7 Auth Agent (`src/auth.ts`)
- **Responsibilities**: Parse bearer tokens (future) and surface `userId`. For MVP, returns anonymous IDs. Keep stateless to avoid shared mutable state between connections.

### 2.8 Logging & Observability Agent (`src/logger.ts`)
- **Responsibilities**: Wrap console logging with structured metadata. Emit at least `info` on connections/actions and `warn/error` on malformed messages. Prepare for future metrics (`prom-client`) as noted in Stretch Goals.

### 2.9 Rate Limiter (future placeholder)
- **Context**: Acceptance criteria call for "basic rate limit." Implement either:
  - Token bucket per `userId` on the WebSocket agent, or
  - Express middleware for REST endpoints.
- **Ownership**: Lives alongside WebSocket agent once implemented.

## 3. Client-Facing Agents (External)

### 3.1 Android App
- Opens `/ws`, stores `userId` from `welcome`, reconciles UI with each `snapshot`.
- Sends domain actions verbatim; no CRDT logic client-side.

### 3.2 Developer Tooling
- CLI or web playground can reuse the same protocol for diagnostics.
- `/debug/state` gives full board visibility; lock behind auth before production.

## 4. Lifecycle & Hand-offs
1. **Startup**
   - Bootstrap agent loads document via Automerge agent.
   - Express and WebSocket servers start listening.
2. **Connection**
   - WebSocket agent resolves `userId` (Auth agent) and immediately sends `welcome` + filtered `snapshot`.
3. **Message Flow**
   - WebSocket agent validates payload shape and rate limit.
   - Domain action agent applies change; Automerge agent persists.
   - Broadcast loop iterates all sessions, using Filtering agent to tailor payloads.
4. **Persistence**
   - After every committed change, call `saveDoc()`. On restart, state resumes seamlessly (Section 5/7 in `specs.md`).
5. **Shutdown**
   - Graceful close should flush ongoing writes; rely on process manager for restart.

## 5. Error Surfaces & Recovery
- **Client errors**: Send `{ type: 'error', code: 'BAD_REQUEST', message }`. Do not tear down connection unless abusive.
- **Persistence errors**: Log and surface 5xx via `/healthz`; consider marking server unhealthy to trigger restart.
- **Automerge conflicts**: Impossible because the server is the lone replica; conflicts arise only from concurrent actions and are handled by Automerge change semantics.
- **Backpressure**: If snapshot broadcast fails (socket backpressure), log and drop connection to protect event loop.

## 6. Testing Touchpoints
- Use `vitest` for:
  - Domain action behavior (ownership, timestamps, likes).
  - Filtering logic for visibility rules.
  - Persistence round-trips (load/save).
- WebSocket agent can be smoke-tested with integration tests that mock WebSocket frames.

## 7. Operational Notes
- Store persisted data under `data/board.bin`. Ensure volume mounts or backups in production.
- Run server via `pnpm dev` (tsx watcher) during development; `pnpm build && pnpm start` for deployed environments.
- Consider containerizing for deployment, but keep Node.js ≥ 20 per spec.
- Monitor disk usage; Automerge documents can grow, but snapshot strategy (no deltas) trades bandwidth for simplicity.

---

This document should evolve with the codebase. Each new subsystem (metrics, replay log, admin tooling) should declare its owning agent, dependencies, and failure modes here to maintain a shared mental model.
