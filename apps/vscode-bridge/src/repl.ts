import repl from "node:repl";
import { logger } from "#core/logging/logger.js";
import {
  disconnectSessionById,
  getAllAppSessions,
  getAllExtensionSessions,
  getDisconnectedAppSessions,
  getDisconnectedExtensionSessions,
  getSessionCount,
  killSessionById,
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
      console.log(`  ${s.id}  joinCode=${s.joinCode}  appName=${s.appName}  projectName=${s.projectName}  age=${age}s`);
    }
  }

  if (extensions.length > 0) {
    console.log("\nExtension sessions:");
    for (const s of extensions) {
      const age = Math.round((Date.now() - s.connectedAt) / 1000);
      console.log(`  ${s.id}  appSessionId=${s.appSessionId ?? "(none)"}  age=${age}s`);
    }
  }

  const disconnectedApps = getDisconnectedAppSessions();
  const disconnectedExts = getDisconnectedExtensionSessions();

  if (disconnectedApps.length > 0) {
    console.log("\nDisconnected app sessions:");
    for (const { session: s, disconnectedAt } of disconnectedApps) {
      const ago = Math.round((Date.now() - disconnectedAt) / 1000);
      console.log(
        `  ${s.id}  joinCode=${s.joinCode}  appName=${s.appName}  projectName=${s.projectName}  disconnected=${ago}s ago`
      );
    }
  }

  if (disconnectedExts.length > 0) {
    console.log("\nDisconnected extension sessions:");
    for (const { session: s, disconnectedAt } of disconnectedExts) {
      const ago = Math.round((Date.now() - disconnectedAt) / 1000);
      console.log(`  ${s.id}  appSessionId=${s.appSessionId ?? "(none)"}  disconnected=${ago}s ago`);
    }
  }

  if (apps.length === 0 && extensions.length === 0 && disconnectedApps.length === 0 && disconnectedExts.length === 0) {
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

function killSession(sessionId: string): void {
  if (!sessionId) {
    console.log("Usage: kill <sessionId>");
    return;
  }
  const killed = killSessionById(sessionId);
  if (killed) {
    console.log(`Killed and purged session ${sessionId}`);
  } else {
    console.log(`No session found with id: ${sessionId}`);
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
        case "kill":
          killSession(args[0]);
          break;
        case "help":
          console.log("\nCommands:");
          console.log("  sessions, ls      List all sessions (connected + disconnected)");
          console.log("  disconnect <id>   Disconnect a session's WebSocket");
          console.log("  kill <id>         Close and permanently purge a session");
          console.log("  help              Show this help");
          console.log("  .exit             Exit the process\n");
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
