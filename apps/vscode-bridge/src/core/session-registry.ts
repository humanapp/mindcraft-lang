import { randomUUID } from "node:crypto";
import type { AppSessionJoinCodeMessage, SessionRole } from "@mindcraft-lang/ts-protocol";
import type { WSContext } from "hono/ws";
import { logger } from "#core/logging/logger.js";
import { safeSend } from "#transport/ws/safe-send.js";
import { generateTriplet } from "#triplet.js";

const JOIN_CODE_TTL_MS = 10 * 60 * 1000;

interface BaseSession {
  id: string;
  role: SessionRole;
  ws: WSContext;
  connectedAt: number;
}

export interface AppSession extends BaseSession {
  role: "app";
  joinCode: string;
}

export interface ExtensionSession extends BaseSession {
  role: "extension";
}

const appSessions = new Map<WSContext, AppSession>();
const extensionSessions = new Map<WSContext, ExtensionSession>();
const activeJoinCodes = new Set<string>();
let joinCodeTimer: ReturnType<typeof setInterval> | undefined;

function generateUniqueJoinCode(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = generateTriplet();
    if (!activeJoinCodes.has(code)) {
      return code;
    }
  }
  return `${generateTriplet()}-${randomUUID().slice(0, 8)}`;
}

function refreshAllJoinCodes(): void {
  for (const session of appSessions.values()) {
    activeJoinCodes.delete(session.joinCode);
    const newCode = generateUniqueJoinCode();
    session.joinCode = newCode;
    activeJoinCodes.add(newCode);
    const msg: AppSessionJoinCodeMessage = {
      type: "session:joinCode",
      payload: { joinCode: newCode },
    };
    safeSend(session.ws, JSON.stringify(msg));
  }
  logger.info({ count: appSessions.size }, "refreshed all join codes");
}

function ensureJoinCodeTimer(): void {
  if (joinCodeTimer) return;
  joinCodeTimer = setInterval(refreshAllJoinCodes, JOIN_CODE_TTL_MS);
  joinCodeTimer.unref();
}

function stopJoinCodeTimer(): void {
  if (joinCodeTimer) {
    clearInterval(joinCodeTimer);
    joinCodeTimer = undefined;
  }
}

export function registerAppSession(ws: WSContext): AppSession {
  const existing = appSessions.get(ws);
  if (existing) {
    logger.warn({ sessionId: existing.id }, "app session already registered, replacing");
    activeJoinCodes.delete(existing.joinCode);
    appSessions.delete(ws);
  }

  const joinCode = generateUniqueJoinCode();
  const session: AppSession = {
    id: `app_${randomUUID()}`,
    role: "app",
    ws,
    connectedAt: Date.now(),
    joinCode,
  };

  appSessions.set(ws, session);
  activeJoinCodes.add(joinCode);
  ensureJoinCodeTimer();
  logger.info({ sessionId: session.id, joinCode }, "app session registered");
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
    activeJoinCodes.delete(session.joinCode);
    appSessions.delete(ws);
    if (appSessions.size === 0) {
      stopJoinCodeTimer();
    }
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
  stopJoinCodeTimer();
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
  activeJoinCodes.clear();
}

export function clearAllSessions(): void {
  stopJoinCodeTimer();
  appSessions.clear();
  extensionSessions.clear();
  activeJoinCodes.clear();
}
