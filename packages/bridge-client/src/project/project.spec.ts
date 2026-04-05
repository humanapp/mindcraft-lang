import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { WsMessage } from "@mindcraft-lang/bridge-protocol";
import { Project } from "./project.js";

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

function lastSocket(): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1);
  assert.ok(ws, "expected a MockWebSocket instance");
  return ws;
}

function parseSent(ws: MockWebSocket): WsMessage[] {
  return ws.sent.map((raw) => JSON.parse(raw) as WsMessage);
}

function sentAfter(ws: MockWebSocket, startIndex: number): WsMessage[] {
  return ws.sent.slice(startIndex).map((raw) => JSON.parse(raw) as WsMessage);
}

function createProject(): Project {
  const fs = new Map();
  fs.set("src", { kind: "directory" as const });
  fs.set("src/main.ts", {
    kind: "file" as const,
    content: "hello",
    etag: "e1",
    isReadonly: false,
  });

  return new Project({
    appName: "test",
    projectId: "test-1",
    projectName: "Test",
    bridgeUrl: "http://localhost:3000",
    wsPath: "app",
    filesystem: fs,
  });
}

function startProject(project: Project): MockWebSocket {
  project.session.start();
  const ws = lastSocket();
  ws.simulateOpen();
  return ws;
}

describe("Project seq deduplication", () => {
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

  describe("outbound seq stamping", () => {
    it("stamps monotonically increasing seq on filesystem:change", () => {
      const project = createProject();
      const ws = startProject(project);

      project.files.toRemote.write("src/a.ts", "a");
      project.files.toRemote.write("src/b.ts", "b");
      project.files.toRemote.write("src/c.ts", "c");

      const changes = parseSent(ws).filter((m) => m.type === "filesystem:change");
      assert.equal(changes.length, 3);
      assert.equal(changes[0].seq, 1);
      assert.equal(changes[1].seq, 2);
      assert.equal(changes[2].seq, 3);
    });

    it("increments seq for delete operations", () => {
      const project = createProject();
      const ws = startProject(project);

      project.files.toRemote.write("src/x.ts", "x");
      project.files.toRemote.delete("src/x.ts");

      const changes = parseSent(ws).filter((m) => m.type === "filesystem:change");
      assert.equal(changes.length, 2);
      assert.equal(changes[0].seq, 1);
      assert.equal(changes[1].seq, 2);
    });

    it("increments seq for mkdir and rmdir", () => {
      const project = createProject();
      const ws = startProject(project);

      project.files.toRemote.mkdir("src/lib");
      project.files.toRemote.rmdir("src/lib");

      const changes = parseSent(ws).filter((m) => m.type === "filesystem:change");
      assert.equal(changes.length, 2);
      assert.equal(changes[0].seq, 1);
      assert.equal(changes[1].seq, 2);
    });

    it("increments seq for rename", () => {
      const project = createProject();
      const ws = startProject(project);

      project.files.toRemote.rename("src/main.ts", "src/index.ts");

      const changes = parseSent(ws).filter((m) => m.type === "filesystem:change");
      assert.equal(changes.length, 1);
      assert.equal(changes[0].seq, 1);
    });
  });

  describe("inbound change filtering", () => {
    it("applies inbound change with no seq (backward compat)", () => {
      const project = createProject();
      const ws = startProject(project);

      ws.simulateMessage({
        type: "filesystem:change",
        payload: { action: "write", path: "src/new.ts", content: "new", newEtag: "e2" },
      });

      assert.equal(project.files.raw.read("src/new.ts"), "new");
    });

    it("applies inbound change with seq > peerSeq", () => {
      const project = createProject();
      const ws = startProject(project);

      ws.simulateMessage({
        type: "filesystem:change",
        seq: 1,
        payload: { action: "write", path: "src/new.ts", content: "v1", newEtag: "e2" },
      });

      assert.equal(project.files.raw.read("src/new.ts"), "v1");
    });

    it("discards inbound change after sync sets peerSeq", async () => {
      const project = createProject();
      const ws = startProject(project);

      const syncRequest = project.requestSync();

      const sent = parseSent(ws);
      const syncMsg = sent.find((m) => m.type === "filesystem:sync" && m.id);
      assert.ok(syncMsg?.id);

      ws.simulateMessage({
        type: "filesystem:sync",
        id: syncMsg.id,
        payload: { entries: [] },
        seq: 5,
      });

      await syncRequest;

      ws.simulateMessage({
        type: "filesystem:change",
        seq: 3,
        payload: { action: "write", path: "src/stale.ts", content: "stale", newEtag: "e3" },
      });

      assert.throws(() => project.files.raw.read("src/stale.ts"));

      ws.simulateMessage({
        type: "filesystem:change",
        seq: 6,
        payload: { action: "write", path: "src/fresh.ts", content: "fresh", newEtag: "e4" },
      });

      assert.equal(project.files.raw.read("src/fresh.ts"), "fresh");
    });

    it("discards inbound change with seq equal to peerSeq", async () => {
      const project = createProject();
      const ws = startProject(project);

      const syncRequest = project.requestSync();
      const sent = parseSent(ws);
      const syncMsg = sent.find((m) => m.type === "filesystem:sync" && m.id);
      assert.ok(syncMsg?.id);

      ws.simulateMessage({
        type: "filesystem:sync",
        id: syncMsg.id,
        payload: { entries: [] },
        seq: 3,
      });
      await syncRequest;

      ws.simulateMessage({
        type: "filesystem:change",
        seq: 3,
        payload: { action: "write", path: "src/eq.ts", content: "eq", newEtag: "e5" },
      });

      assert.throws(() => project.files.raw.read("src/eq.ts"));
    });
  });

  describe("sync seq exchange", () => {
    it("requestSync sends outboundSeq and records peer seq from response", async () => {
      const project = createProject();
      const ws = startProject(project);

      project.files.toRemote.write("src/a.ts", "a");
      project.files.toRemote.write("src/b.ts", "b");

      const beforeSync = ws.sent.length;
      const syncRequest = project.requestSync();

      const syncMsgs = sentAfter(ws, beforeSync);
      const syncReq = syncMsgs.find((m) => m.type === "filesystem:sync");
      assert.ok(syncReq);
      assert.equal(syncReq.seq, 2, "requestSync sends current outboundSeq");
      assert.ok(syncReq.id);

      ws.simulateMessage({
        type: "filesystem:sync",
        id: syncReq.id,
        payload: { entries: [] },
        seq: 10,
      });
      await syncRequest;

      ws.simulateMessage({
        type: "filesystem:change",
        seq: 10,
        payload: { action: "write", path: "src/old.ts", content: "old", newEtag: "e6" },
      });
      assert.throws(() => project.files.raw.read("src/old.ts"), "seq=10 == peerSeq, should be discarded");

      ws.simulateMessage({
        type: "filesystem:change",
        seq: 11,
        payload: { action: "write", path: "src/new.ts", content: "new", newEtag: "e7" },
      });
      assert.equal(project.files.raw.read("src/new.ts"), "new");
    });

    it("sync response handler records requester seq and includes own outboundSeq", () => {
      const project = createProject();
      const ws = startProject(project);

      project.files.toRemote.write("src/a.ts", "a");

      const beforeSyncReq = ws.sent.length;

      ws.simulateMessage({
        type: "filesystem:sync",
        id: "req-1",
        seq: 7,
      });

      const responses = sentAfter(ws, beforeSyncReq);
      const syncResp = responses.find((m) => m.type === "filesystem:sync" && m.id === "req-1");
      assert.ok(syncResp);
      assert.equal(syncResp.seq, 1, "response carries own outboundSeq");
      assert.ok(syncResp.payload, "response carries filesystem entries");

      ws.simulateMessage({
        type: "filesystem:change",
        seq: 5,
        payload: { action: "write", path: "src/stale.ts", content: "stale", newEtag: "e8" },
      });
      assert.throws(() => project.files.raw.read("src/stale.ts"), "seq=5 <= peerSeq=7, discarded");

      ws.simulateMessage({
        type: "filesystem:change",
        seq: 8,
        payload: { action: "write", path: "src/ok.ts", content: "ok", newEtag: "e9" },
      });
      assert.equal(project.files.raw.read("src/ok.ts"), "ok");
    });

    it("sync response handler ignores sync messages with payload (responses, not requests)", () => {
      const project = createProject();
      const ws = startProject(project);

      const beforeMsg = ws.sent.length;

      ws.simulateMessage({
        type: "filesystem:sync",
        id: "resp-1",
        seq: 99,
        payload: { entries: [] },
      });

      const afterMsgs = sentAfter(ws, beforeMsg);
      const syncResponses = afterMsgs.filter((m) => m.type === "filesystem:sync");
      assert.equal(syncResponses.length, 0, "should not respond to a sync that has payload");
    });
  });

  describe("seq across reconnect", () => {
    it("maintains outboundSeq counter across reconnects", () => {
      const project = createProject();
      const ws1 = startProject(project);

      project.files.toRemote.write("src/a.ts", "a");
      project.files.toRemote.write("src/b.ts", "b");

      const changesWs1 = parseSent(ws1).filter((m) => m.type === "filesystem:change");
      assert.equal(changesWs1[changesWs1.length - 1].seq, 2);

      ws1.simulateClose();
      mock.timers.tick(1000);

      const ws2 = lastSocket();
      assert.notEqual(ws2, ws1, "new socket created after reconnect timer");

      project.files.toRemote.mkdir("src/lib");

      ws2.simulateOpen();

      const allMsgs = parseSent(ws2);
      const changes = allMsgs.filter((m) => m.type === "filesystem:change");
      assert.ok(changes.length >= 1);
      assert.equal(changes[0].seq, 3, "continues from previous outboundSeq");
    });
  });
});
