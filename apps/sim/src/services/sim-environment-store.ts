import { createLocalStorageWorkspace, type WorkspaceAdapter } from "@mindcraft-lang/bridge-app";
import { coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { DocsTileEntry } from "@mindcraft-lang/docs";
import { isCompilerControlledPath } from "@mindcraft-lang/ts-compiler";
import { createSimModule } from "@/brain";

export class SimEnvironmentStore {
  readonly env: MindcraftEnvironment;
  readonly workspace: WorkspaceAdapter;

  userTileDocEntries: DocsTileEntry[] = [];

  private _docRevision = 0;
  private _vfsRevision = 0;
  private readonly docRevisionListeners = new Set<() => void>();
  private readonly vfsRevisionListeners = new Set<() => void>();

  private _pendingBrainRebuild = false;

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
}
