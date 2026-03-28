import { randomUUID } from "node:crypto";
import type { SessionRole } from "@mindcraft-lang/ts-protocol";
import type { WSContext } from "hono/ws";
import { logger } from "#core/logging/logger.js";

interface BaseSession {
  id: string;
  role: SessionRole;
  ws: WSContext;
  connectedAt: number;
}

export interface AppSession extends BaseSession {
  role: "app";
}

export interface ExtensionSession extends BaseSession {
  role: "extension";
}

const appSessions = new Map<WSContext, AppSession>();
const extensionSessions = new Map<WSContext, ExtensionSession>();

export function registerAppSession(ws: WSContext): AppSession {
  const existing = appSessions.get(ws);
  if (existing) {
    logger.warn({ sessionId: existing.id }, "app session already registered, replacing");
    appSessions.delete(ws);
  }

  const session: AppSession = {
    id: `app_${randomUUID()}`,
    role: "app",
    ws,
    connectedAt: Date.now(),
  };

  appSessions.set(ws, session);
  logger.info({ sessionId: session.id }, "app session registered");
  return session;
}

export function registerExtensionSession(ws: WSContext): ExtensionSession {
  const existing = extensionSessions.get(ws);
  if (existing) {
    logger.warn({ sessionId: existing.id }, "extension session already registered, replacing");
    extensionSessions.delete(ws);
  }

  const session: ExtensionSession = {
    id: `ext_${randomUUID()}`,
    role: "extension",
    ws,
    connectedAt: Date.now(),
  };

  extensionSessions.set(ws, session);
  logger.info({ sessionId: session.id }, "extension session registered");
  return session;
}

export function removeAppSession(ws: WSContext): AppSession | undefined {
  const session = appSessions.get(ws);
  if (session) {
    appSessions.delete(ws);
    logger.info({ sessionId: session.id }, "app session removed");
  }
  return session;
}

export function removeExtensionSession(ws: WSContext): ExtensionSession | undefined {
  const session = extensionSessions.get(ws);
  if (session) {
    extensionSessions.delete(ws);
    logger.info({ sessionId: session.id }, "extension session removed");
  }
  return session;
}

export function getAppSession(ws: WSContext): AppSession | undefined {
  return appSessions.get(ws);
}

export function getExtensionSession(ws: WSContext): ExtensionSession | undefined {
  return extensionSessions.get(ws);
}

export function getSessionCount(): { apps: number; extensions: number } {
  return {
    apps: appSessions.size,
    extensions: extensionSessions.size,
  };
}

export function closeAllSessions(): void {
  for (const session of appSessions.values()) {
    try {
      session.ws.close(1001, "server shutting down");
    } catch {}
  }
  for (const session of extensionSessions.values()) {
    try {
      session.ws.close(1001, "server shutting down");
    } catch {}
  }
  appSessions.clear();
  extensionSessions.clear();
}

export function clearAllSessions(): void {
  appSessions.clear();
  extensionSessions.clear();
}
