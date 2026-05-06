import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { WSContext } from "hono/ws";

process.env.BRIDGE_BINDING_SECRET = "session-registry-test-secret";
process.env.NODE_ENV = "test";

const bindingTokenModule = await import("#core/binding-token.js");
const sessionRegistry = await import("#core/session-registry.js");

bindingTokenModule.initBindingSecret();

interface TestWs {
  readonly ws: WSContext;
  readonly messages: string[];
}

interface AppStatusMessage {
  type: string;
  payload?: {
    bound?: boolean;
    bindingToken?: string;
    clientConnected?: boolean;
  };
}

function createTestWs(): TestWs {
  const messages: string[] = [];
  const ws = {
    send(data: string) {
      messages.push(data);
    },
    close() {},
  } as unknown as WSContext;
  return { ws, messages };
}

function parseAppStatus(data: string): AppStatusMessage {
  return JSON.parse(data) as AppStatusMessage;
}

describe("session registry binding reconnects", () => {
  beforeEach(() => {
    sessionRegistry.clearAllSessions();
  });

  it("rebinds an active extension when a discarded app rejoins with the same binding token", () => {
    const firstAppWs = createTestWs();
    const extensionWs = createTestWs();
    const firstApp = sessionRegistry.registerAppSession(firstAppWs.ws);
    const bindingToken = bindingTokenModule.createBindingToken(firstApp.bindingId);
    const extension = sessionRegistry.registerExtensionSession(extensionWs.ws, undefined, bindingToken);

    assert.equal(extension.appSessionId, firstApp.id);
    assert.equal(extension.bindingId, firstApp.bindingId);

    sessionRegistry.discardAppSession(firstAppWs.ws);

    assert.equal(extension.appSessionId, undefined);
    assert.equal(extension.bindingId, firstApp.bindingId);
    assert.equal(extension.pendingBindingId, firstApp.bindingId);

    const secondAppWs = createTestWs();
    const secondApp = sessionRegistry.registerAppSession(secondAppWs.ws, bindingToken);

    assert.equal(extension.appSessionId, secondApp.id);
    assert.equal(extension.pendingBindingId, undefined);

    const statuses = extensionWs.messages.map(parseAppStatus);
    assert.deepEqual(statuses.at(-2), { type: "session:appStatus", payload: { bound: false } });
    assert.deepEqual(statuses.at(-1), {
      type: "session:appStatus",
      payload: { bound: true, bindingToken, clientConnected: true },
    });
  });

  it("binds a refreshed extension to the active app using the binding token", () => {
    const appWs = createTestWs();
    const firstExtensionWs = createTestWs();
    const secondExtensionWs = createTestWs();
    const app = sessionRegistry.registerAppSession(appWs.ws);
    const bindingToken = bindingTokenModule.createBindingToken(app.bindingId);
    const firstExtension = sessionRegistry.registerExtensionSession(firstExtensionWs.ws, undefined, bindingToken);

    assert.equal(firstExtension.appSessionId, app.id);

    sessionRegistry.discardExtensionSession(firstExtensionWs.ws);

    const secondExtension = sessionRegistry.registerExtensionSession(secondExtensionWs.ws, undefined, bindingToken);

    assert.equal(secondExtension.appSessionId, app.id);
    assert.equal(secondExtension.bindingId, app.bindingId);
    assert.equal(secondExtension.pendingBindingId, undefined);
  });

  it("reclaims a disconnected extension against the active app using the remembered binding id", () => {
    const appWs = createTestWs();
    const firstExtensionWs = createTestWs();
    const secondExtensionWs = createTestWs();
    const app = sessionRegistry.registerAppSession(appWs.ws);
    const bindingToken = bindingTokenModule.createBindingToken(app.bindingId);
    const extension = sessionRegistry.registerExtensionSession(firstExtensionWs.ws, undefined, bindingToken);

    sessionRegistry.removeExtensionSession(firstExtensionWs.ws);
    const reclaimed = sessionRegistry.reclaimExtensionSession(extension.id, secondExtensionWs.ws);

    assert.equal(reclaimed?.appSessionId, app.id);
    assert.equal(reclaimed?.bindingId, app.bindingId);
    assert.equal(reclaimed?.pendingBindingId, undefined);
  });
});
