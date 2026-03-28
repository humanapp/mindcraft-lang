import repl from "node:repl";
import { logger } from "#core/logging/logger.js";
import {
  disconnectSessionById,
  getAllAppSessions,
  getAllExtensionSessions,
  getSessionCount,
} from "#core/session-registry.js";

function listSessions(): void {
  const counts = getSessionCount();
  const apps = getAllAppSessions();
  const extensions = getAllExtensionSessions();

  console.log(`\n--- Sessions (${counts.apps} app, ${counts.extensions} extension) ---`);

  if (apps.length > 0) {
    console.log("\nApp sessions:");
    for (const s of apps) {
      const age = Math.round((Date.now() - s.connectedAt) / 1000);
      console.log(`  ${s.id}  joinCode=${s.joinCode}  age=${age}s`);
    }
  }

  if (extensions.length > 0) {
    console.log("\nExtension sessions:");
    for (const s of extensions) {
      const age = Math.round((Date.now() - s.connectedAt) / 1000);
      console.log(`  ${s.id}  age=${age}s`);
    }
  }

  if (apps.length === 0 && extensions.length === 0) {
    console.log("  (none)");
  }
  console.log();
}

function disconnectSession(sessionId: string): void {
  if (!sessionId) {
    console.log("Usage: disconnect <sessionId>");
    return;
  }
  const closed = disconnectSessionById(sessionId);
  if (closed) {
    console.log(`Disconnected WebSocket for ${sessionId}`);
  } else {
    console.log(`No active session found with id: ${sessionId}`);
  }
}

export function startRepl(): void {
  const r = repl.start({
    prompt: "bridge> ",
    ignoreUndefined: true,
    eval(input, _context, _filename, callback) {
      const trimmed = input.trim();
      if (!trimmed) {
        callback(null, undefined);
        return;
      }

      const [cmd, ...args] = trimmed.split(/\s+/);

      switch (cmd) {
        case "sessions":
        case "ls":
          listSessions();
          break;
        case "disconnect":
          disconnectSession(args[0]);
          break;
        case "help":
          console.log("\nCommands:");
          console.log("  sessions, ls      List all active sessions");
          console.log("  disconnect <id>   Disconnect a session's WebSocket");
          console.log("  help           Show this help");
          console.log("  .exit          Exit the process\n");
          break;
        default:
          console.log(`Unknown command: ${cmd}. Type "help" for available commands.`);
      }

      callback(null, undefined);
    },
  });

  r.on("exit", () => {
    logger.info("repl exit requested");
    process.kill(process.pid, "SIGTERM");
  });
}
