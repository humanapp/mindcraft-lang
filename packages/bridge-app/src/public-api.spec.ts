import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppBridge,
  AppBridgeFeature,
  AppBridgeFeatureContext,
  AppBridgeOptions,
  AppBridgeSnapshot,
  AppBridgeState,
  DiagnosticEntry,
  WorkspaceAdapter,
  WorkspaceChange,
  WorkspaceSnapshot,
} from "@mindcraft-lang/bridge-app";
import {
  createCompilationFeature,
  type DiagnosticSnapshot,
  type WorkspaceCompiler,
} from "@mindcraft-lang/bridge-app/compilation";

type RootContracts = [
  AppBridge,
  AppBridgeFeature,
  AppBridgeFeatureContext,
  AppBridgeOptions,
  AppBridgeSnapshot,
  AppBridgeState,
  WorkspaceAdapter,
  WorkspaceChange,
  WorkspaceSnapshot,
];

type CompilationContracts = [DiagnosticEntry, DiagnosticSnapshot, WorkspaceCompiler];

void (0 as unknown as RootContracts);
void (0 as unknown as CompilationContracts);

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

test("createCompilationFeature publishes diagnostics and replays them on sync", () => {
  const workspace: WorkspaceSnapshot = new Map([
    ["src/main.ts", { kind: "file", content: "const value = 1;", etag: "etag-1", isReadonly: false }],
  ]);
  const snapshot: DiagnosticSnapshot = {
    files: new Map([["src/main.ts", [createDiagnostic("unexpected token")]]]),
  };

  let replaceWorkspaceArg: WorkspaceSnapshot | undefined;
  let compileCount = 0;
  const diagnosticsEvents: Array<{ file: string; diagnostics: readonly DiagnosticEntry[] }> = [];
  const statusEvents: Array<{ file: string; success: boolean; diagnosticCount: { error: number; warning: number } }> =
    [];
  const remoteChangeListeners = new Set<(change: WorkspaceChange) => void>();
  const syncListeners = new Set<() => void>();

  const compiler: WorkspaceCompiler = {
    replaceWorkspace(nextSnapshot) {
      replaceWorkspaceArg = nextSnapshot;
    },
    applyWorkspaceChange() {},
    compile() {
      compileCount++;
      return snapshot;
    },
    onDidCompile() {
      return () => {};
    },
  };

  const context: AppBridgeFeatureContext = {
    snapshot() {
      return { status: "connected", joinCode: "JOIN-123" };
    },
    workspaceSnapshot() {
      return workspace;
    },
    onStateChange() {
      return () => {};
    },
    onRemoteChange(listener) {
      remoteChangeListeners.add(listener);
      return () => {
        remoteChangeListeners.delete(listener);
      };
    },
    onDidSync(listener) {
      syncListeners.add(listener);
      return () => {
        syncListeners.delete(listener);
      };
    },
    publishDiagnostics(file, diagnostics) {
      diagnosticsEvents.push({ file, diagnostics });
    },
    publishStatus(update) {
      statusEvents.push(update);
    },
  };

  const feature = createCompilationFeature({ compiler });
  const dispose = feature.attach(context);

  assert.equal(replaceWorkspaceArg, workspace);
  assert.equal(compileCount, 1);
  assert.equal(remoteChangeListeners.size, 1);
  assert.equal(syncListeners.size, 1);
  assert.deepEqual(diagnosticsEvents, [{ file: "src/main.ts", diagnostics: snapshot.files.get("src/main.ts")! }]);
  assert.deepEqual(statusEvents, [
    {
      file: "src/main.ts",
      success: false,
      diagnosticCount: { error: 1, warning: 0 },
    },
  ]);

  for (const listener of syncListeners) {
    listener();
  }

  assert.equal(diagnosticsEvents.length, 2);
  assert.deepEqual(diagnosticsEvents[1], { file: "src/main.ts", diagnostics: snapshot.files.get("src/main.ts")! });
  assert.equal(statusEvents.length, 2);

  dispose();

  assert.equal(remoteChangeListeners.size, 0);
  assert.equal(syncListeners.size, 0);
});

test("createCompilationFeature clears previously published diagnostics when they disappear", () => {
  const workspace: WorkspaceSnapshot = new Map();
  const snapshots: DiagnosticSnapshot[] = [
    {
      files: new Map([["src/main.ts", [createDiagnostic("unexpected token")]]]),
    },
    {
      files: new Map(),
    },
  ];

  let compileIndex = 0;
  const appliedChanges: WorkspaceChange[] = [];
  const diagnosticsEvents: Array<{ file: string; diagnostics: readonly DiagnosticEntry[] }> = [];
  const statusEvents: Array<{ file: string; success: boolean; diagnosticCount: { error: number; warning: number } }> =
    [];
  const remoteChangeListeners = new Set<(change: WorkspaceChange) => void>();

  const compiler: WorkspaceCompiler = {
    replaceWorkspace() {},
    applyWorkspaceChange(change) {
      appliedChanges.push(change);
    },
    compile() {
      const snapshot = snapshots[compileIndex] ?? snapshots[snapshots.length - 1]!;
      compileIndex++;
      return snapshot;
    },
    onDidCompile() {
      return () => {};
    },
  };

  const context: AppBridgeFeatureContext = {
    snapshot() {
      return { status: "connected" };
    },
    workspaceSnapshot() {
      return workspace;
    },
    onStateChange() {
      return () => {};
    },
    onRemoteChange(listener) {
      remoteChangeListeners.add(listener);
      return () => {
        remoteChangeListeners.delete(listener);
      };
    },
    onDidSync() {
      return () => {};
    },
    publishDiagnostics(file, diagnostics) {
      diagnosticsEvents.push({ file, diagnostics });
    },
    publishStatus(update) {
      statusEvents.push(update);
    },
  };

  const feature = createCompilationFeature({ compiler });
  feature.attach(context);

  const change: WorkspaceChange = {
    action: "write",
    path: "src/main.ts",
    content: "const value = 2;",
    isReadonly: false,
    newEtag: "etag-2",
  };

  for (const listener of remoteChangeListeners) {
    listener(change);
  }

  assert.deepEqual(appliedChanges, [change]);
  assert.deepEqual(diagnosticsEvents.at(-1), { file: "src/main.ts", diagnostics: [] });
  assert.deepEqual(statusEvents.at(-1), {
    file: "src/main.ts",
    success: true,
    diagnosticCount: { error: 0, warning: 0 },
  });
});

test("createCompilationFeature republishes out-of-band compiler results through onDidCompile", () => {
  const workspace: WorkspaceSnapshot = new Map();
  const initialSnapshot: DiagnosticSnapshot = {
    files: new Map(),
  };
  const nextSnapshot: DiagnosticSnapshot = {
    files: new Map([["src/extra.ts", [createDiagnostic("late diagnostic")]]]),
  };

  const diagnosticsEvents: Array<{ file: string; diagnostics: readonly DiagnosticEntry[] }> = [];
  const statusEvents: Array<{ file: string; success: boolean; diagnosticCount: { error: number; warning: number } }> =
    [];
  const syncListeners = new Set<() => void>();
  const compileListeners = new Set<(snapshot: DiagnosticSnapshot) => void>();

  let currentSnapshot = initialSnapshot;

  const compiler: WorkspaceCompiler = {
    replaceWorkspace() {},
    applyWorkspaceChange() {},
    compile() {
      return currentSnapshot;
    },
    onDidCompile(listener) {
      const compileListener = listener as (snapshot: DiagnosticSnapshot) => void;
      compileListeners.add(compileListener);
      return () => {
        compileListeners.delete(compileListener);
      };
    },
  };

  const context: AppBridgeFeatureContext = {
    snapshot() {
      return { status: "connected" };
    },
    workspaceSnapshot() {
      return workspace;
    },
    onStateChange() {
      return () => {};
    },
    onRemoteChange() {
      return () => {};
    },
    onDidSync(listener) {
      syncListeners.add(listener);
      return () => {
        syncListeners.delete(listener);
      };
    },
    publishDiagnostics(file, diagnostics) {
      diagnosticsEvents.push({ file, diagnostics });
    },
    publishStatus(update) {
      statusEvents.push(update);
    },
  };

  const feature = createCompilationFeature({ compiler });
  feature.attach(context);

  currentSnapshot = nextSnapshot;
  for (const listener of compileListeners) {
    listener(nextSnapshot);
  }

  assert.deepEqual(diagnosticsEvents.at(-1), {
    file: "src/extra.ts",
    diagnostics: nextSnapshot.files.get("src/extra.ts")!,
  });
  assert.deepEqual(statusEvents.at(-1), {
    file: "src/extra.ts",
    success: false,
    diagnosticCount: { error: 1, warning: 0 },
  });

  for (const listener of syncListeners) {
    listener();
  }

  assert.deepEqual(diagnosticsEvents.at(-1), {
    file: "src/extra.ts",
    diagnostics: nextSnapshot.files.get("src/extra.ts")!,
  });
  assert.deepEqual(statusEvents.at(-1), {
    file: "src/extra.ts",
    success: false,
    diagnosticCount: { error: 1, warning: 0 },
  });
});
