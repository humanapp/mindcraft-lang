---
applyTo: "packages/bridge-client/**"
---

<!-- Last reviewed: 2026-04-02 -->

# bridge-client -- Rules & Patterns

Client-side SDK for vscode-bridge communication: WebSocket lifecycle, in-memory
filesystem, and bidirectional sync. Consumed by `bridge-app`, `apps/sim`, and
`apps/vscode-extension`. Message types and schemas live in `bridge-protocol`.

## Build & Scripts

```
npm run build      # tsc --build (outputs to dist/)
npm run typecheck  # tsc --noEmit (src + spec)
npm run check      # biome check --write
npm run test       # tsx --test src/**/*.spec.ts
```

After changes, rebuild (`npm run build`) so downstream consumers see updated types.

## Source Layout

```
src/
  index.ts           # barrel (all public exports)
  error-codes.ts     # ErrorCode + ProtocolError
  ws-client.ts       # WsClient class (auto-reconnect WebSocket client)
  ws-client.spec.ts
  filesystem.ts      # FileSystem, NotifyingFileSystem, IFileSystem
  filesystem.spec.ts
  project/
    project.ts       # Project class (top-level entry point, owns Session + Files)
    project.spec.ts
    session.ts       # ProjectSession (WebSocket lifecycle, message handling, events)
    files.ts         # ProjectFiles (in-memory filesystem with remote change routing)
```

## Key Exports

- `WsClient` -- auto-reconnect WebSocket client (exponential backoff, request/response
  correlation via `id`, event listeners, message queuing during reconnect)
- `ErrorCode` / `ProtocolError` -- error constants and typed error class
- `FileSystem` / `NotifyingFileSystem` -- in-memory filesystem with change notifications
- `Project` -- entry point. Constructed with `ProjectOptions`, owns Session + Files.
- `ProjectSession` -- WebSocket lifecycle, message handling, session events.
- `ProjectFiles` -- filesystem wrapper with bidirectional change routing.

Types re-exported: `IFileSystem`, `StatResult`, `FileTreeEntry`, `ExportedFileSystem`,
`ExportedFileSystemEntry`, `FileSystemNotification`, `ProjectOptions`,
`ConnectionStatus`, `SessionEventMap`.

## Project

- Generic over `<TClient, TServer>` (message types supplied by consumers like `bridge-app`).
- Constructed with `ProjectOptions` (appName, bridgeUrl, wsPath,
  filesystem, optional joinCode/bindingToken). Validates required fields, throws `ProtocolError`.
- Owns `ProjectSession` and `ProjectFiles` as subsystems.
- Sequence-number deduplication: `_outboundSeq` stamps outgoing changes; `_peerSeq`
  filters duplicate inbound messages after reconnection.

## ProjectSession

Two layers of message handling:

1. **WS message handlers** (`on` / `send` / `request`) -- typed against generic TClient/TServer.
   Handlers are stored locally and re-registered on each `WsClient` so they survive
   `start()`/`stop()` cycles.

2. **Session events** (`addEventListener`) -- higher-level events derived from WS messages.
   Typed via `SessionEventMap`. Current events: `"status"` (ConnectionStatus).
   Events deduplicate (won't fire if value unchanged).

Session handshake: on connect, sends `session:hello` with metadata; server responds with
`session:welcome` (sessionId, joinCode, bindingToken).

## ProjectFiles

Two `NotifyingFileSystem` wrappers around a shared `FileSystem`:
- `toRemote` -- fires callback on local writes (outbound changes to send to bridge).
- `fromRemote` -- fires callback when applying inbound remote changes.
- `raw` -- direct access to underlying `FileSystem` (for export/import).

## Rules

- Pure types + client package. No server-side or framework-specific code.
- Message types belong in `bridge-protocol`, not here.
- All exports go through `src/index.ts`. Consumers import from `@mindcraft-lang/bridge-client`.
- Use `import type` for type-only imports within the package.
- All unsubscribe functions return `() => void`.
- `send()` throws if session not started. `on()` does not -- handlers queue for next start.
