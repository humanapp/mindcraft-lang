---
applyTo: "packages/ts-protocol/**"
---

<!-- Last reviewed: 2026-03-27 -->

# ts-protocol -- Rules & Patterns

Shared WebSocket message protocol and client for vscode-bridge communication.
Consumed by `ts-authoring`, `vscode-bridge`, `vscode-extension`, and the sim app.

## Build & Scripts

```
npm run build      # tsc --build
npm run typecheck  # tsc --noEmit (src + spec)
npm run check      # biome check --write
npm run test       # tsx --test src/**/*.spec.ts
```

## Source Layout

```
src/
  index.ts           # barrel (WsClient, WsMessage, SessionRole, all message types)
  ws-client.ts       # WsClient class
  ws-client.spec.ts
  messages/
    index.ts         # barrel for message types
    shared.ts        # ErrorPayload (common to both roles)
    app.ts           # App* message types
    extension.ts     # Extension* message types
```

## Key Exports

- `WsMessage` -- base envelope: `{ type: string, id?: string, payload?: unknown }`
- `WsClient` -- auto-reconnect WebSocket client (exponential backoff, request/response
  correlation via `id`, event listeners, message queuing during reconnect)
- `SessionRole` -- `"app" | "extension"`
- Typed messages per role (see below)

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

## Rules

- Pure types + client package. No server-side or framework-specific code.
- Zero runtime dependencies.
- All exports go through `src/index.ts`. Consumers import from `@mindcraft-lang/ts-protocol`.
- Use `import type` for type-only imports within the package.
