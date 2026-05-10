import { logger } from "@mindcraft-lang/core";
import { AppHostError, appHostError } from "./app-host-error.js";
import type { InMemoryProjectFileSystemOptions } from "./in-memory-project-file-system.js";
import { createInMemoryProjectFileSystem } from "./in-memory-project-file-system.js";
import {
  DEFAULT_PROJECT_COLLECTION_ID,
  type ProjectCollection,
  type ProjectCollectionPinVerifier,
} from "./project-collection.js";
import {
  createProjectCollectionBroadcast,
  type ProjectCollectionBroadcast,
  type ProjectCollectionBroadcastMessage,
} from "./project-collection-broadcast.js";
import { createProjectCollectionPinVerifier, verifyProjectCollectionPin } from "./project-collection-pin.js";
import type { ProjectFileSnapshot } from "./project-file-snapshot.js";
import type { ProjectFileSystem } from "./project-file-system.js";
import type { ProjectLock, ProjectLockHandle } from "./project-lock.js";
import type { ProjectManifest } from "./project-manifest.js";
import type { ProjectCollectionTabSession, ProjectStore } from "./project-store.js";

/** Display name used when a project is created without an explicit name. */
export const DEFAULT_PROJECT_NAME = "Untitled Project";

/** Reload unlock lifetime for protected project collections. */
export const RELOAD_UNLOCK_TTL_MS = 30 * 60 * 1000;

/** Coarse refresh interval for active protected project collection reload unlocks. */
export const RELOAD_UNLOCK_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** The currently open project together with its in-memory project file system. */
export interface ActiveProject {
  readonly manifest: ProjectManifest;
  readonly filesystem: ProjectFileSystem;
}

/** Access status for the active project collection. */
export type ProjectCollectionAccessState = "ready" | "locked";

/** Snapshot of project collection state exposed to app UI. */
export interface ProjectCollectionState {
  /** Non-deleted project collections available in this app namespace. */
  readonly projectCollections: ProjectCollection[];
  /** Project collection that currently scopes project manager operations. */
  readonly activeProjectCollection?: ProjectCollection;
  /** Id of the currently open project, when one is open. */
  readonly activeProjectId?: string;
  /** Current access status for the active project collection. */
  readonly access: ProjectCollectionAccessState;
}

/** Result returned after changing the active project collection. */
export interface ProjectCollectionSwitchResult {
  /** Project collection that became active. */
  readonly collection: ProjectCollection;
  /** Access status for the active project collection. */
  readonly access: ProjectCollectionAccessState;
}

/** Result returned after unlocking a protected project collection. */
export interface ProjectCollectionUnlockResult {
  /** Project collection that was unlocked. */
  readonly collection: ProjectCollection;
  /** Access status after a successful unlock. */
  readonly access: "ready";
}

/** Summary row data for one project collection. */
export interface ProjectCollectionSummary {
  /** Project collection metadata for this summary row. */
  readonly collection: ProjectCollection;
  /** Number of non-deleted projects in the project collection. */
  readonly projectCount: number;
  /** Current tab access status for this project collection. */
  readonly access: ProjectCollectionAccessState;
}

/** Short-lived tab-local reload unlock record for one protected collection. */
export interface ProjectCollectionReloadUnlock {
  /** Project collection unlocked for reload restore. */
  readonly projectCollectionId: string;
  /** Unix epoch timestamp in milliseconds when the reload unlock expires. */
  readonly expiresAt: number;
}

/** Active project collection state watcher registration result. */
export interface ProjectCollectionStateSubscription {
  /** State captured immediately after the watcher was registered. */
  readonly initial: ProjectCollectionState;
  /** Stop receiving state updates. */
  readonly unsubscribe: () => void;
}

/** Project collection summary watcher registration result. */
export interface ProjectCollectionSummarySubscription {
  /** Summary rows captured immediately after the watcher was registered. */
  readonly initial: ProjectCollectionSummary[];
  /** Stop receiving summary updates. */
  readonly unsubscribe: () => void;
}

/** Refreshed project list watcher registration result. */
export interface ProjectListSubscription {
  /** Project list captured immediately after the watcher was registered. */
  readonly initial: ProjectManifest[];
  /** Stop receiving project list updates. */
  readonly unsubscribe: () => void;
}

/** Atomic project collection commit result for workspace UI flows. */
export interface ProjectCollectionProjectCommitResult {
  /** Project collection that became active. */
  readonly collection: ProjectCollection;
  /** Project that became active. */
  readonly project: ProjectManifest;
  /** Access status for the active project collection. */
  readonly access: "ready";
}

/** Targeted project collection summary patch emitted to workspace UI. */
export type ProjectCollectionSummaryChange =
  | { readonly type: "upsert"; readonly summary: ProjectCollectionSummary }
  | { readonly type: "remove"; readonly projectCollectionId: string };

/** Low-level in-process project collection event used by derived UI watchers. */
export type ProjectCollectionEvent =
  | { readonly type: "project-collection-changed"; readonly projectCollectionId: string }
  | { readonly type: "project-collection-tombstoned"; readonly projectCollectionId: string }
  | { readonly type: "project-list-changed"; readonly projectCollectionId: string }
  | { readonly type: "project-tombstoned"; readonly projectCollectionId: string; readonly projectId: string };

/** Non-fatal persistence failure observed by {@link ProjectManager}. */
export interface ProjectPersistenceError {
  /** ProjectManager operation that failed. */
  readonly operation: "autosave";
  /** Project collection containing the project being persisted. */
  readonly projectCollectionId: string;
  /** Project being persisted. */
  readonly projectId: string;
  /** Original error thrown by the persistence layer. */
  readonly error: unknown;
}

/** Options for {@link ProjectManager}. */
export interface ProjectManagerOptions {
  /** Options forwarded to the in-memory project file system created for the active project. */
  filesystemOptions?: InMemoryProjectFileSystemOptions;
  /** Cross-tab lock used to ensure a project is only open in one tab. */
  lock?: ProjectLock;
  /** Debounce delay before persisting project files after a change. Defaults to 2000 ms. */
  autoSaveDelayMs?: number;
}

/**
 * Coordinates project lifecycle on top of a {@link ProjectStore}: opening,
 * closing, creating, deleting, duplicating, and auto-saving the active
 * project's file system and app data.
 */
export class ProjectManager {
  private readonly store: ProjectStore;
  private readonly filesystemOptions: InMemoryProjectFileSystemOptions;
  private readonly lock: ProjectLock | undefined;
  private readonly autoSaveDelayMs: number;
  private readonly projectCollectionBroadcast: ProjectCollectionBroadcast;
  private readonly projectCollectionBroadcastUnsub: () => void;
  private readonly activeProjectListeners = new Set<(project: ActiveProject | undefined) => void>();
  private readonly projectListListeners = new Set<(projects: ProjectManifest[]) => void>();
  private readonly projectCollectionStateListeners = new Set<(state: ProjectCollectionState) => void>();
  private readonly projectCollectionEventListeners = new Set<(event: ProjectCollectionEvent) => void>();
  private readonly projectPersistenceErrorListeners = new Set<(error: ProjectPersistenceError) => void>();
  private currentProjectCollection: ProjectCollection | undefined;
  private currentActive: ActiveProject | undefined;
  private currentLockHandle: ProjectLockHandle | undefined;
  private autoSaveUnsub: (() => void) | undefined;
  private autoSaveTimerId: ReturnType<typeof setTimeout> | undefined;
  private reloadUnlockRefreshTimerId: ReturnType<typeof setInterval> | undefined;
  private reloadUnlockRefreshProjectCollectionId: string | undefined;
  private readonly unlockedProjectCollectionIds = new Set<string>();
  private disposed = false;

  constructor(store: ProjectStore, options?: ProjectManagerOptions) {
    this.store = store;
    this.filesystemOptions = options?.filesystemOptions ?? {};
    this.lock = options?.lock;
    this.autoSaveDelayMs = options?.autoSaveDelayMs ?? 2000;
    this.projectCollectionBroadcast = createProjectCollectionBroadcast(store.keyPrefix);
    this.projectCollectionBroadcastUnsub = this.projectCollectionBroadcast.subscribe((message) => {
      void this.handleProjectCollectionBroadcast(message);
    });
  }

  async init(): Promise<void> {
    const session = this.store.getProjectSession();
    const collection = await this.ensureInitialProjectCollection(session?.projectCollectionId);
    await this.restoreReloadUnlock(collection, session);
    if (this.collectionAccess(collection) === "locked") {
      await this.notifyProjectCollectionState();
      return;
    }
    if (!this.currentActive && session?.activeProjectId) {
      const restored = await this.tryRestoreSessionProject(session.activeProjectId, collection);
      if (!restored) {
        await this.ensureDefaultProjectInternal(DEFAULT_PROJECT_NAME, false);
      }
    }
    this.updateProjectSession();
    await this.notifyProjectCollectionState();
  }

  async listProjects(): Promise<ProjectManifest[]> {
    const collection = await this.ensureActiveProjectCollectionReady();
    return this.store.listProjects(collection.projectCollectionId);
  }

  get activeProject(): ActiveProject | undefined {
    return this.currentActive;
  }

  get activeProjectCollection(): ProjectCollection | undefined {
    return this.currentProjectCollection;
  }

  async create(name: string): Promise<ProjectManifest> {
    return this.createInternal(name, true);
  }

  private async createInternal(name: string, shouldNotifyProjectCollectionState: boolean): Promise<ProjectManifest> {
    const collection = await this.ensureActiveProjectCollectionReady();
    const manifest = await this.store.createProject(collection.projectCollectionId, name);
    await this.notifyProjectListChangedForCollection(collection.projectCollectionId);
    const active = await this.tryOpen(manifest.id, shouldNotifyProjectCollectionState);
    if (!active) {
      throw appHostError("PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB", "Project is already open in another tab");
    }
    return manifest;
  }

  async createFromSnapshot(
    name: string,
    description: string,
    snapshot: ProjectFileSnapshot,
    appData?: Record<string, string>,
    thumbnailUrl?: string
  ): Promise<ProjectManifest> {
    const collection = await this.requireActiveProjectCollectionReady();
    const manifest = await this.store.createProject(collection.projectCollectionId, name);
    await this.store.updateProject(manifest.id, { description, thumbnailUrl });
    await this.store.saveProjectFiles(manifest.id, snapshot);
    if (appData) {
      for (const [key, value] of Object.entries(appData)) {
        await this.store.saveAppData(manifest.id, key, value);
      }
    }
    await this.notifyProjectListChangedForCollection(collection.projectCollectionId);
    return manifest;
  }

  async open(id: string): Promise<ActiveProject> {
    const result = await this.tryOpen(id, true);
    if (!result) {
      throw appHostError("PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB", "Project is already open in another tab");
    }
    return result;
  }

  private async tryOpen(id: string, shouldNotifyProjectCollectionState: boolean): Promise<ActiveProject | undefined> {
    const collection = await this.ensureActiveProjectCollectionReady();
    const manifest = await this.store.getProject(id);
    if (!manifest) {
      throw appHostError("PROJECT_NOT_FOUND", `Project not found: ${id}`);
    }
    if (manifest.projectCollectionId !== collection.projectCollectionId) {
      throw appHostError("PROJECT_NOT_IN_ACTIVE_COLLECTION", `Project not found in active project collection: ${id}`);
    }

    if (this.currentActive?.manifest.id === id) {
      return this.currentActive;
    }

    const handle = await this.acquireLock(id);
    if (!handle) {
      return undefined;
    }

    if (this.currentActive) {
      await this.closeInternal();
    }

    this.currentLockHandle = handle;
    const active = await this.openInternal(manifest);
    this.currentActive = active;
    this.startAutoSave(active.filesystem);
    this.updateProjectSession(id);
    this.notifyActiveProject();
    if (shouldNotifyProjectCollectionState) {
      await this.notifyProjectCollectionState();
    }
    return active;
  }

  async close(): Promise<void> {
    if (!this.currentActive) {
      return;
    }
    await this.closeInternal();
    this.currentActive = undefined;
    this.updateProjectSession();
    this.notifyActiveProject();
    await this.notifyProjectCollectionState();
  }

  async delete(id: string): Promise<void> {
    if (this.currentActive?.manifest.id === id) {
      throw appHostError("ACTIVE_PROJECT_DELETE_BLOCKED", "Cannot delete the active project");
    }
    const manifest = await this.getProjectInActiveCollection(id);
    await this.store.deleteProject(id);
    this.projectCollectionBroadcast.post({
      type: "project-tombstoned",
      projectCollectionId: manifest.projectCollectionId,
      projectId: manifest.id,
    });
    await this.notifyProjectTombstoned(manifest.projectCollectionId, manifest.id);
    await this.notifyProjectCollectionState();
  }

  async duplicate(id: string, newName: string): Promise<ProjectManifest> {
    await this.getProjectInActiveCollection(id);
    const manifest = await this.store.duplicateProject(id, newName);
    await this.notifyProjectListChangedForCollection(manifest.projectCollectionId);
    return manifest;
  }

  async updateActive(updates: Partial<Pick<ProjectManifest, "name" | "description" | "thumbnailUrl">>): Promise<void> {
    if (!this.currentActive) {
      throw appHostError("NO_ACTIVE_PROJECT", "No active project");
    }
    await this.requireActiveProjectCollectionReady();
    if (updates.name !== undefined && !updates.name.trim()) {
      return;
    }
    const id = this.currentActive.manifest.id;
    const projectCollectionId = this.currentActive.manifest.projectCollectionId;
    try {
      await this.store.updateProject(id, updates);
    } catch (error) {
      await this.recoverCurrentActiveAfterWriteError(projectCollectionId, id, error);
    }
    const updated = await this.store.getProject(id);
    if (updated) {
      this.currentActive = { manifest: updated, filesystem: this.currentActive.filesystem };
      this.notifyActiveProject();
      await this.notifyProjectListChangedForCollection(projectCollectionId);
      await this.notifyProjectCollectionState();
    }
  }

  async ensureDefaultProject(defaultName: string): Promise<ActiveProject> {
    return this.ensureDefaultProjectInternal(defaultName, true);
  }

  private async ensureDefaultProjectInternal(
    defaultName: string,
    shouldNotifyProjectCollectionState: boolean
  ): Promise<ActiveProject> {
    if (this.currentActive) {
      return this.currentActive;
    }
    const existing = await this.openFirstAvailableProject(shouldNotifyProjectCollectionState);
    if (existing) {
      return existing;
    }
    await this.createInternal(defaultName, shouldNotifyProjectCollectionState);
    return this.currentActive!;
  }

  /** Get the current project collection state. */
  async getProjectCollectionState(): Promise<ProjectCollectionState> {
    const activeProjectCollection = await this.getLiveCurrentProjectCollection();
    return {
      projectCollections: await this.store.listProjectCollections(),
      activeProjectCollection,
      activeProjectId: this.currentActive?.manifest.id,
      access: activeProjectCollection ? this.collectionAccess(activeProjectCollection) : "ready",
    };
  }

  /**
   * Subscribe to committed project collection state after registering the
   * listener.
   */
  async watchProjectCollectionState(
    listener: (state: ProjectCollectionState) => void
  ): Promise<ProjectCollectionStateSubscription> {
    let active = true;
    let initializing = true;
    let changedWhileInitializing = false;
    const unsubscribeStateChange = this.onProjectCollectionStateChange((state) => {
      if (initializing) {
        changedWhileInitializing = true;
        return;
      }
      if (active) {
        listener(state);
      }
    });
    const initial = await this.getProjectCollectionState();
    initializing = false;
    if (changedWhileInitializing) {
      setTimeout(() => {
        if (active) {
          void this.getProjectCollectionState().then((state) => {
            if (active) {
              listener(state);
            }
          });
        }
      }, 0);
    }
    return {
      initial,
      unsubscribe: () => {
        active = false;
        unsubscribeStateChange();
      },
    };
  }

  /**
   * Subscribe to project collection state changes.
   *
   * The current state is not emitted during subscription. Call
   * {@link getProjectCollectionState} after subscribing to read the initial
   * state.
   */
  onProjectCollectionStateChange(listener: (state: ProjectCollectionState) => void): () => void {
    this.projectCollectionStateListeners.add(listener);
    return () => {
      this.projectCollectionStateListeners.delete(listener);
    };
  }

  /** Subscribe to low-level project collection UI events without replay. */
  onProjectCollectionEvent(listener: (event: ProjectCollectionEvent) => void): () => void {
    this.projectCollectionEventListeners.add(listener);
    return () => {
      this.projectCollectionEventListeners.delete(listener);
    };
  }

  /** Watch project collection summaries and receive targeted patches. */
  async watchProjectCollectionSummaries(
    listener: (change: ProjectCollectionSummaryChange) => void
  ): Promise<ProjectCollectionSummarySubscription> {
    let active = true;
    let initializing = true;
    const bufferedEvents: ProjectCollectionEvent[] = [];
    const projectListChanges = new Set<string>();
    const handleEvent = (event: ProjectCollectionEvent) => {
      if (event.type === "project-collection-tombstoned") {
        if (active) {
          listener({ type: "remove", projectCollectionId: event.projectCollectionId });
        }
        return;
      }
      if (event.type === "project-collection-changed" || event.type === "project-list-changed") {
        if (event.type === "project-list-changed") {
          projectListChanges.add(event.projectCollectionId);
          queueMicrotask(() => {
            projectListChanges.delete(event.projectCollectionId);
          });
        }
        void this.loadProjectCollectionSummary(event.projectCollectionId).then((summary) => {
          if (active && summary) {
            listener({ type: "upsert", summary });
          }
        });
        return;
      }
      if (projectListChanges.has(event.projectCollectionId)) {
        return;
      }
      void this.loadProjectCollectionSummary(event.projectCollectionId).then((summary) => {
        if (active && summary) {
          listener({ type: "upsert", summary });
        }
      });
    };
    const unsubscribeProjectCollectionEvent = this.onProjectCollectionEvent((event) => {
      if (initializing) {
        bufferedEvents.push(event);
        return;
      }
      handleEvent(event);
    });
    const initial = await this.loadProjectCollectionSummaries();
    initializing = false;
    if (bufferedEvents.length > 0) {
      setTimeout(() => {
        if (!active) {
          return;
        }
        for (const event of bufferedEvents) {
          handleEvent(event);
        }
      }, 0);
    }
    return {
      initial,
      unsubscribe: () => {
        active = false;
        unsubscribeProjectCollectionEvent();
      },
    };
  }

  /** List non-deleted projects in a non-deleted project collection. */
  async listProjectsForCollection(projectCollectionId: string): Promise<ProjectManifest[]> {
    const collection = await this.requireProjectCollection(projectCollectionId);
    this.assertProjectCollectionReady(collection);
    return this.store.listProjects(projectCollectionId);
  }

  /** Watch one project collection's project list and receive refreshed lists. */
  async watchProjectListForCollection(
    projectCollectionId: string,
    listener: (projects: ProjectManifest[]) => void
  ): Promise<ProjectListSubscription> {
    let active = true;
    let initializing = true;
    const bufferedEvents: ProjectCollectionEvent[] = [];
    let projectListChanged = false;
    let collectionUnavailable = false;
    const emitProjectList = () => {
      if (collectionUnavailable) {
        if (active) {
          listener([]);
        }
        return;
      }
      void this.listProjectsForCollection(projectCollectionId)
        .catch((error: unknown) => {
          if (error instanceof AppHostError && error.code === "PROJECT_COLLECTION_NOT_FOUND") {
            collectionUnavailable = true;
            return [];
          }
          throw error;
        })
        .then((projects) => {
          if (active) {
            listener(projects);
          }
        });
    };
    const handleEvent = (event: ProjectCollectionEvent) => {
      if (event.projectCollectionId === projectCollectionId && event.type === "project-collection-tombstoned") {
        collectionUnavailable = true;
        if (active) {
          listener([]);
        }
        return;
      }
      if (collectionUnavailable) {
        return;
      }
      if (event.projectCollectionId === projectCollectionId && event.type === "project-list-changed") {
        projectListChanged = true;
        queueMicrotask(() => {
          projectListChanged = false;
        });
        emitProjectList();
        return;
      }
      if (
        event.projectCollectionId === projectCollectionId &&
        event.type === "project-tombstoned" &&
        !projectListChanged
      ) {
        emitProjectList();
      }
    };
    const unsubscribeProjectCollectionEvent = this.onProjectCollectionEvent((event) => {
      if (initializing) {
        bufferedEvents.push(event);
        return;
      }
      handleEvent(event);
    });
    const initial = await this.listProjectsForCollection(projectCollectionId);
    initializing = false;
    if (bufferedEvents.length > 0) {
      setTimeout(() => {
        if (!active) {
          return;
        }
        for (const event of bufferedEvents) {
          handleEvent(event);
        }
      }, 0);
    }
    return {
      initial,
      unsubscribe: () => {
        active = false;
        unsubscribeProjectCollectionEvent();
      },
    };
  }

  /** List non-deleted project collections. */
  async listProjectCollections(): Promise<ProjectCollection[]> {
    return this.store.listProjectCollections();
  }

  /** Create a project collection without switching to it. */
  async createProjectCollection(name: string): Promise<ProjectCollection> {
    const collection = await this.store.createProjectCollection(name);
    this.projectCollectionBroadcast.post({
      type: "project-collection-changed",
      projectCollectionId: collection.projectCollectionId,
    });
    this.emitProjectCollectionEvent({
      type: "project-collection-changed",
      projectCollectionId: collection.projectCollectionId,
    });
    await this.notifyProjectCollectionState();
    return collection;
  }

  /** Rename a project collection. */
  async renameProjectCollection(projectCollectionId: string, name: string): Promise<void> {
    await this.store.updateProjectCollection(projectCollectionId, { name });
    if (this.currentProjectCollection?.projectCollectionId === projectCollectionId) {
      const updated = await this.store.getProjectCollection(projectCollectionId);
      this.currentProjectCollection = updated;
    }
    this.projectCollectionBroadcast.post({
      type: "project-collection-changed",
      projectCollectionId,
    });
    this.emitProjectCollectionEvent({
      type: "project-collection-changed",
      projectCollectionId,
    });
    await this.notifyProjectCollectionState();
  }

  /**
   * Set or change a project collection PIN.
   *
   * @param projectCollectionId - Project collection to protect.
   * @param pin - User-entered PIN or phrase.
   * @returns The updated project collection.
   */
  async setProjectCollectionPin(projectCollectionId: string, pin: string): Promise<ProjectCollection> {
    const collection = await this.requireProjectCollection(projectCollectionId);
    if (collection.pinVerifier && !this.isProjectCollectionUnlocked(projectCollectionId)) {
      throw appHostError("PROJECT_COLLECTION_LOCKED", "Project collection must be unlocked before changing its PIN");
    }
    const pinVerifier = await createProjectCollectionPinVerifier(pin);
    await this.store.updateProjectCollection(projectCollectionId, { pinVerifier });
    const updated = await this.requireProjectCollection(projectCollectionId);
    this.unlockedProjectCollectionIds.add(projectCollectionId);
    await this.refreshCurrentProjectCollection(updated);
    this.writeReloadUnlockForCurrentSession(projectCollectionId);
    this.updateReloadUnlockRefreshTimer();
    this.emitProjectCollectionChanged(projectCollectionId);
    await this.notifyProjectCollectionState();
    return updated;
  }

  /**
   * Remove PIN protection from a project collection.
   *
   * @param projectCollectionId - Project collection to make unprotected.
   * @returns The updated project collection.
   */
  async clearProjectCollectionPin(projectCollectionId: string): Promise<ProjectCollection> {
    const collection = await this.requireProjectCollection(projectCollectionId);
    if (collection.pinVerifier && !this.isProjectCollectionUnlocked(projectCollectionId)) {
      throw appHostError("PROJECT_COLLECTION_LOCKED", "Project collection must be unlocked before removing its PIN");
    }
    await this.store.updateProjectCollection(projectCollectionId, { pinVerifier: undefined });
    const updated = await this.requireProjectCollection(projectCollectionId);
    this.unlockedProjectCollectionIds.delete(projectCollectionId);
    this.removeReloadUnlockRecord(projectCollectionId);
    await this.refreshCurrentProjectCollection(updated);
    this.updateReloadUnlockRefreshTimer();
    this.emitProjectCollectionChanged(projectCollectionId);
    await this.notifyProjectCollectionState();
    return updated;
  }

  /**
   * Unlock a protected project collection in this manager instance.
   *
   * @param projectCollectionId - Project collection to unlock.
   * @param pin - User-entered PIN or phrase.
   */
  async unlockProjectCollection(projectCollectionId: string, pin: string): Promise<ProjectCollectionUnlockResult> {
    const collection = await this.requireProjectCollection(projectCollectionId);
    if (!collection.pinVerifier) {
      return { collection, access: "ready" };
    }
    let unlocked = await verifyProjectCollectionPin(pin, collection.pinVerifier);
    const current = await this.store.getProjectCollection(projectCollectionId);
    if (!current) {
      throw appHostError("PROJECT_COLLECTION_NOT_FOUND", `Project collection not found: ${projectCollectionId}`);
    }
    if (!current.pinVerifier) {
      return { collection: current, access: "ready" };
    }
    if (!projectCollectionPinVerifiersMatch(current.pinVerifier, collection.pinVerifier)) {
      unlocked = await verifyProjectCollectionPin(pin, current.pinVerifier);
    }
    if (!unlocked) {
      throw appHostError("PROJECT_COLLECTION_PIN_INVALID", "Invalid project collection PIN");
    }
    this.unlockedProjectCollectionIds.add(projectCollectionId);
    await this.refreshCurrentProjectCollection(current);
    this.writeReloadUnlockForCurrentSession(projectCollectionId);
    this.updateReloadUnlockRefreshTimer();
    if (this.currentProjectCollection?.projectCollectionId === projectCollectionId && !this.currentActive) {
      const session = this.store.getProjectSession();
      if (session?.activeProjectId) {
        const restored = await this.tryRestoreSessionProject(session.activeProjectId, current);
        if (!restored) {
          await this.ensureDefaultProjectInternal(DEFAULT_PROJECT_NAME, false);
        }
      } else {
        await this.ensureDefaultProjectInternal(DEFAULT_PROJECT_NAME, false);
      }
      this.updateProjectSession();
    }
    this.emitProjectCollectionChanged(projectCollectionId);
    await this.notifyProjectCollectionState();
    return { collection: current, access: "ready" };
  }

  /**
   * Lock a protected project collection in this manager instance.
   *
   * @param projectCollectionId - Project collection to lock.
   */
  lockProjectCollection(projectCollectionId: string): void {
    this.unlockedProjectCollectionIds.delete(projectCollectionId);
    this.removeReloadUnlockRecord(projectCollectionId);
    this.updateReloadUnlockRefreshTimer();
    this.emitProjectCollectionChanged(projectCollectionId);
    void this.closeActiveProjectCollectionAfterLock(projectCollectionId);
  }

  /**
   * Check whether a protected project collection is unlocked in this manager.
   *
   * @param projectCollectionId - Project collection id to check.
   */
  isProjectCollectionUnlocked(projectCollectionId: string): boolean {
    return this.unlockedProjectCollectionIds.has(projectCollectionId);
  }

  /** Switch the active project collection and open a project in it. */
  async switchProjectCollection(projectCollectionId: string): Promise<ProjectCollectionSwitchResult> {
    const target = await this.store.getProjectCollection(projectCollectionId);
    if (!target) {
      throw appHostError("PROJECT_COLLECTION_NOT_FOUND", `Project collection not found: ${projectCollectionId}`);
    }
    if (this.currentProjectCollection?.projectCollectionId === target.projectCollectionId) {
      this.currentProjectCollection = target;
      const access = this.collectionAccess(target);
      if (access === "locked" && this.currentActive) {
        await this.closeInternal();
        this.currentActive = undefined;
        this.updateProjectSession();
        this.notifyActiveProject();
      }
      await this.notifyProjectCollectionState();
      return { collection: target, access };
    }

    const previousProjectCollectionId = this.currentProjectCollection?.projectCollectionId;
    if (this.currentActive) {
      await this.closeInternal();
      this.currentActive = undefined;
      this.updateProjectSession();
      this.notifyActiveProject();
    }

    this.currentProjectCollection = target;
    this.updateProjectSession();
    this.lockProtectedCollectionsExcept(target.projectCollectionId, previousProjectCollectionId);
    if (this.collectionAccess(target) === "ready") {
      await this.notifyProjectList();
      await this.ensureDefaultProjectInternal(DEFAULT_PROJECT_NAME, false);
    } else {
      await this.notifyProjectListListeners([]);
    }
    this.updateReloadUnlockRefreshTimer();
    await this.notifyProjectCollectionState();
    return { collection: target, access: this.collectionAccess(target) };
  }

  /** Tombstone a non-active, non-default project collection and its projects. */
  async deleteProjectCollection(projectCollectionId: string): Promise<void> {
    if (projectCollectionId === DEFAULT_PROJECT_COLLECTION_ID) {
      throw appHostError("DEFAULT_PROJECT_COLLECTION_DELETE_BLOCKED", "Cannot delete the default project collection");
    }
    const active = await this.ensureActiveProjectCollection();
    if (active.projectCollectionId === projectCollectionId) {
      throw appHostError("ACTIVE_PROJECT_COLLECTION_DELETE_BLOCKED", "Cannot delete the active project collection");
    }
    const target = await this.requireProjectCollection(projectCollectionId);
    this.assertProjectCollectionReady(target);
    await this.store.deleteProjectCollection(projectCollectionId);
    this.unlockedProjectCollectionIds.delete(projectCollectionId);
    this.removeReloadUnlockRecord(projectCollectionId);
    this.updateReloadUnlockRefreshTimer();
    this.projectCollectionBroadcast.post({
      type: "project-collection-tombstoned",
      projectCollectionId,
    });
    this.emitProjectCollectionEvent({
      type: "project-collection-tombstoned",
      projectCollectionId,
    });
    await this.notifyProjectCollectionState();
  }

  /** Switch to a project collection and open a selected project atomically. */
  async switchProjectCollectionAndOpenProject(
    projectCollectionId: string,
    projectId: string
  ): Promise<ProjectCollectionProjectCommitResult> {
    const collection = await this.requireProjectCollection(projectCollectionId);
    this.assertProjectCollectionReady(collection);
    const project = await this.store.getProject(projectId);
    if (!project) {
      throw appHostError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`);
    }
    if (project.projectCollectionId !== projectCollectionId) {
      throw appHostError("PROJECT_NOT_IN_ACTIVE_COLLECTION", `Project not found in project collection: ${projectId}`);
    }
    return this.commitProjectCollectionProject(collection, project);
  }

  /** Switch to a project collection and create a project there atomically. */
  async switchProjectCollectionAndCreateProject(
    projectCollectionId: string,
    name: string
  ): Promise<ProjectCollectionProjectCommitResult> {
    const collection = await this.requireProjectCollection(projectCollectionId);
    this.assertProjectCollectionReady(collection);
    const project = await this.store.createProject(collection.projectCollectionId, name);
    let result: ProjectCollectionProjectCommitResult;
    try {
      result = await this.commitProjectCollectionProject(collection, project);
    } catch (error) {
      await this.deleteCreatedProjectAfterFailedCommit(project);
      throw error;
    }
    this.emitProjectCollectionEvent({
      type: "project-list-changed",
      projectCollectionId: collection.projectCollectionId,
    });
    return result;
  }

  async saveAppData(key: string, data: string): Promise<void> {
    if (!this.currentActive) {
      throw appHostError("NO_ACTIVE_PROJECT", "No active project");
    }
    const { id, projectCollectionId } = this.currentActive.manifest;
    await this.requireActiveProjectCollectionReady();
    try {
      await this.store.saveAppData(id, key, data);
    } catch (error) {
      await this.recoverCurrentActiveAfterWriteError(projectCollectionId, id, error);
    }
  }

  async loadAppData(key: string): Promise<string | undefined> {
    if (!this.currentActive) {
      return undefined;
    }
    await this.requireActiveProjectCollectionReady();
    return this.store.loadAppData(this.currentActive.manifest.id, key);
  }

  async deleteAppData(key: string): Promise<void> {
    if (!this.currentActive) {
      throw appHostError("NO_ACTIVE_PROJECT", "No active project");
    }
    const { id, projectCollectionId } = this.currentActive.manifest;
    await this.requireActiveProjectCollectionReady();
    try {
      await this.store.deleteAppData(id, key);
    } catch (error) {
      await this.recoverCurrentActiveAfterWriteError(projectCollectionId, id, error);
    }
  }

  onActiveProjectChange(listener: (project: ActiveProject | undefined) => void): () => void {
    this.activeProjectListeners.add(listener);
    return () => {
      this.activeProjectListeners.delete(listener);
    };
  }

  onProjectListChange(listener: (projects: ProjectManifest[]) => void): () => void {
    this.projectListListeners.add(listener);
    return () => {
      this.projectListListeners.delete(listener);
    };
  }

  /** Subscribe to non-fatal project persistence failures. */
  onProjectPersistenceError(listener: (error: ProjectPersistenceError) => void): () => void {
    this.projectPersistenceErrorListeners.add(listener);
    return () => {
      this.projectPersistenceErrorListeners.delete(listener);
    };
  }

  /** Close cross-tab project collection resources owned by this manager. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.reloadUnlockRefreshProjectCollectionId) {
      this.removeReloadUnlockRecord(this.reloadUnlockRefreshProjectCollectionId);
    }
    this.stopReloadUnlockRefreshTimer();
    this.projectCollectionBroadcastUnsub();
    this.projectCollectionBroadcast.close();
  }

  private async acquireLock(id: string): Promise<ProjectLockHandle | undefined> {
    if (!this.lock) {
      return { release() {} };
    }
    return this.lock.tryAcquire(id);
  }

  private async openInternal(manifest: ProjectManifest): Promise<ActiveProject> {
    if (!manifest.name.trim()) {
      manifest = { ...manifest, name: DEFAULT_PROJECT_NAME };
      await this.store.updateProject(manifest.id, { name: DEFAULT_PROJECT_NAME });
    }
    const snapshot = await this.store.loadProjectFiles(manifest.id);
    const filesystem = createInMemoryProjectFileSystem(this.filesystemOptions);

    if (snapshot) {
      filesystem.applyRemoteChange({
        action: "import",
        entries: Array.from(snapshot),
      });
    }

    return { manifest, filesystem };
  }

  private async closeInternal(): Promise<void> {
    if (!this.currentActive) {
      return;
    }
    const { manifest, filesystem } = this.currentActive;
    filesystem.flush();
    await this.store.saveProjectFiles(manifest.id, filesystem.exportSnapshot());
    this.stopAutoSave();
    if (this.currentLockHandle) {
      this.releaseLockHandle(this.currentLockHandle);
    }
    this.currentLockHandle = undefined;
  }

  private startAutoSave(filesystem: ProjectFileSystem): void {
    this.autoSaveUnsub = filesystem.onAnyChange(() => {
      this.scheduleAutoSave();
    });
  }

  private stopAutoSave(): void {
    if (this.autoSaveTimerId !== undefined) {
      clearTimeout(this.autoSaveTimerId);
      this.autoSaveTimerId = undefined;
    }
    this.autoSaveUnsub?.();
    this.autoSaveUnsub = undefined;
  }

  private scheduleAutoSave(): void {
    if (this.autoSaveTimerId !== undefined) {
      clearTimeout(this.autoSaveTimerId);
    }
    this.autoSaveTimerId = setTimeout(() => {
      this.autoSaveTimerId = undefined;
      if (this.currentActive) {
        const { manifest, filesystem } = this.currentActive;
        this.store.saveProjectFiles(manifest.id, filesystem.exportSnapshot()).catch((error: unknown) => {
          void this.handleAutoSaveError(manifest.projectCollectionId, manifest.id, error);
        });
      }
    }, this.autoSaveDelayMs);
  }

  private notifyActiveProject(): void {
    for (const listener of this.activeProjectListeners) {
      listener(this.currentActive);
    }
  }

  private async notifyProjectList(): Promise<void> {
    const projects = await this.listProjects();
    this.notifyProjectListListeners(projects);
  }

  private notifyProjectListListeners(projects: ProjectManifest[]): void {
    for (const listener of this.projectListListeners) {
      listener(projects);
    }
  }

  private async notifyProjectListChangedForCollection(projectCollectionId: string): Promise<void> {
    if (this.currentProjectCollection?.projectCollectionId === projectCollectionId) {
      await this.notifyProjectList();
    }
    this.emitProjectCollectionEvent({
      type: "project-list-changed",
      projectCollectionId,
    });
  }

  private async notifyProjectTombstoned(projectCollectionId: string, projectId: string): Promise<void> {
    if (this.currentProjectCollection?.projectCollectionId === projectCollectionId) {
      await this.notifyProjectList();
    }
    this.emitProjectCollectionEvent({
      type: "project-list-changed",
      projectCollectionId,
    });
    this.emitProjectCollectionEvent({
      type: "project-tombstoned",
      projectCollectionId,
      projectId,
    });
  }

  private async notifyProjectCollectionState(): Promise<void> {
    const state = await this.getProjectCollectionState();
    for (const listener of this.projectCollectionStateListeners) {
      listener(state);
    }
  }

  private emitProjectCollectionEvent(event: ProjectCollectionEvent): void {
    for (const listener of this.projectCollectionEventListeners) {
      listener(event);
    }
  }

  private notifyProjectPersistenceError(error: ProjectPersistenceError): void {
    for (const listener of this.projectPersistenceErrorListeners) {
      listener(error);
    }
  }

  private async loadProjectCollectionSummaries(): Promise<ProjectCollectionSummary[]> {
    const [collections, projectCounts] = await Promise.all([
      this.store.listProjectCollections(),
      this.store.countProjectsByCollection(),
    ]);
    return collections.map((collection) => ({
      collection,
      projectCount: projectCounts.get(collection.projectCollectionId) ?? 0,
      access: this.collectionAccess(collection),
    }));
  }

  private async loadProjectCollectionSummary(
    projectCollectionId: string
  ): Promise<ProjectCollectionSummary | undefined> {
    const collection = await this.store.getProjectCollection(projectCollectionId);
    if (!collection) {
      return undefined;
    }
    return {
      collection,
      projectCount: (await this.store.listProjects(projectCollectionId)).length,
      access: this.collectionAccess(collection),
    };
  }

  private async ensureInitialProjectCollection(projectCollectionId?: string): Promise<ProjectCollection> {
    if (projectCollectionId) {
      const restored = await this.store.getProjectCollection(projectCollectionId);
      if (restored) {
        this.currentProjectCollection = restored;
        return restored;
      }
    }

    if (!this.currentProjectCollection) {
      this.currentProjectCollection = await this.store.ensureDefaultProjectCollection();
      return this.currentProjectCollection;
    }

    const current = await this.store.getProjectCollection(this.currentProjectCollection.projectCollectionId);
    if (current) {
      this.currentProjectCollection = current;
      return current;
    }

    this.currentProjectCollection = await this.store.ensureDefaultProjectCollection();
    return this.currentProjectCollection;
  }

  private async ensureActiveProjectCollection(): Promise<ProjectCollection> {
    if (!this.currentProjectCollection) {
      this.currentProjectCollection = await this.store.ensureDefaultProjectCollection();
      return this.currentProjectCollection;
    }
    return this.requireActiveProjectCollection();
  }

  private async ensureActiveProjectCollectionReady(): Promise<ProjectCollection> {
    const collection = await this.ensureActiveProjectCollection();
    this.assertProjectCollectionReady(collection);
    return collection;
  }

  private async requireActiveProjectCollection(): Promise<ProjectCollection> {
    if (!this.currentProjectCollection) {
      throw appHostError("NO_ACTIVE_PROJECT_COLLECTION", "No active project collection");
    }
    const collection = await this.requireProjectCollection(this.currentProjectCollection.projectCollectionId);
    this.currentProjectCollection = collection;
    return collection;
  }

  private async requireActiveProjectCollectionReady(): Promise<ProjectCollection> {
    const collection = await this.requireActiveProjectCollection();
    this.assertProjectCollectionReady(collection);
    return collection;
  }

  private async requireProjectCollection(projectCollectionId: string): Promise<ProjectCollection> {
    const collection = await this.store.getProjectCollection(projectCollectionId);
    if (!collection) {
      throw appHostError("PROJECT_COLLECTION_NOT_FOUND", `Project collection not found: ${projectCollectionId}`);
    }
    return collection;
  }

  private async getLiveCurrentProjectCollection(): Promise<ProjectCollection | undefined> {
    if (!this.currentProjectCollection) {
      return undefined;
    }
    const collection = await this.store.getProjectCollection(this.currentProjectCollection.projectCollectionId);
    if (!collection) {
      return undefined;
    }
    this.currentProjectCollection = collection;
    return collection;
  }

  private async getProjectInActiveCollection(id: string): Promise<ProjectManifest> {
    const collection = await this.ensureActiveProjectCollectionReady();
    const manifest = await this.store.getProject(id);
    if (!manifest || manifest.projectCollectionId !== collection.projectCollectionId) {
      throw appHostError("PROJECT_NOT_IN_ACTIVE_COLLECTION", `Project not found in active project collection: ${id}`);
    }
    return manifest;
  }

  private async tryRestoreSessionProject(
    activeProjectId: string,
    collection: ProjectCollection
  ): Promise<ActiveProject | undefined> {
    const manifest = await this.store.getProject(activeProjectId);
    if (!manifest || manifest.projectCollectionId !== collection.projectCollectionId) {
      return undefined;
    }

    const handle = await this.acquireLock(manifest.id);
    if (!handle) {
      return undefined;
    }

    this.currentLockHandle = handle;
    const active = await this.openInternal(manifest);
    this.currentActive = active;
    this.startAutoSave(active.filesystem);
    this.notifyActiveProject();
    return active;
  }

  private async commitProjectCollectionProject(
    collection: ProjectCollection,
    project: ProjectManifest
  ): Promise<ProjectCollectionProjectCommitResult> {
    this.assertProjectCollectionReady(collection);
    if (
      this.currentProjectCollection?.projectCollectionId === collection.projectCollectionId &&
      this.currentActive?.manifest.id === project.id
    ) {
      this.currentProjectCollection = collection;
      this.currentActive = { manifest: project, filesystem: this.currentActive.filesystem };
      return { collection, project, access: "ready" };
    }

    const handle = await this.acquireLock(project.id);
    if (!handle) {
      throw appHostError("PROJECT_ALREADY_OPEN_IN_ANOTHER_TAB", "Project is already open in another tab");
    }

    try {
      if (this.currentActive) {
        await this.closeInternal();
      }

      const previousProjectCollectionId = this.currentProjectCollection?.projectCollectionId;
      const active = await this.openInternal(project);
      this.currentProjectCollection = collection;
      this.currentLockHandle = handle;
      this.currentActive = active;
      this.lockProtectedCollectionsExcept(collection.projectCollectionId, previousProjectCollectionId);
      this.startAutoSave(active.filesystem);
      this.updateProjectSession(project.id);
      this.notifyActiveProject();
      await this.notifyProjectList();
      await this.notifyProjectCollectionState();
      return { collection, project: active.manifest, access: "ready" };
    } catch (error) {
      this.releaseLockHandle(handle);
      throw error;
    }
  }

  private async deleteCreatedProjectAfterFailedCommit(project: ProjectManifest): Promise<void> {
    if (this.currentActive?.manifest.id === project.id) {
      return;
    }
    try {
      await this.store.deleteProject(project.id);
    } catch {
      return;
    }
  }

  private updateProjectSession(activeProjectId = this.currentActive?.manifest.id): void {
    if (!this.currentProjectCollection) {
      if (this.store.getProjectSession() !== undefined) {
        this.store.setProjectSession(undefined);
      }
      return;
    }
    const session: ProjectCollectionTabSession = {
      projectCollectionId: this.currentProjectCollection.projectCollectionId,
      ...(activeProjectId === undefined ? {} : { activeProjectId }),
    };
    if (projectSessionsEqual(this.store.getProjectSession(), session)) {
      return;
    }
    this.store.setProjectSession(session);
  }

  private async handleProjectCollectionBroadcast(message: ProjectCollectionBroadcastMessage): Promise<void> {
    const activeCollectionId = this.currentProjectCollection?.projectCollectionId;
    this.emitProjectCollectionEvent(message);
    if (!activeCollectionId) {
      return;
    }
    if (message.type === "project-collection-tombstoned") {
      if (message.projectCollectionId === activeCollectionId) {
        await this.recoverFromTombstonedActiveCollection();
      }
      return;
    }
    if (message.type === "project-collection-changed") {
      if (message.projectCollectionId === activeCollectionId) {
        const activeProjectCollection = await this.getLiveCurrentProjectCollection();
        if (activeProjectCollection) {
          await this.reconcileActiveProjectCollectionAccess(activeProjectCollection);
          await this.notifyProjectCollectionState();
        }
      }
      return;
    }
    if (message.projectCollectionId === activeCollectionId && this.currentActive?.manifest.id === message.projectId) {
      await this.recoverFromTombstonedActiveProject();
    }
  }

  private async recoverFromTombstonedActiveCollection(): Promise<void> {
    const tombstonedProjectCollectionId = this.currentProjectCollection?.projectCollectionId;
    this.discardCurrentActiveWithoutSaving();
    if (tombstonedProjectCollectionId) {
      this.unlockedProjectCollectionIds.delete(tombstonedProjectCollectionId);
      this.removeReloadUnlockRecord(tombstonedProjectCollectionId);
    }
    this.currentProjectCollection = await this.store.ensureDefaultProjectCollection();
    this.updateProjectSession();
    this.updateReloadUnlockRefreshTimer();
    this.notifyActiveProject();
    if (this.collectionAccess(this.currentProjectCollection) === "ready") {
      await this.notifyProjectList();
      await this.ensureDefaultProjectInternal(DEFAULT_PROJECT_NAME, false);
    } else {
      this.notifyProjectListListeners([]);
    }
    await this.notifyProjectCollectionState();
  }

  private async recoverFromTombstonedActiveProject(): Promise<void> {
    this.discardCurrentActiveWithoutSaving();
    this.updateProjectSession();
    this.notifyActiveProject();
    await this.notifyProjectList();
    await this.replaceTombstonedActiveProject();
    await this.notifyProjectCollectionState();
  }

  private async reconcileActiveProjectCollectionAccess(collection: ProjectCollection): Promise<void> {
    if (!collection.pinVerifier) {
      this.unlockedProjectCollectionIds.delete(collection.projectCollectionId);
      this.removeReloadUnlockRecord(collection.projectCollectionId);
    }
    if (this.collectionAccess(collection) === "locked" && this.currentActive) {
      await this.closeInternal();
      this.currentActive = undefined;
      this.notifyActiveProject();
      this.notifyProjectListListeners([]);
    }
    this.updateReloadUnlockRefreshTimer();
  }

  private async closeActiveProjectCollectionAfterLock(projectCollectionId: string): Promise<void> {
    if (this.currentProjectCollection?.projectCollectionId === projectCollectionId && this.currentActive) {
      await this.closeInternal();
      this.currentActive = undefined;
      this.notifyActiveProject();
      this.notifyProjectListListeners([]);
    }
    await this.notifyProjectCollectionState();
  }

  private async replaceTombstonedActiveProject(): Promise<ActiveProject> {
    const collection = await this.ensureActiveProjectCollection();
    if (this.collectionAccess(collection) === "locked") {
      throw appHostError("PROJECT_COLLECTION_LOCKED", "Project collection is locked");
    }
    const existing = await this.openFirstAvailableProject(false);
    if (existing) {
      return existing;
    }
    await this.createInternal(DEFAULT_PROJECT_NAME, false);
    return this.currentActive!;
  }

  private async openFirstAvailableProject(
    shouldNotifyProjectCollectionState: boolean
  ): Promise<ActiveProject | undefined> {
    const collection = await this.ensureActiveProjectCollection();
    if (this.collectionAccess(collection) === "locked") {
      return undefined;
    }
    const existing = await this.store.listProjects(collection.projectCollectionId);
    for (const project of existing) {
      const result = await this.tryOpen(project.id, shouldNotifyProjectCollectionState);
      if (result) {
        return result;
      }
    }
    return undefined;
  }

  private discardCurrentActiveWithoutSaving(): void {
    this.stopAutoSave();
    if (this.currentLockHandle) {
      this.releaseLockHandle(this.currentLockHandle);
    }
    this.currentLockHandle = undefined;
    this.currentActive = undefined;
  }

  private releaseLockHandle(handle: ProjectLockHandle): void {
    try {
      handle.release();
    } catch (error) {
      logger.error("[app-host] project lock release failed", error);
    }
  }

  private async handleAutoSaveError(projectCollectionId: string, projectId: string, error: unknown): Promise<void> {
    const recovered = await this.recoverIfCurrentActiveIsStale(projectCollectionId, projectId);
    if (recovered) {
      return;
    }

    const persistenceError: ProjectPersistenceError = {
      operation: "autosave",
      projectCollectionId,
      projectId,
      error,
    };
    this.notifyProjectPersistenceError(persistenceError);
    logger.error("[app-host] project autosave failed", error);
  }

  private async recoverCurrentActiveAfterWriteError(
    projectCollectionId: string,
    projectId: string,
    error: unknown
  ): Promise<never> {
    await this.recoverIfCurrentActiveIsStale(projectCollectionId, projectId);
    throw error;
  }

  private async recoverIfCurrentActiveIsStale(projectCollectionId: string, projectId: string): Promise<boolean> {
    const active = this.currentActive;
    const collection = this.currentProjectCollection;
    if (
      !active ||
      !collection ||
      active.manifest.id !== projectId ||
      collection.projectCollectionId !== projectCollectionId
    ) {
      return false;
    }
    const [liveProject, liveCollection] = await Promise.all([
      this.store.getProject(projectId),
      this.store.getProjectCollection(projectCollectionId),
    ]);
    if (!liveCollection) {
      await this.recoverFromTombstonedActiveCollection();
      return true;
    }
    if (!liveProject) {
      await this.recoverFromTombstonedActiveProject();
      return true;
    }
    return false;
  }

  private async refreshCurrentProjectCollection(collection: ProjectCollection): Promise<void> {
    if (this.currentProjectCollection?.projectCollectionId === collection.projectCollectionId) {
      this.currentProjectCollection = collection;
    }
  }

  private collectionAccess(collection: ProjectCollection): ProjectCollectionAccessState {
    return collection.pinVerifier && !this.unlockedProjectCollectionIds.has(collection.projectCollectionId)
      ? "locked"
      : "ready";
  }

  private assertProjectCollectionReady(collection: ProjectCollection): void {
    if (this.collectionAccess(collection) === "locked") {
      throw appHostError("PROJECT_COLLECTION_LOCKED", "Project collection is locked");
    }
  }

  private emitProjectCollectionChanged(projectCollectionId: string): void {
    this.projectCollectionBroadcast.post({
      type: "project-collection-changed",
      projectCollectionId,
    });
    this.emitProjectCollectionEvent({
      type: "project-collection-changed",
      projectCollectionId,
    });
  }

  private lockProtectedCollectionsExcept(
    projectCollectionIdToKeep: string,
    previousProjectCollectionId: string | undefined
  ): void {
    for (const projectCollectionId of Array.from(this.unlockedProjectCollectionIds)) {
      if (projectCollectionId !== projectCollectionIdToKeep) {
        this.unlockedProjectCollectionIds.delete(projectCollectionId);
        this.emitProjectCollectionChanged(projectCollectionId);
      }
    }
    if (previousProjectCollectionId && previousProjectCollectionId !== projectCollectionIdToKeep) {
      this.removeReloadUnlockRecord(previousProjectCollectionId);
    }
  }

  private reloadUnlockStorageKey(): string {
    return `${this.store.keyPrefix}:project-collection-reload-unlock`;
  }

  private readReloadUnlockRecord(): ProjectCollectionReloadUnlock | undefined {
    if (typeof sessionStorage === "undefined") {
      return undefined;
    }
    const raw = sessionStorage.getItem(this.reloadUnlockStorageKey());
    if (!raw) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<ProjectCollectionReloadUnlock>;
      if (typeof parsed.projectCollectionId === "string" && typeof parsed.expiresAt === "number") {
        return {
          projectCollectionId: parsed.projectCollectionId,
          expiresAt: parsed.expiresAt,
        };
      }
    } catch {
      sessionStorage.removeItem(this.reloadUnlockStorageKey());
    }
    return undefined;
  }

  private writeReloadUnlockRecord(projectCollectionId: string): void {
    if (typeof sessionStorage === "undefined") {
      return;
    }
    const record: ProjectCollectionReloadUnlock = {
      projectCollectionId,
      expiresAt: Date.now() + RELOAD_UNLOCK_TTL_MS,
    };
    sessionStorage.setItem(this.reloadUnlockStorageKey(), JSON.stringify(record));
  }

  private removeReloadUnlockRecord(projectCollectionId: string): void {
    if (typeof sessionStorage === "undefined") {
      return;
    }
    const record = this.readReloadUnlockRecord();
    if (record?.projectCollectionId === projectCollectionId) {
      sessionStorage.removeItem(this.reloadUnlockStorageKey());
    }
  }

  private async restoreReloadUnlock(
    collection: ProjectCollection,
    session: ProjectCollectionTabSession | undefined
  ): Promise<void> {
    if (!collection.pinVerifier || session?.projectCollectionId !== collection.projectCollectionId) {
      return;
    }
    const record = this.readReloadUnlockRecord();
    if (record?.projectCollectionId === collection.projectCollectionId && record.expiresAt > Date.now()) {
      this.unlockedProjectCollectionIds.add(collection.projectCollectionId);
      this.updateReloadUnlockRefreshTimer();
      return;
    }
    this.removeReloadUnlockRecord(collection.projectCollectionId);
  }

  private writeReloadUnlockForCurrentSession(projectCollectionId: string): void {
    const session = this.store.getProjectSession();
    if (session?.projectCollectionId === projectCollectionId) {
      this.writeReloadUnlockRecord(projectCollectionId);
    }
  }

  private updateReloadUnlockRefreshTimer(): void {
    const collection = this.currentProjectCollection;
    if (
      collection?.pinVerifier &&
      this.unlockedProjectCollectionIds.has(collection.projectCollectionId) &&
      this.store.getProjectSession()?.projectCollectionId === collection.projectCollectionId
    ) {
      this.startReloadUnlockRefreshTimer(collection.projectCollectionId);
      return;
    }
    this.stopReloadUnlockRefreshTimer();
  }

  private startReloadUnlockRefreshTimer(projectCollectionId: string): void {
    if (this.reloadUnlockRefreshProjectCollectionId === projectCollectionId && this.reloadUnlockRefreshTimerId) {
      return;
    }
    this.stopReloadUnlockRefreshTimer();
    this.reloadUnlockRefreshProjectCollectionId = projectCollectionId;
    this.reloadUnlockRefreshTimerId = setInterval(() => {
      void this.refreshReloadUnlockRecord(projectCollectionId).catch((error: unknown) => {
        logger.error("[app-host] project collection reload unlock refresh failed", error);
      });
    }, RELOAD_UNLOCK_REFRESH_INTERVAL_MS);
  }

  private stopReloadUnlockRefreshTimer(): void {
    if (this.reloadUnlockRefreshTimerId !== undefined) {
      clearInterval(this.reloadUnlockRefreshTimerId);
      this.reloadUnlockRefreshTimerId = undefined;
    }
    this.reloadUnlockRefreshProjectCollectionId = undefined;
  }

  private async refreshReloadUnlockRecord(projectCollectionId: string): Promise<void> {
    const collection = await this.store.getProjectCollection(projectCollectionId);
    if (collection?.pinVerifier && this.currentProjectCollection?.projectCollectionId === projectCollectionId) {
      this.writeReloadUnlockRecord(projectCollectionId);
      return;
    }
    this.unlockedProjectCollectionIds.delete(projectCollectionId);
    this.removeReloadUnlockRecord(projectCollectionId);
    this.updateReloadUnlockRefreshTimer();
    if (!collection && this.currentProjectCollection?.projectCollectionId === projectCollectionId) {
      await this.recoverFromTombstonedActiveCollection();
      return;
    }
    await this.notifyProjectCollectionState();
  }
}

function projectSessionsEqual(
  left: ProjectCollectionTabSession | undefined,
  right: ProjectCollectionTabSession | undefined
): boolean {
  return left?.projectCollectionId === right?.projectCollectionId && left?.activeProjectId === right?.activeProjectId;
}

function projectCollectionPinVerifiersMatch(
  left: ProjectCollectionPinVerifier,
  right: ProjectCollectionPinVerifier
): boolean {
  return left.scheme === right.scheme && left.salt === right.salt && left.hash === right.hash;
}
