import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectFileChange } from "@mindcraft-lang/app-host";
import type { FileSystemNotification, FolderAppMessage, FolderHostMessage } from "@mindcraft-lang/bridge-protocol";
import { FOLDER_SESSION_PROTOCOL_VERSION, FolderSessionErrorCode } from "@mindcraft-lang/bridge-protocol";
import type { FolderAppDataCodec, FolderHostPort, FolderHostSession } from "./folder-host-session.js";
import { connectFolderHostSession, FolderSessionError } from "./folder-host-session.js";
import { WorkspaceFolderStoreError, WorkspaceFolderStoreErrorCode } from "./workspace-folder-project-store.js";

const APP_NAME = "test-app";
const PROJECT_ID = "folder-project";
const MANIFEST_PATH = "mindcraft.json";

/** In-memory folder model speaking the host side of the folder-session protocol. */
class FakeFolderHost {
  readonly files = new Map<string, { content: string; etag: string }>();
  readonly directories = new Set<string>();
  readonly appliedChanges: FileSystemNotification[] = [];
  readonly manifestWrites: string[] = [];
  readonly diagnostics: Array<{ file: string; version: number; count: number }> = [];
  protocolVersion = FOLDER_SESSION_PROTOCOL_VERSION;

  private listener: ((message: FolderHostMessage) => void) | undefined;
  private etagCounter = 0;

  readonly port: FolderHostPort = {
    postMessage: (message: FolderAppMessage): void => {
      queueMicrotask(() => {
        this.handle(message);
      });
    },
    onMessage: (listener: (message: FolderHostMessage) => void): (() => void) => {
      this.listener = listener;
      return () => {
        this.listener = undefined;
      };
    },
  };

  constructor(manifestContent: string) {
    this.files.set(MANIFEST_PATH, { content: manifestContent, etag: this.mintEtag() });
  }

  setFile(path: string, content: string): string {
    const etag = this.mintEtag();
    this.files.set(path, { content, etag });
    return etag;
  }

  /** Simulate an external editor writing `path`, notifying the app. */
  emitExternalWrite(path: string, content: string): string {
    const etag = this.setFile(path, content);
    this.send({
      type: "folder:externalChange",
      payload: { action: "write", path, content, newEtag: etag },
    });
    return etag;
  }

  private mintEtag(): string {
    this.etagCounter += 1;
    return `disk-${this.etagCounter}`;
  }

  private send(message: FolderHostMessage): void {
    this.listener?.(message);
  }

  private handle(message: FolderAppMessage): void {
    switch (message.type) {
      case "folder:hello": {
        const manifest = this.files.get(MANIFEST_PATH);
        if (!manifest) {
          this.send({
            type: "folder:error",
            id: message.id,
            payload: {
              code: FolderSessionErrorCode.PROJECT_MANIFEST_NOT_FOUND,
              message: "mindcraft.json not found",
            },
          });
          return;
        }
        this.send({
          type: "folder:welcome",
          id: message.id,
          payload: {
            protocolVersion: this.protocolVersion,
            projectId: PROJECT_ID,
            manifest: { content: manifest.content, etag: manifest.etag },
          },
        });
        return;
      }
      case "folder:loadFiles": {
        const entries: Array<[string, { kind: "file"; content: string; etag: string; isReadonly: boolean }]> = [];
        for (const [path, file] of this.files) {
          if (path !== MANIFEST_PATH) {
            entries.push([path, { kind: "file", content: file.content, etag: file.etag, isReadonly: false }]);
          }
        }
        this.send({ type: "folder:files", id: message.id, payload: { entries } });
        return;
      }
      case "folder:change": {
        const change = message.payload;
        this.appliedChanges.push(change);
        switch (change.action) {
          case "write":
            this.setFile(change.path, change.content);
            break;
          case "delete":
            this.files.delete(change.path);
            break;
          case "rename": {
            const moved = this.files.get(change.oldPath);
            if (moved) {
              this.files.delete(change.oldPath);
              this.setFile(change.newPath, moved.content);
            }
            break;
          }
          case "mkdir":
            this.directories.add(change.path);
            break;
          case "rmdir": {
            this.directories.delete(change.path);
            for (const path of [...this.files.keys()]) {
              if (path.startsWith(`${change.path}/`)) {
                this.files.delete(path);
              }
            }
            break;
          }
          case "import":
            this.send({
              type: "folder:error",
              id: message.id,
              payload: {
                code: FolderSessionErrorCode.UNSUPPORTED_CHANGE,
                message: "import is not applied to a project folder",
              },
            });
            return;
        }
        this.send({ type: "folder:ack", id: message.id });
        return;
      }
      case "folder:manifestWrite": {
        this.manifestWrites.push(message.payload.content);
        this.setFile(MANIFEST_PATH, message.payload.content);
        this.send({ type: "folder:ack", id: message.id });
        return;
      }
      case "folder:diagnostics": {
        this.diagnostics.push({
          file: message.payload.file,
          version: message.payload.version,
          count: message.payload.diagnostics.length,
        });
        return;
      }
    }
  }
}

const ORDER_APP_DATA_KEY = "order";

const testCodec: FolderAppDataCodec = {
  chunkFromAppData(appData: ReadonlyMap<string, string>): unknown {
    const raw = appData.get(ORDER_APP_DATA_KEY);
    if (!raw) {
      return undefined;
    }
    try {
      return { order: JSON.parse(raw) as unknown };
    } catch {
      return undefined;
    }
  },
  appDataFromChunk(chunk: unknown): Record<string, string> {
    const order = (chunk as { order?: unknown } | undefined)?.order;
    return Array.isArray(order) ? { [ORDER_APP_DATA_KEY]: JSON.stringify(order) } : {};
  },
};

function manifestText(overrides?: Record<string, unknown>): string {
  return JSON.stringify(
    {
      name: "Folder Project",
      version: "0.1.0",
      description: "on disk",
      extensions: { "mindcraft-lang/microbit-v2": "embedded:mindcraft-lang/microbit-v2" },
      keepMe: { nested: true },
      ...overrides,
    },
    null,
    2
  );
}

async function connect(host: FakeFolderHost): Promise<FolderHostSession> {
  return connectFolderHostSession({ port: host.port, appName: APP_NAME, appDataCodec: testCodec });
}

function parseDiskManifest(host: FakeFolderHost): Record<string, unknown> {
  return JSON.parse(host.files.get(MANIFEST_PATH)?.content ?? "{}") as Record<string, unknown>;
}

describe("WorkspaceFolderProjectStore", () => {
  it("hydrates the project identity, files, and app data from the folder", async () => {
    const host = new FakeFolderHost(
      manifestText({
        brains: { "brain-1": { name: "b" } },
        app: { [APP_NAME]: { order: ["brain-1"] }, "other-app": { keep: 1 } },
      })
    );
    const mainEtag = host.setFile("src/main.ts", "export {};");
    const session = await connect(host);
    const store = session.store;

    const project = await store.getProject(PROJECT_ID);
    assert.strictEqual(project?.name, "Folder Project");
    assert.strictEqual(project.version, "0.1.0");
    assert.strictEqual(project.description, "on disk");
    assert.deepStrictEqual(project.extensions, {
      "mindcraft-lang/microbit-v2": "embedded:mindcraft-lang/microbit-v2",
    });

    const collections = await store.listProjectCollections();
    assert.strictEqual(collections.length, 1);
    const projects = await store.listProjects(collections[0].projectCollectionId);
    assert.deepStrictEqual(
      projects.map((entry) => entry.id),
      [PROJECT_ID]
    );

    const snapshot = await store.loadProjectFiles(PROJECT_ID);
    const main = snapshot?.get("src/main.ts");
    assert.ok(main && main.kind === "file");
    assert.strictEqual(main.content, "export {};");
    assert.strictEqual(main.etag, mainEtag);
    assert.strictEqual(snapshot?.has(MANIFEST_PATH), false);

    assert.strictEqual(await store.loadAppData(PROJECT_ID, "brains"), JSON.stringify({ "brain-1": { name: "b" } }));
    assert.strictEqual(await store.loadAppData(PROJECT_ID, ORDER_APP_DATA_KEY), JSON.stringify(["brain-1"]));
  });

  it("reports no app data for a fresh project without the app's chunk", async () => {
    const host = new FakeFolderHost(manifestText());
    const session = await connect(host);

    assert.strictEqual(await session.store.loadAppData(PROJECT_ID, ORDER_APP_DATA_KEY), undefined);
    assert.strictEqual(await session.store.loadAppData(PROJECT_ID, "brains"), undefined);
  });

  it("writes local edits through the change-granular path", async () => {
    const host = new FakeFolderHost(manifestText());
    const session = await connect(host);
    await session.store.loadProjectFiles(PROJECT_ID);

    const changes: ProjectFileChange[] = [
      { action: "write", path: "src/a.ts", content: "a", newEtag: "app-1" },
      { action: "write", path: "src/b.ts", content: "b", newEtag: "app-2" },
      { action: "write", path: MANIFEST_PATH, content: "{}", newEtag: "app-3" },
    ];
    await session.store.applyProjectFileChanges(PROJECT_ID, changes);

    assert.deepStrictEqual(
      host.appliedChanges.map((change) => (change.action === "write" ? change.path : change.action)),
      ["src/a.ts", "src/b.ts"]
    );
    assert.strictEqual(host.files.get("src/a.ts")?.content, "a");
    assert.strictEqual(host.files.get(MANIFEST_PATH)?.content, manifestText());
    assert.deepStrictEqual(host.manifestWrites, []);
  });

  it("saves a snapshot as the diff against the folder", async () => {
    const host = new FakeFolderHost(manifestText());
    host.setFile("src/unchanged.ts", "same");
    host.setFile("src/changed.ts", "old");
    host.setFile("src/removed.ts", "gone");
    const session = await connect(host);
    const snapshot = await session.store.loadProjectFiles(PROJECT_ID);
    assert.ok(snapshot);

    snapshot.set("src/changed.ts", { kind: "file", content: "new", etag: "app-1", isReadonly: false });
    snapshot.set("src/added.ts", { kind: "file", content: "added", etag: "app-2", isReadonly: false });
    snapshot.delete("src/removed.ts");
    await session.store.saveProjectFiles(PROJECT_ID, snapshot);

    const applied = host.appliedChanges.map((change) =>
      change.action === "write" || change.action === "delete" ? `${change.action}:${change.path}` : change.action
    );
    assert.deepStrictEqual(applied.sort(), ["delete:src/removed.ts", "write:src/added.ts", "write:src/changed.ts"]);
    assert.strictEqual(host.files.get("src/unchanged.ts")?.content, "same");
    assert.strictEqual(host.files.has("src/removed.ts"), false);

    host.appliedChanges.length = 0;
    await session.store.saveProjectFiles(PROJECT_ID, snapshot);
    assert.deepStrictEqual(host.appliedChanges, []);
  });

  it("round-trips app data through the manifest pass-through section", async () => {
    const host = new FakeFolderHost(manifestText());
    const session = await connect(host);

    await session.store.saveAppData(PROJECT_ID, "brains", JSON.stringify({ "brain-9": { name: "nine" } }));
    await session.store.saveAppData(PROJECT_ID, ORDER_APP_DATA_KEY, JSON.stringify(["brain-9"]));

    const disk = parseDiskManifest(host);
    assert.strictEqual(disk.name, "Folder Project");
    assert.deepStrictEqual(disk.keepMe, { nested: true });
    assert.deepStrictEqual(disk.brains, { "brain-9": { name: "nine" } });
    assert.deepStrictEqual(disk.app, { [APP_NAME]: { order: ["brain-9"] } });

    const reopened = await connect(new FakeFolderHost(host.files.get(MANIFEST_PATH)?.content ?? "{}"));
    assert.strictEqual(
      await reopened.store.loadAppData(PROJECT_ID, "brains"),
      JSON.stringify({ "brain-9": { name: "nine" } })
    );
    assert.strictEqual(await reopened.store.loadAppData(PROJECT_ID, ORDER_APP_DATA_KEY), JSON.stringify(["brain-9"]));
  });

  it("session-scoped app data keys stay out of the manifest", async () => {
    const host = new FakeFolderHost(manifestText());
    const session = await connect(host);

    await session.store.saveAppData(PROJECT_ID, "installed-extensions", JSON.stringify({ big: "blob" }));

    assert.deepStrictEqual(host.manifestWrites, []);
    assert.strictEqual(
      await session.store.loadAppData(PROJECT_ID, "installed-extensions"),
      JSON.stringify({ big: "blob" })
    );
  });

  it("updateProject rewrites the manifest and preserves pass-through fields", async () => {
    const host = new FakeFolderHost(manifestText());
    const session = await connect(host);

    await session.store.updateProject(PROJECT_ID, { name: "Renamed", version: "0.2.0" });

    const disk = parseDiskManifest(host);
    assert.strictEqual(disk.name, "Renamed");
    assert.strictEqual(disk.version, "0.2.0");
    assert.deepStrictEqual(disk.keepMe, { nested: true });
    const project = await session.store.getProject(PROJECT_ID);
    assert.strictEqual(project?.name, "Renamed");
  });

  it("forwards external changes with disk etags and updates its folder view", async () => {
    const host = new FakeFolderHost(manifestText());
    host.setFile("src/main.ts", "v1");
    const session = await connect(host);
    const snapshot = await session.store.loadProjectFiles(PROJECT_ID);
    assert.ok(snapshot);

    const received: ProjectFileChange[] = [];
    session.onExternalChange((change) => {
      received.push(change);
    });
    const diskEtag = host.emitExternalWrite("src/main.ts", "v2");

    assert.strictEqual(received.length, 1);
    const change = received[0];
    assert.ok(change.action === "write");
    assert.strictEqual(change.content, "v2");
    assert.strictEqual(change.newEtag, diskEtag);

    snapshot.set("src/main.ts", { kind: "file", content: "v2", etag: "app-echo", isReadonly: false });
    host.appliedChanges.length = 0;
    await session.store.saveProjectFiles(PROJECT_ID, snapshot);
    assert.deepStrictEqual(host.appliedChanges, []);
  });

  it("replays external changes received before the first listener attaches", async () => {
    const host = new FakeFolderHost(manifestText());
    const session = await connect(host);
    await session.store.loadProjectFiles(PROJECT_ID);

    host.emitExternalWrite("src/early.ts", "early");
    const received: ProjectFileChange[] = [];
    session.onExternalChange((change) => {
      received.push(change);
    });

    assert.strictEqual(received.length, 1);
    assert.ok(received[0].action === "write" && received[0].path === "src/early.ts");
  });

  it("absorbs an external manifest edit into project and app data state", async () => {
    const host = new FakeFolderHost(manifestText());
    const session = await connect(host);

    const edited = manifestText({
      name: "Edited Outside",
      brains: { "brain-x": { name: "x" } },
      app: { [APP_NAME]: { order: ["brain-x"] } },
    });
    host.files.set(MANIFEST_PATH, { content: edited, etag: "disk-manual" });
    session.onExternalChange(() => {});
    host.emitExternalWrite(MANIFEST_PATH, edited);

    const project = await session.store.getProject(PROJECT_ID);
    assert.strictEqual(project?.name, "Edited Outside");
    assert.strictEqual(
      await session.store.loadAppData(PROJECT_ID, "brains"),
      JSON.stringify({ "brain-x": { name: "x" } })
    );
    assert.strictEqual(await session.store.loadAppData(PROJECT_ID, ORDER_APP_DATA_KEY), JSON.stringify(["brain-x"]));
  });

  it("lets the last writer win under interleaved app and external writes", async () => {
    const host = new FakeFolderHost(manifestText());
    const session = await connect(host);
    await session.store.loadProjectFiles(PROJECT_ID);
    session.onExternalChange(() => {});

    await session.store.applyProjectFileChanges(PROJECT_ID, [
      { action: "write", path: "src/shared.ts", content: "app-first", newEtag: "app-1" },
    ]);
    host.emitExternalWrite("src/shared.ts", "external-second");
    await session.store.applyProjectFileChanges(PROJECT_ID, [
      { action: "write", path: "src/shared.ts", content: "app-third", newEtag: "app-2" },
    ]);
    assert.strictEqual(host.files.get("src/shared.ts")?.content, "app-third");

    host.emitExternalWrite("src/shared.ts", "external-last");
    assert.strictEqual(host.files.get("src/shared.ts")?.content, "external-last");
  });

  it("publishes compile diagnostics to the host", async () => {
    const host = new FakeFolderHost(manifestText());
    const session = await connect(host);

    session.publishDiagnostics({
      file: "src/main.ts",
      version: 1,
      diagnostics: [
        {
          severity: "error",
          message: "boom",
          code: "MC001",
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
        },
      ],
    });
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });

    assert.deepStrictEqual(host.diagnostics, [{ file: "src/main.ts", version: 1, count: 1 }]);
  });

  it("rejects the handshake on a protocol version mismatch", async () => {
    const host = new FakeFolderHost(manifestText());
    host.protocolVersion = FOLDER_SESSION_PROTOCOL_VERSION + 1;

    await assert.rejects(connect(host), (error: unknown) => {
      assert.ok(error instanceof FolderSessionError);
      assert.strictEqual(error.code, FolderSessionErrorCode.PROTOCOL_VERSION_MISMATCH);
      return true;
    });
  });

  it("refuses multi-project operations", async () => {
    const host = new FakeFolderHost(manifestText());
    const session = await connect(host);

    await assert.rejects(session.store.createProject("workspace-folder", "Another"), (error: unknown) => {
      assert.ok(error instanceof WorkspaceFolderStoreError);
      assert.strictEqual(error.code, WorkspaceFolderStoreErrorCode.UNSUPPORTED_OPERATION);
      return true;
    });
  });
});
