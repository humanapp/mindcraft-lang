---
applyTo: "packages/bridge-client/**"
---

<!-- Last reviewed: 2026-03-29 -->

# bridge-client -- Rules & Patterns

Shared WebSocket protocol, filesystem, and client-side SDK for vscode-bridge communication.
Consumed by `vscode-bridge`, `apps/sim`, and `apps/vscode-extension`.

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
  schemas.ts         # WsMessage Zod schema
  ws-client.ts       # WsClient class (auto-reconnect WebSocket client)
  ws-client.spec.ts
  filesystem.ts      # FileSystem, NotifyingFileSystem, IFileSystem
  filesystem.spec.ts
  messages/
    index.ts         # barrel for message types
    shared.ts        # ErrorPayload, session/control/filesystem messages
    app.ts           # App* message types
    extension.ts     # Extension* message types
  project/
    project.ts       # Project class (top-level entry point, owns Session + Files)
    session.ts       # ProjectSession (WebSocket lifecycle, message handling, events)
    files.ts         # ProjectFiles (in-memory filesystem with remote change routing)
```

## Key Exports

### Protocol Layer

- `WsMessage` -- base envelope: `{ type: string, id?: string, payload?: unknown }`
- `WsClient` -- auto-reconnect WebSocket client (exponential backoff, request/response
  correlation via `id`, event listeners, message queuing during reconnect)
- `SessionRole` -- `"app" | "extension"`
- `ErrorCode` / `ProtocolError` -- error constants and typed error class
- `FileSystem` / `NotifyingFileSystem` -- in-memory filesystem with change notifications
- Typed messages per role (see below)

### SDK Layer

- `Project` -- entry point. Constructed with `ProjectOptions`, owns Session + Files.
- `ProjectSession` -- WebSocket lifecycle, message handling, session events.
- `ProjectFiles` -- filesystem wrapper with remote change routing.

## Message Type Conventions

Messages are separated by client role. Each role file defines:

- **Payload interfaces** -- shape of `payload` (e.g., `AppSessionWelcomePayload`)
- **Message interfaces** -- full message with `type` literal, optional `id`, typed `payload`
- **Direction unions** -- `*ClientMessage` (client -> server), `*ServerMessage` (server -> client)

Naming: `<Role><Domain><Action><Part>` where Part is `Message` or `Payload`.
Shared types (e.g., `ErrorPayload`) go in `shared.ts`.

### Adding a New Message

1. Add payload interface (if needed) and message interface to `app.ts` or `extension.ts`.
2. Add to the correct direction union (`*ClientMessage` or `*ServerMessage`).
3. Re-export from `messages/index.ts` and `src/index.ts`.

## Project Class

- Entry point. Constructed with `ProjectOptions` (appName, projectId, bridgeUrl, clientRole, etc.).
- Owns `ProjectSession` and `ProjectFiles` as subsystems.
- Validates options in constructor, throws `ProtocolError`.

## ProjectSession

Two layers of message handling:

1. **WS message handlers** (`on` / `send`) -- typed against `AppServerMessage` /
   `AppClientMessage`. Handlers are stored locally and re-registered on each `WsClient`
   so they survive `start()`/`stop()` cycles.

2. **Session events** (`addEventListener`) -- higher-level events derived from WS messages.
   Typed via `SessionEventMap`. Current events: `"status"` (ConnectionStatus).
   Events deduplicate (won't fire if value unchanged).

## Rules

- Pure types + client package. No server-side or framework-specific code.
- All exports go through `src/index.ts`. Consumers import from `@mindcraft-lang/bridge-client`.
- Use `import type` for type-only imports within the package.
- All unsubscribe functions return `() => void`.
- `send()` throws if session not started. `on()` does not -- handlers queue for next start.
