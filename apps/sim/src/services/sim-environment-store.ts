import type { AppBridge, AppBridgeState, WorkspaceAdapter } from "@mindcraft-lang/bridge-app";
import { createLocalStorageWorkspace } from "@mindcraft-lang/bridge-app";
import { type AppProjectHandle, createAppProject } from "@mindcraft-lang/bridge-app/compilation";
import {
  type BrainDef,
  coreModule,
  createMindcraftEnvironment,
  logger,
  type MindcraftEnvironment,
} from "@mindcraft-lang/core/app";
import type { DocsTileEntry } from "@mindcraft-lang/docs";
import type { WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import { isCompilerControlledPath } from "@mindcraft-lang/ts-compiler";
import { createSimModule } from "@/brain";
import type { Archetype } from "@/brain/actor";
import { getAppSettings, onAppSettingsChange } from "./app-settings";
import { getUiPreferences } from "./ui-preferences";
import { applyCompiledUserTiles } from "./user-tile-registration";
import { clearBindingToken, loadBindingToken, saveBindingToken } from "./vscode-bridge";

export class SimEnvironmentStore {
  readonly env: MindcraftEnvironment;
  readonly workspace: WorkspaceAdapter;

  userTileDocEntries: DocsTileEntry[] = [];

  private _docRevision = 0;
  private _vfsRevision = 0;
  private readonly docRevisionListeners = new Set<() => void>();
  private readonly vfsRevisionListeners = new Set<() => void>();

  private _pendingBrainRebuild = false;
  private readonly _defaultBrainCache = new Map<Archetype, BrainDef>();

  private _project: AppProjectHandle | undefined;
  private _bridgeStatus: AppBridgeState = "disconnected";
  private _bridgeJoinCode: string | undefined;
  private readonly _bridgeStatusListeners = new Set<() => void>();
  private readonly _bridgeJoinCodeListeners = new Set<() => void>();
  private _bridgeStateUnsub: (() => void) | undefined;
  private _remoteChangeUnsub: (() => void) | undefined;

  constructor() {
    this.workspace = createLocalStorageWorkspace({
      storageKey: "sim:vscode-bridge:filesystem",
      shouldExclude: isCompilerControlledPath,
    });
    this.env = createMindcraftEnvironment({
      modules: [coreModule(), createSimModule()],
    });

    this.env.onBrainsInvalidated((event) => {
      if (event.invalidatedBrains.length > 0) {
        this._pendingBrainRebuild = true;
      }
    });
  }

  flushPendingBrainRebuilds(): void {
    if (!this._pendingBrainRebuild) {
      return;
    }
    this._pendingBrainRebuild = false;
    this.env.rebuildInvalidatedBrains();
  }

  setDefaultBrain(archetype: Archetype, brainDef: BrainDef): void {
    this._defaultBrainCache.set(archetype, brainDef);
  }

  getDefaultBrain(archetype: Archetype): BrainDef | undefined {
    return this._defaultBrainCache.get(archetype);
  }

  get docRevision(): number {
    return this._docRevision;
  }

  bumpDocRevision(): void {
    this._docRevision++;
    for (const listener of this.docRevisionListeners) {
      listener();
    }
  }

  bumpVfsRevision(): void {
    this._vfsRevision++;
    for (const listener of this.vfsRevisionListeners) {
      listener();
    }
  }

  subscribeToDocRevision = (listener: () => void): (() => void) => {
    this.docRevisionListeners.add(listener);
    return () => this.docRevisionListeners.delete(listener);
  };

  getDocRevisionSnapshot = (): number => {
    return this._docRevision;
  };

  subscribeToVfsRevision = (listener: () => void): (() => void) => {
    this.vfsRevisionListeners.add(listener);
    return () => this.vfsRevisionListeners.delete(listener);
  };

  getVfsRevisionSnapshot = (): number => {
    return this._vfsRevision;
  };

  // -- Bridge --

  initBridge(): void {
    this._project = createAppProject({
      environment: this.env,
      app: {
        id: "sim",
        name: "Sim",
        projectId: "sim-default",
        projectName: "Sim",
      },
      bridgeUrl: getAppSettings().vscodeBridgeUrl,
      workspace: this.workspace,
      bindingToken: loadBindingToken(),
      onBindingTokenChange(token) {
        saveBindingToken(token);
      },
      onDidCompile: (result) => {
        logWorkspaceCompile(result);
        applyCompiledUserTiles(this, result);
      },
    });

    this._project.initialize();
    this.wireBridgeState(this._project.bridge);

    onAppSettingsChange((settings, prev) => {
      if (settings.vscodeBridgeUrl !== prev.vscodeBridgeUrl) {
        const shouldStart = getUiPreferences().bridgeEnabled || this._bridgeStatus !== "disconnected";
        this.recreateBridge(shouldStart);
      }
    });
  }

  connectBridge(): void {
    if (!this._project) {
      this.initBridge();
    }

    if (!this._project || this._project.bridge.snapshot().status !== "disconnected") {
      return;
    }

    this._project.bridge.start();
  }

  disconnectBridge(): void {
    this._project?.bridge.stop();
  }

  subscribeToBridgeStatus = (listener: () => void): (() => void) => {
    this._bridgeStatusListeners.add(listener);
    return () => this._bridgeStatusListeners.delete(listener);
  };

  getBridgeStatusSnapshot = (): AppBridgeState => {
    return this._bridgeStatus;
  };

  subscribeToBridgeJoinCode = (listener: () => void): (() => void) => {
    this._bridgeJoinCodeListeners.add(listener);
    return () => this._bridgeJoinCodeListeners.delete(listener);
  };

  getBridgeJoinCodeSnapshot = (): string | undefined => {
    return this._bridgeJoinCode;
  };

  private wireBridgeState(bridge: AppBridge): void {
    this._bridgeStateUnsub?.();
    this._remoteChangeUnsub?.();
    this._bridgeStateUnsub = bridge.onStateChange(() => {
      this.applyBridgeSnapshot(bridge);
    });
    this._remoteChangeUnsub = bridge.onRemoteChange(() => {
      this.bumpVfsRevision();
    });
    this.applyBridgeSnapshot(bridge);
  }

  private applyBridgeSnapshot(bridge: AppBridge): void {
    const snapshot = bridge.snapshot();

    if (snapshot.status !== this._bridgeStatus) {
      this._bridgeStatus = snapshot.status;
      for (const listener of this._bridgeStatusListeners) {
        listener();
      }
    }

    if (snapshot.joinCode !== this._bridgeJoinCode) {
      this._bridgeJoinCode = snapshot.joinCode;
      for (const listener of this._bridgeJoinCodeListeners) {
        listener();
      }
    }
  }

  private recreateBridge(shouldStart: boolean): void {
    if (!this._project) {
      return;
    }

    this._bridgeStateUnsub?.();
    this._bridgeStateUnsub = undefined;

    this._project.recreateBridge(getAppSettings().vscodeBridgeUrl);
    this.wireBridgeState(this._project.bridge);

    if (shouldStart) {
      this._project.bridge.start();
    }
  }
}

function logWorkspaceCompile(result: WorkspaceCompileResult): void {
  const resultsByPath = result.projectResult.results;

  for (const [path, diagnostics] of result.files) {
    if (diagnostics.length > 0) {
      logger.warn(`[user-tile-compiler] ${path}: ${diagnostics.length} diagnostic(s)`);
      for (const diagnostic of diagnostics) {
        const range = diagnostic.range;
        logger.warn(`  ${path}:${range.startLine}:${range.startColumn} - ${diagnostic.message}`);
      }
      continue;
    }

    const program = resultsByPath.get(path)?.program;
    if (program) {
      logger.info(`[user-tile-compiler] ${path}: compiled ${program.kind} "${program.name}"`);
    }
  }
}
