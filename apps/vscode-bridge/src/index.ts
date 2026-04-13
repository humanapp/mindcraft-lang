import { createApp } from "#app.js";
import { env } from "#config/env.js";
import { initBindingSecret } from "#core/binding-token.js";
import { startRepl } from "#repl.js";
import { startServer } from "#server.js";

initBindingSecret();
const { app, injectWebSocket } = createApp();
const server = startServer(app);
injectWebSocket(server);

if (env.NODE_ENV === "development" && process.stdin.isTTY) {
  startRepl();
}
