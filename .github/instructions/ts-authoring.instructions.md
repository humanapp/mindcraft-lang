---
applyTo: "packages/ts-authoring/**"
---

<!-- Last reviewed: 2026-03-27 -->

# ts-authoring -- Rules & Patterns

Client-side SDK for connecting apps to `vscode-bridge`. Consumed by `apps/sim` and
potentially other apps. Depends on `ts-protocol` for message types and `WsClient`.

## Build & Scripts

```
npm run build      # tsc --build (outputs to dist/)
npm run typecheck  # tsc --noEmit (src + spec)
npm run check      # biome check --write
npm run test       # tsx --test src/**/*.spec.ts
```

After changes, rebuild (`npm run build`) so downstream consumers (sim, etc.) see updated
types. The package uses project references (`tsconfig.json` -> `ts-protocol`).

## Source Layout

```
src/
  index.ts                # barrel -- exports Project, ProjectOptions, AuthoringError, ErrorCode
  project/
    project.ts            # Project class (top-level entry point, owns Session + Files)
    session.ts            # ProjectSession (WebSocket lifecycle, message handling, events)
    files.ts              # ProjectFiles (in-memory filesystem)
    error-codes.ts        # AuthoringError + ErrorCode enum
    files.spec.ts
```

## Key Classes

### Project

- Entry point. Constructed with `ProjectOptions` (appName, projectId, bridgeUrl, clientRole, etc.).
- Owns `ProjectSession` and `ProjectFiles` as subsystems.
- Validates options in constructor, throws `AuthoringError`.

### ProjectSession

Two layers of message handling:

1. **WS message handlers** (`on` / `send`) -- typed against `AppServerMessage` /
   `AppClientMessage` from ts-protocol. Handlers are stored locally and re-registered on
   each `WsClient` so they survive `start()`/`stop()` cycles.

2. **Session events** (`addEventListener`) -- higher-level events derived from WS messages.
   Typed via `SessionEventMap`. Current events: `"status"` (ConnectionStatus),
   `"joinCode"` (string). Events deduplicate (won't fire if value unchanged).

The session internally listens for `session:welcome` and `session:joinCode` messages to
track `sessionId` and `joinCode`.

## Patterns

- Message types come from `@mindcraft-lang/ts-protocol`. See `ts-protocol.instructions.md`
  for message conventions.
- All unsubscribe functions return `() => void`.
- `send()` throws if session not started. `on()` does not -- handlers queue for next start.
- `addEventListener` listeners also survive start/stop (stored on ProjectSession, not on
  WsClient).
