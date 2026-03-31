import { randomUUID } from "node:crypto";
import type {
  AppSessionJoinCodeMessage,
  ExtensionAppStatusMessage,
  SessionRole,
} from "@mindcraft-lang/bridge-protocol";
import type { WSContext } from "hono/ws";
import { logger } from "#core/logging/logger.js";
import { safeSend } from "#transport/ws/safe-send.js";
import { generateTriplet } from "#triplet.js";

const JOIN_CODE_TTL_MS = 10 * 60 * 1000;
const DISCONNECTED_SESSION_TTL_MS = 5 * 60 * 1000;
const DISCONNECTED_SWEEP_INTERVAL_MS = 60 * 1000;
const DISCONNECTED_MAX_SIZE = 10_000;
const DISCONNECTED_PURGE_TARGET = 8_000;

interface BaseSession {
  id: string;
  role: SessionRole;
  ws: WSContext;
  connectedAt: number;
}

export interface AppSession extends BaseSession {
  role: "app";
  joinCode: string;
  appName?: string;
  projectId?: string;
  projectName?: string;
}

export interface ExtensionSession extends BaseSession {
  role: "extension";
  appSessionId: string | undefined;
}

const appSessions = new Map<WSContext, AppSession>();
const extensionSessions = new Map<WSContext, ExtensionSession>();
const activeJoinCodes = new Set<string>();
const disconnectedAppSessions = new Map<string, { session: AppSession; disconnectedAt: number }>();
const disconnectedExtensionSessions = new Map<string, { session: ExtensionSession; disconnectedAt: number }>();
let joinCodeTimer: ReturnType<typeof setInterval> | undefined;
let disconnectedSweepTimer: ReturnType<typeof setInterval> | undefined;

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

function notifyExtensionsAppStatus(appSessionId: string, bound: boolean, clientConnected?: boolean): void {
  const extensions = getExtensionsByAppSessionId(appSessionId);
  if (extensions.length === 0) {
    logger.info({ appSessionId, bound }, "no extensions to notify of appStatus");
    return;
  }
  const payload: ExtensionAppStatusMessage["payload"] = { bound };
  if (bound) {
    const app = getAppSessionById(appSessionId);
    if (!app) {
      const disconnected = disconnectedAppSessions.get(appSessionId);
      if (disconnected) {
        payload.appName = disconnected.session.appName;
        payload.projectId = disconnected.session.projectId;
        payload.projectName = disconnected.session.projectName;
      }
    } else {
      payload.appName = app.appName;
      payload.projectId = app.projectId;
      payload.projectName = app.projectName;
    }
    if (clientConnected !== undefined) {
      payload.clientConnected = clientConnected;
    }
  }
  const msg: ExtensionAppStatusMessage = {
    type: "session:appStatus",
    payload,
  };
  const serialized = JSON.stringify(msg);
  for (const ext of extensions) {
    logger.info({ extensionSessionId: ext.id, appSessionId, bound, clientConnected }, "sending appStatus to extension");
    safeSend(ext.ws, serialized);
  }
}

function unbindExtensionsFromApp(appSessionId: string): void {
  notifyExtensionsAppStatus(appSessionId, false);
  for (const session of extensionSessions.values()) {
    if (session.appSessionId === appSessionId) {
      session.appSessionId = undefined;
      logger.info({ extensionSessionId: session.id, appSessionId }, "unbound active extension from purged app session");
    }
  }
  for (const entry of disconnectedExtensionSessions.values()) {
    if (entry.session.appSessionId === appSessionId) {
      entry.session.appSessionId = undefined;
      logger.info(
        { extensionSessionId: entry.session.id, appSessionId },
        "unbound disconnected extension from purged app session"
      );
    }
  }
}

function sweepDisconnectedSessions(): void {
  const now = Date.now();
  for (const [id, entry] of disconnectedAppSessions) {
    if (now - entry.disconnectedAt >= DISCONNECTED_SESSION_TTL_MS) {
      activeJoinCodes.delete(entry.session.joinCode);
      disconnectedAppSessions.delete(id);
      unbindExtensionsFromApp(id);
      logger.info({ sessionId: id }, "expired disconnected app session");
    }
  }
  for (const [id, entry] of disconnectedExtensionSessions) {
    if (now - entry.disconnectedAt >= DISCONNECTED_SESSION_TTL_MS) {
      disconnectedExtensionSessions.delete(id);
      logger.info({ sessionId: id }, "expired disconnected extension session");
    }
  }
  if (disconnectedAppSessions.size === 0 && disconnectedExtensionSessions.size === 0) stopDisconnectedSweepTimer();
}

function purgeDisconnectedIfNeeded(kind: "app" | "extension"): void {
  if (kind === "app") {
    if (disconnectedAppSessions.size <= DISCONNECTED_MAX_SIZE) return;
    const entries = [...disconnectedAppSessions.entries()].sort((a, b) => a[1].disconnectedAt - b[1].disconnectedAt);
    const toRemove = entries.length - DISCONNECTED_PURGE_TARGET;
    for (let i = 0; i < toRemove; i++) {
      const [id, entry] = entries[i];
      activeJoinCodes.delete(entry.session.joinCode);
      disconnectedAppSessions.delete(id);
      unbindExtensionsFromApp(id);
    }
    logger.info({ purged: toRemove, remaining: disconnectedAppSessions.size }, "purged disconnected app sessions");
  } else {
    if (disconnectedExtensionSessions.size <= DISCONNECTED_MAX_SIZE) return;
    const entries = [...disconnectedExtensionSessions.entries()].sort(
      (a, b) => a[1].disconnectedAt - b[1].disconnectedAt
    );
    const toRemove = entries.length - DISCONNECTED_PURGE_TARGET;
    for (let i = 0; i < toRemove; i++) {
      const [id] = entries[i];
      disconnectedExtensionSessions.delete(id);
    }
    logger.info(
      { purged: toRemove, remaining: disconnectedExtensionSessions.size },
      "purged disconnected extension sessions"
    );
  }
}

function ensureDisconnectedSweepTimer(): void {
  if (disconnectedSweepTimer) return;
  disconnectedSweepTimer = setInterval(sweepDisconnectedSessions, DISCONNECTED_SWEEP_INTERVAL_MS);
  disconnectedSweepTimer.unref();
}

function stopDisconnectedSweepTimer(): void {
  if (disconnectedSweepTimer) {
    clearInterval(disconnectedSweepTimer);
    disconnectedSweepTimer = undefined;
  }
}

export interface AppSessionMeta {
  appName?: string;
  projectId?: string;
  projectName?: string;
}

export function registerAppSession(ws: WSContext, meta?: AppSessionMeta): AppSession {
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
    appName: meta?.appName,
    projectId: meta?.projectId,
    projectName: meta?.projectName,
  };

  appSessions.set(ws, session);
  activeJoinCodes.add(joinCode);
  ensureJoinCodeTimer();
  logger.info({ sessionId: session.id, joinCode }, "app session registered");
  return session;
}

export function registerExtensionSession(ws: WSContext, joinCode?: string): ExtensionSession {
  const existing = extensionSessions.get(ws);
  if (existing) {
    logger.warn({ sessionId: existing.id }, "extension session already registered, replacing");
    extensionSessions.delete(ws);
  }

  let appSessionId: string | undefined;
  if (joinCode) {
    const app = getAppByJoinCode(joinCode);
    if (app) {
      appSessionId = app.id;
    } else {
      logger.warn({ joinCode }, "extension hello with unknown joinCode");
    }
  }

  const session: ExtensionSession = {
    id: `ext_${randomUUID()}`,
    role: "extension",
    ws,
    connectedAt: Date.now(),
    appSessionId,
  };

  extensionSessions.set(ws, session);
  logger.info({ sessionId: session.id, appSessionId }, "extension session registered");
  return session;
}

export function removeAppSession(ws: WSContext): AppSession | undefined {
  const session = appSessions.get(ws);
  if (session) {
    appSessions.delete(ws);
    disconnectedAppSessions.set(session.id, { session, disconnectedAt: Date.now() });
    purgeDisconnectedIfNeeded("app");
    ensureDisconnectedSweepTimer();
    notifyExtensionsAppStatus(session.id, true, false);
    if (appSessions.size === 0) {
      stopJoinCodeTimer();
    }
    logger.info({ sessionId: session.id }, "app session disconnected (available for reclaim)");
  }
  return session;
}

export function discardAppSession(ws: WSContext): AppSession | undefined {
  const session = appSessions.get(ws);
  if (session) {
    appSessions.delete(ws);
    activeJoinCodes.delete(session.joinCode);
    unbindExtensionsFromApp(session.id);
    if (appSessions.size === 0) {
      stopJoinCodeTimer();
    }
    logger.info({ sessionId: session.id }, "app session discarded (goodbye)");
  }
  return session;
}

export function reclaimAppSession(sessionId: string, ws: WSContext): AppSession | undefined {
  const entry = disconnectedAppSessions.get(sessionId);
  if (!entry) return undefined;
  disconnectedAppSessions.delete(sessionId);
  if (disconnectedAppSessions.size === 0 && disconnectedExtensionSessions.size === 0) stopDisconnectedSweepTimer();
  entry.session.ws = ws;
  entry.session.connectedAt = Date.now();
  appSessions.set(ws, entry.session);
  ensureJoinCodeTimer();

  notifyExtensionsAppStatus(entry.session.id, true, true);

  logger.info({ sessionId: entry.session.id, joinCode: entry.session.joinCode }, "app session reclaimed");
  return entry.session;
}

export function removeExtensionSession(ws: WSContext): ExtensionSession | undefined {
  const session = extensionSessions.get(ws);
  if (session) {
    extensionSessions.delete(ws);
    disconnectedExtensionSessions.set(session.id, { session, disconnectedAt: Date.now() });
    purgeDisconnectedIfNeeded("extension");
    ensureDisconnectedSweepTimer();
    logger.info({ sessionId: session.id }, "extension session disconnected (available for reclaim)");
  }
  return session;
}

export function discardExtensionSession(ws: WSContext): ExtensionSession | undefined {
  const session = extensionSessions.get(ws);
  if (session) {
    extensionSessions.delete(ws);
    logger.info({ sessionId: session.id }, "extension session discarded (goodbye)");
  }
  return session;
}

export function reclaimExtensionSession(sessionId: string, ws: WSContext): ExtensionSession | undefined {
  const entry = disconnectedExtensionSessions.get(sessionId);
  if (!entry) return undefined;
  disconnectedExtensionSessions.delete(sessionId);
  if (disconnectedAppSessions.size === 0 && disconnectedExtensionSessions.size === 0) stopDisconnectedSweepTimer();
  entry.session.ws = ws;
  entry.session.connectedAt = Date.now();
  extensionSessions.set(ws, entry.session);
  logger.info({ sessionId: entry.session.id }, "extension session reclaimed");
  return entry.session;
}

export function getAppSession(ws: WSContext): AppSession | undefined {
  return appSessions.get(ws);
}

export function getAppSessionById(sessionId: string): AppSession | undefined {
  for (const session of appSessions.values()) {
    if (session.id === sessionId) {
      return session;
    }
  }
  return undefined;
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

export function getAllAppSessions(): AppSession[] {
  return [...appSessions.values()];
}

export function getAllExtensionSessions(): ExtensionSession[] {
  return [...extensionSessions.values()];
}

export function getDisconnectedAppSessions(): { session: AppSession; disconnectedAt: number }[] {
  return [...disconnectedAppSessions.values()];
}

export function getDisconnectedExtensionSessions(): { session: ExtensionSession; disconnectedAt: number }[] {
  return [...disconnectedExtensionSessions.values()];
}

export function getExtensionsByAppSessionId(appSessionId: string): ExtensionSession[] {
  const result: ExtensionSession[] = [];
  for (const session of extensionSessions.values()) {
    if (session.appSessionId === appSessionId) {
      result.push(session);
    }
  }
  return result;
}

export function getAppByJoinCode(joinCode: string): AppSession | undefined {
  for (const session of appSessions.values()) {
    if (session.joinCode === joinCode) {
      return session;
    }
  }
  return undefined;
}

export function disconnectSessionById(sessionId: string): boolean {
  for (const session of appSessions.values()) {
    if (session.id === sessionId) {
      session.ws.close(1000, "closed via repl");
      return true;
    }
  }
  for (const session of extensionSessions.values()) {
    if (session.id === sessionId) {
      session.ws.close(1000, "closed via repl");
      return true;
    }
  }
  return false;
}

export function closeAllSessions(): void {
  stopJoinCodeTimer();
  stopDisconnectedSweepTimer();
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
  disconnectedAppSessions.clear();
  disconnectedExtensionSessions.clear();
}

export function clearAllSessions(): void {
  stopJoinCodeTimer();
  stopDisconnectedSweepTimer();
  appSessions.clear();
  extensionSessions.clear();
  activeJoinCodes.clear();
  disconnectedAppSessions.clear();
  disconnectedExtensionSessions.clear();
}
