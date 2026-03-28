---
applyTo: "apps/vscode-bridge/**"
---

<!-- Last reviewed: 2026-03-27 -->

# VSCode Bridge -- Rules & Patterns

The vscode-bridge (`apps/vscode-bridge/`) is a **Hono + Node.js** WebSocket server that
brokers communication between a web app client and a VS Code extension. It manages sessions
for both sides and routes typed JSON messages between them.

## Tech Stack

Hono (HTTP + WS), @hono/node-ws, pino (logging), zod (env validation),
`@mindcraft-lang/ts-protocol` (shared message types), Biome.

## Path Aliases (Node.js subpath imports)

The project uses `#` subpath imports defined in `package.json` `"imports"`:

- `#config/env.js` -> `src/config/env.ts`
- `#core/logging/logger.js` -> `src/core/logging/logger.ts`
- `#core/session-registry.js` -> `src/core/session-registry.ts`
- `#transport/ws/safe-send.js` -> `src/transport/ws/safe-send.ts`
- `#transport/ws/types.js` -> `src/transport/ws/types.ts`

Pattern: `#<path>.js` resolves to `src/<path>.ts` in dev (via `tsx --conditions=development`)
and `dist/<path>.js` in production. Always use the `.js` extension with `#` imports.

Only use `#` imports when the alternative would require one or more `..` segments. Files in
the same directory or child directories should use relative paths (e.g., `./foo.js`,
`./sub/bar.js`).

## Build & Scripts

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

`src/index.ts` -> `createApp()` (Hono app with routes) -> `startServer()` (HTTP + WS).

### WebSocket Routes

Two WS endpoints, each with independent upgrade, router, and handler layers:

- `/app` -- web app clients (sim, etc.)
- `/extension` -- VS Code extension clients

### Message Protocol

All messages are JSON with the shape `{ type: string, id?: string, payload?: unknown }`.
The `type` field routes to a handler. The optional `id` correlates request/response pairs.

### Handler Pattern

Handlers are organized by domain in `handlers/` directories under each WS side:

```
transport/ws/app/handlers/session.handler.ts
transport/ws/app/handlers/control.handler.ts
transport/ws/extension/handlers/session.handler.ts
transport/ws/extension/handlers/compile.handler.ts
...
```

Each handler file exports a `WsHandlerMap` (Record<string, WsHandler>). The router file
spreads all handler maps into a single lookup table.

A `WsHandler` has the signature: `(ws: WSContext, payload: unknown, id?: string) => void`.

### Session Registry

`src/core/session-registry.ts` is the central session store. Key types:

- `AppSession` -- has `id` (`app_<uuid>`), `ws`, `connectedAt`, `joinCode`
- `ExtensionSession` -- has `id` (`ext_<uuid>`), `ws`, `connectedAt`

Sessions are keyed by `WSContext` in in-memory Maps. Registration happens when the client
sends `session:hello`; removal happens on WebSocket close.

### Join Codes

Each `AppSession` gets a unique join code (three-word triplet from `src/triplet.ts`).
Join codes are tracked in a Set for uniqueness and refreshed every 10 minutes via a single
`setInterval`. On refresh, each app session receives a `session:joinCode` push message.

### Sending Messages to Clients

Always use `safeSend(ws, JSON.stringify({ type, id?, payload? }))` from
`transport/ws/safe-send.ts`. It wraps `ws.send()` with error handling and logging.

### Adding a New Message Handler

1. Create or edit a handler file in `transport/ws/<side>/handlers/<domain>.handler.ts`
2. Export a `WsHandlerMap` with `"<domain>:<action>": handlerFn` entries
3. Import and spread it into the router's `handlers` object in `router.ts`

### Environment

Validated by zod in `src/config/env.ts`:

- `NODE_ENV` -- development | production | test (default: development)
- `PORT` -- server port (default: 3000)
- `LOG_LEVEL` -- pino log level (default: info)

### Graceful Shutdown

`src/server.ts` handles SIGINT/SIGTERM by calling `closeAllSessions()` (closes all WS
connections, clears session maps, stops timers) then shuts down the HTTP server with a
10-second forced exit timeout.
