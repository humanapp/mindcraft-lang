import { createApp } from "#app.js";
import { startServer } from "#server.js";

const { app, injectWebSocket } = createApp();
const server = startServer(app);
injectWebSocket(server);
