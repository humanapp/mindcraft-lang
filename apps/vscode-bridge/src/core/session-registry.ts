import type { SessionRole } from "@mindcraft-lang/ts-protocol";
import type { WSContext } from "hono/ws";
import { logger } from "#core/logging/logger.js";

export interface Session {
  id: string;
  role: SessionRole;
  ws: WSContext;
  connectedAt: number;
}

let nextId = 1;

const sessions = new Map<WSContext, Session>();

function generateSessionId(): string {
  return `sess_${nextId++}`;
}

export function registerSession(ws: WSContext, role: SessionRole): Session {
  const existing = sessions.get(ws);
  if (existing) {
    logger.warn({ sessionId: existing.id }, "session already registered, replacing");
    sessions.delete(ws);
  }

  const session: Session = {
    id: generateSessionId(),
    role,
    ws,
    connectedAt: Date.now(),
  };

  sessions.set(ws, session);
  logger.info({ sessionId: session.id, role }, "session registered");
  return session;
}

export function removeSession(ws: WSContext): Session | undefined {
  const session = sessions.get(ws);
  if (session) {
    sessions.delete(ws);
    logger.info({ sessionId: session.id, role: session.role }, "session removed");
  }
  return session;
}

export function getSession(ws: WSContext): Session | undefined {
  return sessions.get(ws);
}

export function getSessionsByRole(role: SessionRole): Session[] {
  const result: Session[] = [];
  for (const session of sessions.values()) {
    if (session.role === role) {
      result.push(session);
    }
  }
  return result;
}

export function getSessionCount(): { total: number; extensions: number; runtimes: number } {
  let extensions = 0;
  let runtimes = 0;
  for (const session of sessions.values()) {
    if (session.role === "extension") extensions++;
    else runtimes++;
  }
  return { total: sessions.size, extensions, runtimes };
}

export function clearAllSessions(): void {
  sessions.clear();
  nextId = 1;
}
