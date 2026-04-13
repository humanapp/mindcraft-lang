---
applyTo: "packages/bridge-protocol/**"
---

<!-- Last reviewed: 2026-04-02 -->

# bridge-protocol -- Rules & Patterns

Protocol definition package for the Mindcraft bridge WebSocket system: message types,
Zod schemas, and filesystem notification payloads. Shared by `bridge-client`,
`bridge-app`, and `apps/vscode-bridge`. Contains no runtime logic -- only types and
validation schemas.

## Build & Scripts

```
npm run build      # tsc --build (outputs to dist/)
npm run typecheck  # tsc --noEmit
npm run check      # biome check --write
```

No test files in this package. After changes, rebuild (`npm run build`) so downstream
consumers (`bridge-client`, `bridge-app`, `vscode-bridge`) see updated types.

## Source Layout

```
src/
  index.ts           # barrel (all public exports)
  schemas.ts         # base wsMessageSchema (Zod)
  notifications.ts   # FileSystemNotification + FilesystemSyncPayload (Zod)
  messages/
    index.ts         # re-exports all message modules
    shared.ts        # session control, errors, ping/pong, filesystem messages
    app.ts           # app-role client/server message unions
    compile.ts       # compile:diagnostics + compile:status messages
    extension.ts     # extension-role client/server message unions
```

## Key Exports

- `SessionRole` -- `"app" | "extension"`, identifies the connecting client role.
- `wsMessageSchema` -- Zod schema for the base WebSocket message envelope
  (`type`, optional `id`, optional `payload`, optional `seq`).
- `fileSystemNotificationSchema` -- Zod discriminated union on `action`:
  `write`, `delete`, `rename`, `mkdir`, `rmdir`, `import`.
- `filesystemSyncPayloadSchema` -- array of `[path, entry]` tuples for full filesystem
  snapshots.
- `sessionHelloPayloadSchema` -- Zod schema for the `session:hello` handshake payload.

## Message Architecture

Messages are organized by role. Each role defines a `ClientMessage` union (sent by the
client) and a `ServerMessage` union (sent by the bridge server to that client).

### Shared messages (used by both roles)

| Type | Direction | Purpose |
|---|---|---|
| `session:hello` | client -> server | Initiate/authenticate session |
| `session:goodbye` | either | Graceful close |
| `session:error` | either | Session-scoped error |
| `error` | either | General error |
| `control:ping` | client -> server | Heartbeat request |
| `control:pong` | server -> client | Heartbeat response |
| `filesystem:change` | either | Single file/dir operation |
| `filesystem:sync` | server -> client | Full filesystem snapshot |

### App-only messages

| Type | Direction | Purpose |
|---|---|---|
| `session:welcome` | server -> client | Session confirmation (sessionId, joinCode, bindingToken) |
| `session:joinCode` | server -> client | Updated join code |
| `compile:diagnostics` | client -> server | Per-file diagnostic list |
| `compile:status` | client -> server | Compilation result summary |

### Extension-only messages

| Type | Direction | Purpose |
|---|---|---|
| `session:welcome` | server -> client | Session confirmation (sessionId only) |
| `session:appStatus` | server -> client | App binding/connection status |
| `compile:diagnostics` | server -> client | Forwarded diagnostics from app |
| `compile:status` | server -> client | Forwarded compile status from app |

## Rules

- Types-and-schemas-only package. No runtime logic, no side effects.
- All exports go through `src/index.ts`. Consumers import from
  `@mindcraft-lang/bridge-protocol`.
- Use `import type` for type-only imports.
- Zod schemas live alongside their corresponding types. If a payload needs runtime
  validation, define a Zod schema; otherwise, a plain TypeScript type is sufficient.
- Message types follow the pattern `{ type: "namespace:action"; payload?: T }`.
  The `type` field is a string literal for discriminated unions.
- Role-specific message unions (`AppClientMessage`, `AppServerMessage`,
  `ExtensionClientMessage`, `ExtensionServerMessage`) aggregate shared + role-specific
  messages. Add new messages to the correct union(s).
- `bridge-client` and `bridge-app` depend on this package. Changes here require
  rebuilding downstream consumers.
