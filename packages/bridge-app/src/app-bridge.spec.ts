import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { DiagnosticEntry } from "@mindcraft-lang/bridge-app";
import {
  type AppBridgeFeature,
  type AppBridgeSnapshot,
  createAppBridge,
  type WorkspaceAdapter,
  type WorkspaceChange,
} from "@mindcraft-lang/bridge-app";
import { type ExportedFileSystem, FileSystem, type FileSystemNotification } from "@mindcraft-lang/bridge-client";
import type { WsMessage } from "@mindcraft-lang/bridge-protocol";

type WsCallback = ((...args: unknown[]) => void) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: WsCallback = null;
  onclose: WsCallback = null;
  onmessage: WsCallback = null;
  onerror: WsCallback = null;

  readonly url: string;
  readonly sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  simulateOpen(): void {
    this.onopen?.({});
  }

  simulateMessage(data: WsMessage): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose(): void {
    this.onclose?.({});
  }
}

class MemoryWorkspace implements WorkspaceAdapter {
  private readonly _fs = new FileSystem();
  private readonly _listeners = new Set<(change: WorkspaceChange) => void>();

  constructor(entries: ExportedFileSystem = new Map()) {
    this._fs.import(entries);
  }

  exportSnapshot(): ExportedFileSystem {
    return this._fs.export();
  }

  applyRemoteChange(change: WorkspaceChange): void {
    applyChange(this._fs, change);
  }

  onLocalChange(listener: (change: WorkspaceChange) => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  applyLocalChange(change: WorkspaceChange): void {
    applyChange(this._fs, change);
    for (const listener of this._listeners) {
      listener(change);
    }
  }

  read(path: string): string {
    return this._fs.read(path);
  }

  has(path: string): boolean {
    try {
      this._fs.stat(path);
      return true;
    } catch {
      return false;
    }
  }
}

function applyChange(fs: FileSystem, change: WorkspaceChange): void {
  switch (change.action) {
    case "write":
      fs.writeRestore(change.path, change.content, change.isReadonly ?? false, change.newEtag);
      break;
    case "delete":
      fs.delete(change.path);
      break;
    case "rename":
      fs.rename(change.oldPath, change.newPath);
      break;
    case "mkdir":
      fs.mkdir(change.path);
      break;
    case "rmdir":
      fs.rmdir(change.path);
      break;
    case "import":
      fs.import(new Map(change.entries));
      break;
  }
}

function lastSocket(): MockWebSocket {
  const socket = MockWebSocket.instances.at(-1);
  assert.ok(socket, "expected a MockWebSocket instance");
  return socket;
}

function parseSent(socket: MockWebSocket): WsMessage[] {
  return socket.sent.map((raw) => JSON.parse(raw) as WsMessage);
}

function createBridge(workspace: MemoryWorkspace, features: readonly AppBridgeFeature[] = []) {
  return createAppBridge({
    app: {
      id: "sim",
      name: "Sim",
      projectId: "sim-default",
      projectName: "Sim",
    },
    bridgeUrl: "http://localhost:3000",
    workspace,
    features,
  });
}

function createDiagnostic(message: string): DiagnosticEntry {
  return {
    severity: "error",
    message,
    code: "MC001",
    range: {
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 5,
    },
  };
}

describe("createAppBridge", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as Record<string, unknown>).WebSocket = MockWebSocket;
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  });

  afterEach(() => {
    mock.timers.reset();
    (globalThis as Record<string, unknown>).WebSocket = originalWebSocket;
  });

  it("tracks connection state and join code through snapshot updates", () => {
    const workspace = new MemoryWorkspace();
    const bridge = createBridge(workspace);
    const snapshots: AppBridgeSnapshot[] = [];

    bridge.onStateChange(() => {
      snapshots.push(bridge.snapshot());
    });

    bridge.start();
    const socket = lastSocket();

    assert.deepEqual(snapshots[0], { status: "connecting", joinCode: undefined });

    socket.simulateOpen();
    socket.simulateMessage({
      type: "session:welcome",
      payload: { protocolVersion: 1, sessionId: "session-1", joinCode: "JOIN-1" },
    });
    socket.simulateMessage({
      type: "session:joinCode",
      payload: { joinCode: "JOIN-2" },
    });
    socket.simulateClose();

    assert.equal(bridge.snapshot().status, "reconnecting");
    assert.equal(bridge.snapshot().joinCode, "JOIN-2");
    assert.ok(snapshots.some((snapshot) => snapshot.status === "connected"));
    assert.ok(snapshots.some((snapshot) => snapshot.joinCode === "JOIN-1"));
    assert.ok(snapshots.some((snapshot) => snapshot.joinCode === "JOIN-2"));

    bridge.stop();

    assert.deepEqual(bridge.snapshot(), { status: "disconnected", joinCode: undefined });
  });

  it("forwards local changes and applies remote changes through the workspace adapter", () => {
    const workspace = new MemoryWorkspace(
      new Map([["src/main.ts", { kind: "file", content: "const value = 1;", etag: "etag-1", isReadonly: false }]])
    );
    const bridge = createBridge(workspace);
    const remoteChanges: WorkspaceChange[] = [];

    bridge.onRemoteChange((change) => {
      remoteChanges.push(change);
    });

    bridge.start();
    const socket = lastSocket();
    socket.simulateOpen();

    const localChange: WorkspaceChange = {
      action: "write",
      path: "src/main.ts",
      content: "const value = 2;",
      isReadonly: false,
      newEtag: "etag-2",
      expectedEtag: "etag-1",
    };

    workspace.applyLocalChange(localChange);

    const localMessage = parseSent(socket).find((message) => {
      return (
        message.type === "filesystem:change" &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        "path" in message.payload
      );
    });

    assert.deepEqual(localMessage?.payload, localChange);

    const remoteChange: FileSystemNotification = {
      action: "write",
      path: "src/remote.ts",
      content: "export const remote = true;",
      isReadonly: false,
      newEtag: "etag-remote",
    };

    socket.simulateMessage({
      type: "filesystem:change",
      seq: 1,
      payload: remoteChange,
    });

    assert.equal(workspace.read("src/remote.ts"), "export const remote = true;");
    assert.deepEqual(remoteChanges, [remoteChange]);
  });

  it("applies sync responses as one import change and updates the workspace snapshot", async () => {
    const workspace = new MemoryWorkspace(
      new Map([["src/stale.ts", { kind: "file", content: "stale", etag: "etag-stale", isReadonly: false }]])
    );
    const bridge = createBridge(workspace);
    const remoteChanges: WorkspaceChange[] = [];
    let syncCount = 0;

    bridge.onRemoteChange((change) => {
      remoteChanges.push(change);
    });
    bridge.onStateChange(() => {});

    bridge.start();
    const socket = lastSocket();
    socket.simulateOpen();

    const syncPromise = bridge.requestSync();
    const syncRequest = parseSent(socket).find((message) => message.type === "filesystem:sync" && message.id);

    assert.ok(syncRequest?.id);

    const feature: AppBridgeFeature = {
      attach(context) {
        return context.onDidSync(() => {
          syncCount++;
        });
      },
    };

    const syncBridge = createBridge(workspace, [feature]);
    syncBridge.start();
    const syncSocket = lastSocket();
    syncSocket.simulateOpen();

    const secondSync = syncBridge.requestSync();
    const secondRequest = parseSent(syncSocket).find((message) => message.type === "filesystem:sync" && message.id);

    assert.ok(secondRequest?.id);

    const entries: ExportedFileSystem = new Map([
      ["src/fresh.ts", { kind: "file", content: "fresh", etag: "etag-fresh", isReadonly: false }],
    ]);

    socket.simulateMessage({
      type: "filesystem:sync",
      id: syncRequest.id,
      seq: 4,
      payload: { entries: [...entries] },
    });
    syncSocket.simulateMessage({
      type: "filesystem:sync",
      id: secondRequest.id,
      seq: 4,
      payload: { entries: [...entries] },
    });

    await syncPromise;
    await secondSync;

    assert.equal(remoteChanges.length, 1);
    assert.deepEqual(remoteChanges[0], { action: "import", entries: [...entries] });
    assert.throws(() => workspace.read("src/stale.ts"));
    assert.equal(workspace.read("src/fresh.ts"), "fresh");
    assert.equal(syncCount, 1);
  });

  it("attaches features and replays through the sync hook with publish helpers", () => {
    const workspace = new MemoryWorkspace(
      new Map([["src/main.ts", { kind: "file", content: "const value = 1;", etag: "etag-1", isReadonly: false }]])
    );
    const seenSnapshots: AppBridgeSnapshot[] = [];
    let attachedWorkspaceSize = 0;

    const feature: AppBridgeFeature = {
      attach(context) {
        seenSnapshots.push(context.snapshot());
        attachedWorkspaceSize = context.workspaceSnapshot().size;

        return context.onDidSync(() => {
          context.publishDiagnostics("src/main.ts", [createDiagnostic("unexpected token")]);
          context.publishStatus({
            file: "src/main.ts",
            success: false,
            diagnosticCount: { error: 1, warning: 0 },
          });
        });
      },
    };

    const bridge = createBridge(workspace, [feature]);
    bridge.start();
    const socket = lastSocket();
    socket.simulateOpen();

    socket.simulateMessage({
      type: "filesystem:sync",
      id: "sync-1",
      seq: 1,
    });

    const messages = parseSent(socket);
    const diagnosticsMessage = messages.find((message) => message.type === "compile:diagnostics");
    const statusMessage = messages.find((message) => message.type === "compile:status");
    const syncResponse = messages.find((message) => message.type === "filesystem:sync" && message.id === "sync-1");

    assert.equal(attachedWorkspaceSize, 1);
    assert.deepEqual(seenSnapshots[0], { status: "disconnected", joinCode: undefined });
    assert.ok(syncResponse?.payload);
    assert.deepEqual(diagnosticsMessage?.payload, {
      file: "src/main.ts",
      version: 1,
      diagnostics: [createDiagnostic("unexpected token")],
    });
    assert.deepEqual(statusMessage?.payload, {
      file: "src/main.ts",
      success: false,
      diagnosticCount: { error: 1, warning: 0 },
    });
  });
});
