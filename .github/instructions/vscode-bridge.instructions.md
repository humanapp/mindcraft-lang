---
applyTo: "apps/vscode-bridge/**"
---

<!-- Last reviewed: 2026-03-27 -->

# VSCode Bridge -- Rules & Patterns

Hono + Node.js WebSocket server bridging web app clients and VS Code extensions.
Routes typed JSON messages between both sides.

## Tech Stack

Hono (HTTP + WS), @hono/node-ws, pino (logging), zod (env validation),
`@mindcraft-lang/ts-protocol` (shared message types), Biome.

## Path Aliases (Node.js subpath imports)

`#` subpath imports are defined in `package.json` `"imports"`. Pattern: `#<path>.js`
resolves to `src/<path>.ts` in dev and `dist/<path>.js` in production. Always use `.js`
extension with `#` imports.

Only use `#` imports when the alternative would require `..` segments. Same-directory and
child-directory imports use relative paths (`./foo.js`, `./sub/bar.js`).

## Scripts

```
npm run dev        # tsx watch with .env
npm run build      # tsc --build
npm run start      # runs compiled dist/
npm run typecheck  # tsc --noEmit (src + spec)
npm run check      # biome check --write
npm run test       # tsx --test src/**/*.spec.ts
```

## Architecture

### Entry Point

`src/index.ts` -> `createApp()` -> `startServer()`.

### WebSocket Routes

Two WS endpoints with independent upgrade, router, and handler layers:

- `/app` -- web app clients (sim, etc.)
- `/extension` -- VS Code extension clients

### Message Protocol

JSON shape: `{ type: string, id?: string, payload?: unknown }`.
`type` routes to a handler. `id` correlates request/response pairs.

### Handler Pattern

Handlers live in `transport/ws/<side>/handlers/<domain>.handler.ts`.

Each file exports a `WsHandlerMap` (`Record<string, WsHandler>`). The router spreads all
maps into a single lookup. Signature: `(ws: WSContext, payload: unknown, id?: string) => void`.

To add a handler:
1. Create/edit `transport/ws/<side>/handlers/<domain>.handler.ts`
2. Export a `WsHandlerMap` with `"<domain>:<action>": handlerFn` entries
3. Spread it into the router's `handlers` object in `router.ts`

### Session Registry

`src/core/session-registry.ts` -- central in-memory session store keyed by `WSContext`.

- `AppSession` -- `id` (`app_<uuid>`), `ws`, `connectedAt`, `joinCode`
- `ExtensionSession` -- `id` (`ext_<uuid>`), `ws`, `connectedAt`

Registration on `session:hello`; removal on WebSocket close.

### Join Codes

Each `AppSession` gets a unique three-word triplet (`src/triplet.ts`). Tracked in a Set for
uniqueness, refreshed every 10 minutes via `setInterval`. On refresh, clients receive a
`session:joinCode` push.

### Sending Messages

Use `safeSend(ws, JSON.stringify({ type, id?, payload? }))` for all outbound messages.

### Environment

Validated by zod in `src/config/env.ts`: `NODE_ENV`, `PORT` (default 3000),
`LOG_LEVEL` (default info).

### Graceful Shutdown

`src/server.ts` handles SIGINT/SIGTERM via `closeAllSessions()` then server close with
10-second forced exit timeout.
