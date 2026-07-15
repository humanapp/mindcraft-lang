import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  ActiveProject,
  ExtensionFetchTransport,
  ProjectCollection,
  ProjectFileSystem,
  ProjectManager,
} from "@mindcraft-lang/app-host";
import {
  createInMemoryProjectFileSystem,
  createJsDelivrExtensionTransport,
  ExtensionAddInputErrorCode,
  ExtensionFetchErrorCode,
} from "@mindcraft-lang/app-host";
import { BrainDef, coreModule } from "@mindcraft-lang/core/app";
import { declarationMount } from "@mindcraft-lang/ts-compiler";
import { AppEnvironmentHost } from "./app-environment-host.js";
import { buildExtensionCatalog } from "./extension-catalog.js";
import { parseExtensionInstallLog } from "./extension-install-log.js";
import { parseInstalledExtensionSnapshots } from "./fetched-extension-snapshots.js";

const CORE_AMBIENT = readFileSync(
  fileURLToPath(new URL("../../core/ambient/mindcraft.core.d.ts", import.meta.url)),
  "utf8"
);

const PROJECT_ID = "install-pipeline-project";

const encoder = new TextEncoder();

/**
 * In-memory transport over text content keyed by `<owner>/<repo>@<pin>`, with
 * branch heads keyed by `<owner>/<repo>#<branch>` and published version lists
 * keyed by `<owner>/<repo>`. Branch heads and version lists are mutable so a
 * test can move the source between installs.
 */
function createTestTransport(options: {
  content: Record<string, Record<string, string>>;
  branches?: Record<string, string>;
  versions?: Record<string, readonly string[]>;
}): ExtensionFetchTransport & { requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    async fetchFile(owner, repo, pin, path) {
      requests.push(`file ${owner}/${repo}@${pin} ${path}`);
      const content = options.content[`${owner}/${repo}@${pin}`]?.[path];
      if (content === undefined) {
        return { ok: false, kind: "not-found" };
      }
      return { ok: true, content: encoder.encode(content) };
    },
    async resolveBranch(owner, repo, branch) {
      requests.push(`branch ${owner}/${repo}#${branch}`);
      const sha = options.branches?.[`${owner}/${repo}#${branch}`];
      if (sha === undefined) {
        return { ok: false, kind: "not-found" };
      }
      return { ok: true, sha };
    },
    async listVersionTags(owner, repo) {
      requests.push(`versions ${owner}/${repo}`);
      const versions = options.versions?.[`${owner}/${repo}`];
      if (versions === undefined) {
        return { ok: false, kind: "not-found" };
      }
      return { ok: true, versions };
    },
  };
}

function manifestText(name: string, extensions?: Record<string, string>): string {
  return JSON.stringify({ name, version: "0.1.0", files: ["index.ts"], ...(extensions ? { extensions } : {}) });
}

const POSITION_COORDINATE = "example-org/position-ext";
const POSITION_REFERENCE = `gh:${POSITION_COORDINATE}@v0.1.0`;
const POSITION_CONTENT: Record<string, string> = {
  "mindcraft.json": manifestText("Position"),
  "index.ts": "export const position = 42;\n",
};

const BROKEN_COORDINATE = "example-org/broken-ext";
const BROKEN_REFERENCE = `gh:${BROKEN_COORDINATE}@v0.1.0`;
const BROKEN_CONTENT: Record<string, string> = {
  "mindcraft.json": manifestText("Broken"),
  "index.ts": 'export const broken: number = "not a number";\n',
};

const HOST_IMPORTS_POSITION = `import { position } from "@ext/${POSITION_COORDINATE}";

export const doubled = position * 2;
`;

/** A shared mutable project world: one manifest and one app-data record, reusable across host instances. */
interface ProjectWorld {
  readonly appData: Map<string, string>;
  extensions: Record<string, string>;
}

function createProjectCollectionFixture(): ProjectCollection {
  return { projectCollectionId: "collection-1", name: "Collection", createdAt: 1, updatedAt: 1 };
}

function createManager(world: ProjectWorld, filesystem: ProjectFileSystem): ProjectManager {
  let activeProject: ActiveProject = {
    manifest: {
      id: PROJECT_ID,
      projectCollectionId: "collection-1",
      name: PROJECT_ID,
      version: "0.1.0",
      description: "",
      createdAt: 1,
      updatedAt: 1,
      extensions: world.extensions,
    },
    filesystem,
  } as ActiveProject;
  return {
    get activeProject(): ActiveProject {
      return activeProject;
    },
    activeProjectCollection: createProjectCollectionFixture(),
    async init(): Promise<void> {},
    async getProjectCollectionState(): Promise<{ access: "ready" }> {
      return { access: "ready" };
    },
    async ensureDefaultProject(): Promise<void> {},
    async updateActive(updates: { extensions?: Record<string, string> }): Promise<void> {
      if (updates.extensions !== undefined) {
        world.extensions = updates.extensions;
      }
      activeProject = {
        manifest: { ...activeProject.manifest, ...updates },
        filesystem: activeProject.filesystem,
      } as ActiveProject;
    },
    async saveAppData(key: string, data: string): Promise<void> {
      world.appData.set(key, data);
    },
    async loadAppData(key: string): Promise<string | undefined> {
      return world.appData.get(key);
    },
    async deleteAppData(key: string): Promise<void> {
      world.appData.delete(key);
    },
    dispose(): void {},
  } as unknown as ProjectManager;
}

function installEmptyLocalStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = {
    length: 0,
    clear(): void {},
    getItem(): string | null {
      return null;
    },
    key(): string | null {
      return null;
    },
    removeItem(): void {},
    setItem(): void {},
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  return () => {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
      return;
    }
    Reflect.deleteProperty(globalThis, "localStorage");
  };
}

function createHost(
  world: ProjectWorld,
  options?: {
    transport?: ExtensionFetchTransport;
    hostFiles?: Record<string, string>;
  }
): AppEnvironmentHost {
  const filesystem = createInMemoryProjectFileSystem();
  for (const [path, content] of Object.entries(options?.hostFiles ?? {})) {
    filesystem.applyLocalChange({ action: "write", path, content, newEtag: `seed-${path}` });
  }
  return new AppEnvironmentHost({
    projectManager: createManager(world, filesystem),
    modules: [coreModule()],
    mounts: [declarationMount([{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }])],
    extensionFetchTransport: options?.transport,
  });
}

/** The workspace paths of the host's served snapshot (project files plus compiler-controlled files). */
function servedPaths(host: AppEnvironmentHost): string[] {
  return [...host.servedProjectFileSystem.exportSnapshot().keys()];
}

describe("extension install pipeline", () => {
  it("installs a remote extension as one transaction: fetch, snapshot persistence, materialization, improved outcome, install log", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const transport = createTestTransport({ content: { [`${POSITION_COORDINATE}@v0.1.0`]: POSITION_CONTENT } });
    const host = createHost(world, { transport, hostFiles: { "main.ts": HOST_IMPORTS_POSITION } });

    try {
      await host.initialize(PROJECT_ID);
      // A brain in the project participates in the outcome diff without
      // flagging a spurious change.
      await host.saveBrainForKey("b1", BrainDef.emptyBrainDef(host.env.brainServices, "b1"));

      const report = await host.updateProjectExtensions({ [POSITION_COORDINATE]: POSITION_REFERENCE });

      assert.ok(report.committed);
      assert.equal(report.outcome.kind, "improved");
      assert.ok(report.outcome.resolvedProblems.some((problem) => problem.location === "main.ts"));

      // The fetched snapshot persists in the project store: reference,
      // resolved specifier, and content.
      const stored = parseInstalledExtensionSnapshots(world.appData.get("installed-extensions"));
      const record = stored[POSITION_COORDINATE];
      assert.ok(record);
      assert.equal(record.reference, POSITION_REFERENCE);
      assert.equal(record.specifier, "v0.1.0");
      assert.deepStrictEqual(Object.keys(record.files).sort(), ["index.ts", "mindcraft.json"]);

      // The installed tree materializes exactly like an embedded install.
      assert.ok(servedPaths(host).includes(`.extensions/${POSITION_COORDINATE}/index.ts`));

      const log = parseExtensionInstallLog(world.appData.get("extension-install-log"));
      assert.deepStrictEqual(
        log.map((event) => event.kind),
        ["install"]
      );
      assert.ok(log[0].kind === "install" && log[0].specifier === "v0.1.0");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("regenerates .extensions from the stored snapshot on load, never from the network", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const transport = createTestTransport({ content: { [`${POSITION_COORDINATE}@v0.1.0`]: POSITION_CONTENT } });
    const first = createHost(world, { transport, hostFiles: { "main.ts": HOST_IMPORTS_POSITION } });
    try {
      await first.initialize(PROJECT_ID);
      const report = await first.updateProjectExtensions({ [POSITION_COORDINATE]: POSITION_REFERENCE });
      assert.ok(report.committed);
    } finally {
      first.dispose();
    }

    // A fresh host over the same store, with no transport at all: the tree
    // regenerates from the stored snapshot and the import resolves.
    const reloaded = createHost(world, { hostFiles: { "main.ts": HOST_IMPORTS_POSITION } });
    try {
      await reloaded.initialize(PROJECT_ID);
      assert.ok(servedPaths(reloaded).includes(`.extensions/${POSITION_COORDINATE}/index.ts`));
      // The import compiles cleanly offline: an install never depends on its
      // sources being reachable after installation. A re-resolve of the same
      // map reuses the stored snapshot without a transport.
      const followup = await reloaded.updateProjectExtensions(world.extensions);
      assert.ok(followup.committed);
      assert.equal(followup.outcome.kind, "unchanged");
    } finally {
      reloaded.dispose();
      restoreLocalStorage();
    }
  });

  it("commits a worsened install with a notice naming the new problems and a working one-step undo", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const transport = createTestTransport({ content: { [`${BROKEN_COORDINATE}@v0.1.0`]: BROKEN_CONTENT } });
    const host = createHost(world, { transport, hostFiles: { "main.ts": "export const ok = 1;\n" } });

    try {
      await host.initialize(PROJECT_ID);
      const report = await host.updateProjectExtensions({ [BROKEN_COORDINATE]: BROKEN_REFERENCE });

      // Worsened still commits.
      assert.ok(report.committed);
      assert.equal(report.outcome.kind, "worsened");
      assert.ok(
        report.outcome.newProblems.some((problem) => problem.location === `.extensions/${BROKEN_COORDINATE}/index.ts`)
      );
      assert.equal(world.extensions[BROKEN_COORDINATE], BROKEN_REFERENCE);
      assert.ok(servedPaths(host).includes(`.extensions/${BROKEN_COORDINATE}/index.ts`));
      assert.ok(report.undo);

      // One-step undo: manifest entries revert, the tree de-materializes, the
      // snapshot store reverts, and the log records the undo.
      await report.undo();
      assert.deepStrictEqual(world.extensions, {});
      assert.ok(!servedPaths(host).includes(`.extensions/${BROKEN_COORDINATE}/index.ts`));
      assert.deepStrictEqual(parseInstalledExtensionSnapshots(world.appData.get("installed-extensions")), {});
      const log = parseExtensionInstallLog(world.appData.get("extension-install-log"));
      assert.deepStrictEqual(
        log.map((event) => event.kind),
        ["install", "undo"]
      );
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("refuses outright when the source is unreachable, leaving the project unchanged", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const host = createHost(world, { hostFiles: { "main.ts": "export const ok = 1;\n" } });

    try {
      await host.initialize(PROJECT_ID);
      const report = await host.updateProjectExtensions({ [POSITION_COORDINATE]: POSITION_REFERENCE });

      assert.ok(!report.committed);
      assert.equal(report.refusal.kind, "fetch");
      assert.ok(report.refusal.kind === "fetch" && report.refusal.error.code === ExtensionFetchErrorCode.UNREACHABLE);
      assert.deepStrictEqual(world.extensions, {});
      assert.equal(world.appData.get("installed-extensions"), undefined);
      assert.ok(!servedPaths(host).includes(`.extensions/${POSITION_COORDINATE}/index.ts`));
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("refuses outright on a dependency cycle, surfacing the cycle origins", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const aReference = "gh:example-org/a-ext@v1";
    const bReference = "gh:example-org/b-ext@v1";
    const transport = createTestTransport({
      content: {
        "example-org/a-ext@v1": {
          "mindcraft.json": manifestText("A", { "example-org/b-ext": bReference }),
          "index.ts": "export {};\n",
        },
        "example-org/b-ext@v1": {
          "mindcraft.json": manifestText("B", { "example-org/a-ext": aReference }),
          "index.ts": "export {};\n",
        },
      },
    });
    const host = createHost(world, { transport, hostFiles: { "main.ts": "export const ok = 1;\n" } });

    try {
      await host.initialize(PROJECT_ID);
      const report = await host.updateProjectExtensions({ "example-org/a-ext": aReference });

      assert.ok(!report.committed);
      assert.equal(report.refusal.kind, "cycle");
      assert.ok(
        report.refusal.kind === "cycle" &&
          report.refusal.cycle.join(" -> ") === "example-org/a-ext -> example-org/b-ext -> example-org/a-ext"
      );
      assert.deepStrictEqual(world.extensions, {});
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("installs a dependency set as one transaction with one outcome, and removes it symmetrically", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const motorReference = "gh:example-org/motor-ext@v1";
    const robotReference = "gh:example-org/robot-ext@v1";
    const transport = createTestTransport({
      content: {
        "example-org/robot-ext@v1": {
          "mindcraft.json": manifestText("Robot", { "example-org/motor-ext": motorReference }),
          "index.ts": `export { motor } from "@ext/example-org/motor-ext";\n`,
        },
        "example-org/motor-ext@v1": {
          "mindcraft.json": manifestText("Motor"),
          "index.ts": "export const motor = 1;\n",
        },
      },
    });
    const host = createHost(world, { transport, hostFiles: { "main.ts": "export const ok = 1;\n" } });

    try {
      await host.initialize(PROJECT_ID);
      const report = await host.updateProjectExtensions({ "example-org/robot-ext": robotReference });

      assert.ok(report.committed);
      assert.equal(report.outcome.kind, "unchanged");
      assert.ok(servedPaths(host).includes(".extensions/example-org/robot-ext/index.ts"));
      assert.ok(servedPaths(host).includes(".extensions/example-org/motor-ext/index.ts"));
      const stored = parseInstalledExtensionSnapshots(world.appData.get("installed-extensions"));
      assert.deepStrictEqual(Object.keys(stored).sort(), ["example-org/motor-ext", "example-org/robot-ext"]);

      const removal = await host.updateProjectExtensions({});
      assert.ok(removal.committed);
      assert.ok(!servedPaths(host).includes(".extensions/example-org/robot-ext/index.ts"));
      assert.ok(!servedPaths(host).includes(".extensions/example-org/motor-ext/index.ts"));
      assert.deepStrictEqual(parseInstalledExtensionSnapshots(world.appData.get("installed-extensions")), {});

      const log = parseExtensionInstallLog(world.appData.get("extension-install-log"));
      assert.deepStrictEqual(log.map((event) => event.kind).sort(), ["install", "install", "remove", "remove"]);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("resolves a #branch reference to a commit SHA and records the SHA with the installed content", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const transport = createTestTransport({
      content: { [`${POSITION_COORDINATE}@${sha}`]: POSITION_CONTENT },
      branches: { [`${POSITION_COORDINATE}#main`]: sha },
    });
    const host = createHost(world, { transport, hostFiles: { "main.ts": "export const ok = 1;\n" } });

    try {
      await host.initialize(PROJECT_ID);
      const branchReference = `gh:${POSITION_COORDINATE}#main`;
      const report = await host.updateProjectExtensions({ [POSITION_COORDINATE]: branchReference });

      assert.ok(report.committed);
      const stored = parseInstalledExtensionSnapshots(world.appData.get("installed-extensions"));
      assert.equal(stored[POSITION_COORDINATE]?.reference, branchReference);
      assert.equal(stored[POSITION_COORDINATE]?.specifier, sha);
      // The branch itself is never fetched as content: every file request
      // names the resolved commit.
      assert.ok(transport.requests.every((request) => !request.startsWith(`file ${POSITION_COORDINATE}@main`)));
      const log = parseExtensionInstallLog(world.appData.get("extension-install-log"));
      assert.ok(log[0].kind === "install" && log[0].specifier === sha);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("installs through the real jsDelivr transport against a local server with the jsDelivr layout", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const served: Record<string, string> = {
      [`/gh/${POSITION_COORDINATE}@v0.1.0/mindcraft.json`]: POSITION_CONTENT["mindcraft.json"],
      [`/gh/${POSITION_COORDINATE}@v0.1.0/index.ts`]: POSITION_CONTENT["index.ts"],
    };
    const server: Server = createServer((request, response) => {
      const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const content = served[path];
      if (content === undefined) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }
      response.end(content);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const host = createHost(world, {
      transport: createJsDelivrExtensionTransport({ cdnBaseUrl: baseUrl, dataApiBaseUrl: baseUrl }),
      hostFiles: { "main.ts": HOST_IMPORTS_POSITION },
    });

    try {
      await host.initialize(PROJECT_ID);
      const report = await host.updateProjectExtensions({ [POSITION_COORDINATE]: POSITION_REFERENCE });
      assert.ok(report.committed);
      assert.equal(report.outcome.kind, "improved");
      assert.ok(servedPaths(host).includes(`.extensions/${POSITION_COORDINATE}/index.ts`));
    } finally {
      host.dispose();
      restoreLocalStorage();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

type WsCallback = ((...args: unknown[]) => void) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: WsCallback = null;
  onclose: WsCallback = null;
  onmessage: WsCallback = null;
  onerror: WsCallback = null;

  readonly sent: string[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}

  simulateOpen(): void {
    this.onopen?.({});
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("extension install pipeline -- hand-edited mindcraft.json", () => {
  it("routes a peer's extensions edit through the install transaction", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const originalWebSocket = globalThis.WebSocket;
    MockWebSocket.instances = [];
    (globalThis as Record<string, unknown>).WebSocket = MockWebSocket;

    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const transport = createTestTransport({ content: { [`${POSITION_COORDINATE}@v0.1.0`]: POSITION_CONTENT } });
    const filesystem = createInMemoryProjectFileSystem();
    filesystem.applyLocalChange({ action: "write", path: "main.ts", content: "export const ok = 1;\n", newEtag: "e1" });
    const host = new AppEnvironmentHost({
      projectManager: createManager(world, filesystem),
      modules: [coreModule()],
      mounts: [declarationMount([{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }])],
      extensionFetchTransport: transport,
      bridgeUrl: "http://localhost:3000",
    });

    try {
      await host.initialize(PROJECT_ID);
      host.connectBridge();
      const socket = MockWebSocket.instances.at(-1)!;
      socket.simulateOpen();
      socket.simulateMessage({
        type: "session:welcome",
        payload: { protocolVersion: 1, sessionId: "s", joinCode: "J" },
      });

      // The peer edits mindcraft.json by hand, adding a gh reference.
      socket.simulateMessage({
        type: "filesystem:change",
        payload: {
          action: "write",
          path: "mindcraft.json",
          content: JSON.stringify({
            name: PROJECT_ID,
            version: "0.1.0",
            description: "",
            extensions: { [POSITION_COORDINATE]: POSITION_REFERENCE },
          }),
          newEtag: "peer-1",
        },
        seq: 1,
      });

      // The edit flows through the same transactional pipeline: fetched,
      // snapshotted, and materialized.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && world.appData.get("installed-extensions") === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const stored = parseInstalledExtensionSnapshots(world.appData.get("installed-extensions"));
      assert.equal(stored[POSITION_COORDINATE]?.reference, POSITION_REFERENCE);
      assert.equal(world.extensions[POSITION_COORDINATE], POSITION_REFERENCE);
      assert.ok(servedPaths(host).includes(`.extensions/${POSITION_COORDINATE}/index.ts`));
    } finally {
      host.dispose();
      (globalThis as Record<string, unknown>).WebSocket = originalWebSocket;
      restoreLocalStorage();
    }
  });
});

describe("extension update flows", () => {
  const SHA_A = "0123456789abcdef0123456789abcdef01234567";
  const SHA_B = "89abcdef0123456789abcdef0123456789abcdef";

  it("checks and applies a pin update: the manifest reference is rewritten and the content refetched", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const transport = createTestTransport({
      content: {
        [`${POSITION_COORDINATE}@v0.1.0`]: POSITION_CONTENT,
        [`${POSITION_COORDINATE}@0.2.0`]: {
          "mindcraft.json": JSON.stringify({ name: "Position", version: "0.2.0", files: ["index.ts"] }),
          "index.ts": "export const position = 43;\n",
        },
      },
      versions: { [POSITION_COORDINATE]: ["0.1.0", "0.2.0"] },
    });
    const host = createHost(world, { transport, hostFiles: { "main.ts": HOST_IMPORTS_POSITION } });

    try {
      await host.initialize(PROJECT_ID);
      const install = await host.updateProjectExtensions({ [POSITION_COORDINATE]: POSITION_REFERENCE });
      assert.ok(install.committed);

      const check = await host.checkExtensionUpdate(POSITION_COORDINATE);
      assert.ok(check.ok && check.updateAvailable);
      assert.deepStrictEqual(check.update, {
        coordinate: POSITION_COORDINATE,
        reference: `gh:${POSITION_COORDINATE}@0.2.0`,
        latestVersion: "0.2.0",
      });

      const report = await host.applyExtensionUpdates([check.update]);
      assert.ok(report.committed);
      assert.equal(world.extensions[POSITION_COORDINATE], `gh:${POSITION_COORDINATE}@0.2.0`);
      const stored = parseInstalledExtensionSnapshots(world.appData.get("installed-extensions"));
      assert.equal(stored[POSITION_COORDINATE]?.specifier, "0.2.0");

      // The update records an install event carrying the new specifier.
      const log = parseExtensionInstallLog(world.appData.get("extension-install-log"));
      const last = log.at(-1);
      assert.ok(last?.kind === "install" && last.specifier === "0.2.0");

      // An immediate re-check reports the project current.
      const recheck = await host.checkExtensionUpdate(POSITION_COORDINATE);
      assert.deepStrictEqual(recheck, { ok: true, updateAvailable: false });
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("checks and applies a branch update: the reference text is unchanged and the content refetched at the new head", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const branchReference = `gh:${POSITION_COORDINATE}#main`;
    const branches: Record<string, string> = { [`${POSITION_COORDINATE}#main`]: SHA_A };
    const transport = createTestTransport({
      content: {
        [`${POSITION_COORDINATE}@${SHA_A}`]: POSITION_CONTENT,
        [`${POSITION_COORDINATE}@${SHA_B}`]: {
          "mindcraft.json": JSON.stringify({ name: "Position", version: "0.1.1", files: ["index.ts"] }),
          "index.ts": "export const position = 44;\n",
        },
      },
      branches,
    });
    const host = createHost(world, { transport, hostFiles: { "main.ts": HOST_IMPORTS_POSITION } });

    try {
      await host.initialize(PROJECT_ID);
      const install = await host.updateProjectExtensions({ [POSITION_COORDINATE]: branchReference });
      assert.ok(install.committed);

      // The branch has not moved: no update.
      const current = await host.checkExtensionUpdate(POSITION_COORDINATE);
      assert.deepStrictEqual(current, { ok: true, updateAvailable: false });

      // The branch head moves upstream.
      branches[`${POSITION_COORDINATE}#main`] = SHA_B;
      const check = await host.checkExtensionUpdate(POSITION_COORDINATE);
      assert.ok(check.ok && check.updateAvailable);
      assert.deepStrictEqual(check.update, {
        coordinate: POSITION_COORDINATE,
        reference: branchReference,
        resolvedSha: SHA_B,
      });

      const report = await host.applyExtensionUpdates([check.update]);
      assert.ok(report.committed);
      assert.equal(world.extensions[POSITION_COORDINATE], branchReference);
      const stored = parseInstalledExtensionSnapshots(world.appData.get("installed-extensions"));
      assert.equal(stored[POSITION_COORDINATE]?.specifier, SHA_B);
      // The apply fetched the new commit; it did not reuse the stored snapshot.
      assert.ok(transport.requests.includes(`file ${POSITION_COORDINATE}@${SHA_B} mindcraft.json`));
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("updates several dependencies as one transaction with one outcome", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const motorCoordinate = "example-org/motor-ext";
    const transport = createTestTransport({
      content: {
        [`${POSITION_COORDINATE}@v0.1.0`]: POSITION_CONTENT,
        [`${POSITION_COORDINATE}@0.2.0`]: {
          "mindcraft.json": JSON.stringify({ name: "Position", version: "0.2.0", files: ["index.ts"] }),
          "index.ts": "export const position = 43;\n",
        },
        [`${motorCoordinate}@v1.0.0`]: {
          "mindcraft.json": JSON.stringify({ name: "Motor", version: "1.0.0", files: ["index.ts"] }),
          "index.ts": "export const motor = 1;\n",
        },
        [`${motorCoordinate}@1.1.0`]: {
          "mindcraft.json": JSON.stringify({ name: "Motor", version: "1.1.0", files: ["index.ts"] }),
          "index.ts": "export const motor = 2;\n",
        },
      },
      versions: {
        [POSITION_COORDINATE]: ["0.1.0", "0.2.0"],
        [motorCoordinate]: ["1.0.0", "1.1.0"],
      },
    });
    const host = createHost(world, { transport, hostFiles: { "main.ts": "export const ok = 1;\n" } });

    try {
      await host.initialize(PROJECT_ID);
      const install = await host.updateProjectExtensions({
        [POSITION_COORDINATE]: POSITION_REFERENCE,
        [motorCoordinate]: `gh:${motorCoordinate}@v1.0.0`,
      });
      assert.ok(install.committed);
      const logBefore = parseExtensionInstallLog(world.appData.get("extension-install-log")).length;

      const positionCheck = await host.checkExtensionUpdate(POSITION_COORDINATE);
      const motorCheck = await host.checkExtensionUpdate(motorCoordinate);
      assert.ok(positionCheck.ok && positionCheck.updateAvailable);
      assert.ok(motorCheck.ok && motorCheck.updateAvailable);

      const report = await host.applyExtensionUpdates([positionCheck.update, motorCheck.update]);
      assert.ok(report.committed);
      assert.equal(report.outcome.kind, "unchanged");

      const stored = parseInstalledExtensionSnapshots(world.appData.get("installed-extensions"));
      assert.equal(stored[POSITION_COORDINATE]?.specifier, "0.2.0");
      assert.equal(stored[motorCoordinate]?.specifier, "1.1.0");
      // One transaction: both updates land as install events appended together.
      const appended = parseExtensionInstallLog(world.appData.get("extension-install-log")).slice(logBefore);
      assert.deepStrictEqual(appended.map((event) => event.kind).sort(), ["install", "install"]);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("answers INVALID_REFERENCE for a coordinate that is not an installed fetched dependency", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const host = createHost(world, { hostFiles: { "main.ts": "export const ok = 1;\n" } });
    try {
      await host.initialize(PROJECT_ID);
      const check = await host.checkExtensionUpdate("example-org/not-installed");
      assert.ok(!check.ok);
      assert.equal(check.error.code, ExtensionFetchErrorCode.INVALID_REFERENCE);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});

describe("broken fetched dependencies", () => {
  it("records a fetch refusal in the install log, surfaces it on the catalog entry, and a retry re-runs the transaction", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    // The project's manifest already declares the dependency (as after an
    // import), but no snapshot content was ever installed.
    const world: ProjectWorld = {
      appData: new Map(),
      extensions: { [POSITION_COORDINATE]: POSITION_REFERENCE },
    };
    const content: Record<string, Record<string, string>> = {};
    const transport = createTestTransport({ content });
    const host = createHost(world, { transport, hostFiles: { "main.ts": "export const ok = 1;\n" } });

    try {
      await host.initialize(PROJECT_ID);
      // Never fetched: the catalog entry is broken with a generic reason.
      const beforeRetry = buildExtensionCatalog(
        world.extensions,
        [],
        new Set(),
        host.installedExtensionContent,
        host.extensionFetchFailures
      );
      assert.deepStrictEqual(beforeRetry[0].broken, {
        message: `No content is installed for "${POSITION_REFERENCE}".`,
      });

      // Retry against a source that has nothing: the refusal's stable code is
      // recorded and surfaces as the entry's reason.
      const refused = await host.updateProjectExtensions(world.extensions);
      assert.ok(!refused.committed);
      const failed = buildExtensionCatalog(
        world.extensions,
        [],
        new Set(),
        host.installedExtensionContent,
        host.extensionFetchFailures
      );
      assert.equal(failed[0].broken?.code, ExtensionFetchErrorCode.MANIFEST_MISSING);
      const log = parseExtensionInstallLog(world.appData.get("extension-install-log"));
      assert.ok(
        log.some((event) => event.kind === "fetch-refusal" && event.code === ExtensionFetchErrorCode.MANIFEST_MISSING)
      );

      // The source starts serving the content: the same retry transaction
      // succeeds and the failure clears.
      content[`${POSITION_COORDINATE}@v0.1.0`] = POSITION_CONTENT;
      const retried = await host.updateProjectExtensions(world.extensions);
      assert.ok(retried.committed);
      const healthy = buildExtensionCatalog(
        world.extensions,
        [],
        new Set(),
        host.installedExtensionContent,
        host.extensionFetchFailures
      );
      assert.equal(healthy[0].broken, undefined);
      assert.equal(healthy[0].updatable, true);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("seeds the last recorded failure from the install log on project load", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = {
      appData: new Map(),
      extensions: { [POSITION_COORDINATE]: POSITION_REFERENCE },
    };
    const failing = createHost(world, {
      transport: createTestTransport({ content: {} }),
      hostFiles: { "main.ts": "export const ok = 1;\n" },
    });
    try {
      await failing.initialize(PROJECT_ID);
      const refused = await failing.updateProjectExtensions(world.extensions);
      assert.ok(!refused.committed);
    } finally {
      failing.dispose();
    }

    const reloaded = createHost(world, { hostFiles: { "main.ts": "export const ok = 1;\n" } });
    try {
      await reloaded.initialize(PROJECT_ID);
      assert.equal(
        reloaded.extensionFetchFailures.get(POSITION_REFERENCE)?.code,
        ExtensionFetchErrorCode.MANIFEST_MISSING
      );
    } finally {
      reloaded.dispose();
      restoreLocalStorage();
    }
  });
});

describe("add-by-reference input normalization through the host", () => {
  it("resolves a pasted repository URL to the latest published version and installs it through the one transaction", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const transport = createTestTransport({
      content: { [`${POSITION_COORDINATE}@0.1.0`]: POSITION_CONTENT },
      versions: { [POSITION_COORDINATE]: ["0.1.0"] },
    });
    const host = createHost(world, { transport, hostFiles: { "main.ts": HOST_IMPORTS_POSITION } });
    try {
      await host.initialize(PROJECT_ID);
      const resolved = await host.resolveExtensionInstallInput(`https://github.com/${POSITION_COORDINATE}`);
      assert.deepStrictEqual(resolved, { ok: true, reference: `gh:${POSITION_COORDINATE}@0.1.0` });

      const report = await host.updateProjectExtensions({
        [POSITION_COORDINATE]: resolved.ok ? resolved.reference : "",
      });
      assert.ok(report.committed);
      assert.equal(world.extensions[POSITION_COORDINATE], `gh:${POSITION_COORDINATE}@0.1.0`);
      assert.ok(servedPaths(host).includes(`.extensions/${POSITION_COORDINATE}/index.ts`));
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  it("without a transport, a complete reference still normalizes and a coordinate fails as unreachable", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const host = createHost(world, { hostFiles: { "main.ts": "export const ok = 1;\n" } });
    try {
      await host.initialize(PROJECT_ID);
      assert.deepStrictEqual(await host.resolveExtensionInstallInput(POSITION_REFERENCE), {
        ok: true,
        reference: POSITION_REFERENCE,
      });
      const coordinate = await host.resolveExtensionInstallInput(POSITION_COORDINATE);
      assert.ok(!coordinate.ok);
      assert.equal(coordinate.code, ExtensionFetchErrorCode.UNREACHABLE);
      const invalid = await host.resolveExtensionInstallInput("ffff:x");
      assert.ok(!invalid.ok);
      assert.equal(invalid.code, ExtensionAddInputErrorCode.UNRECOGNIZED);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});

describe("unstable project dependencies", () => {
  it("flags branch references and pins without installed content; installed pins pass", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const world: ProjectWorld = { appData: new Map(), extensions: {} };
    const branchReference = "gh:example-org/steering-ext#main";
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const transport = createTestTransport({
      content: {
        [`${POSITION_COORDINATE}@v0.1.0`]: POSITION_CONTENT,
        "example-org/steering-ext@0123456789abcdef0123456789abcdef01234567": {
          "mindcraft.json": JSON.stringify({ name: "Steering", version: "0.1.0", files: ["index.ts"] }),
          "index.ts": "export const steering = 1;\n",
        },
      },
      branches: { "example-org/steering-ext#main": sha },
    });
    const host = createHost(world, { transport, hostFiles: { "main.ts": "export const ok = 1;\n" } });

    try {
      await host.initialize(PROJECT_ID);
      const install = await host.updateProjectExtensions({
        [POSITION_COORDINATE]: POSITION_REFERENCE,
        "example-org/steering-ext": branchReference,
      });
      assert.ok(install.committed);
      // A declared pin with no installed snapshot: the bootstrap phase.
      await host.projectManager.updateActive({
        extensions: { ...world.extensions, "example-org/unpublished-ext": "gh:example-org/unpublished-ext@v0.5.0" },
      });

      const unstable = await host.collectUnstableProjectDependencies();
      assert.deepStrictEqual(unstable.map((dependency) => [dependency.coordinate, dependency.code]).sort(), [
        ["example-org/steering-ext", "DEPENDENCY_BRANCH_REFERENCE"],
        ["example-org/unpublished-ext", "DEPENDENCY_VERSION_UNPUBLISHED"],
      ]);
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});
