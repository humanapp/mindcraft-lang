/** Cross-tab messages for project collection and project changes. */
export type ProjectCollectionBroadcastMessage =
  | { type: "project-collection-changed"; projectCollectionId: string }
  | { type: "project-collection-tombstoned"; projectCollectionId: string }
  | { type: "project-tombstoned"; projectCollectionId: string; projectId: string };

/** Broadcast channel used by project managers in one app namespace. */
export interface ProjectCollectionBroadcast {
  /** Send a project collection message to other tabs in the same app namespace. */
  post(message: ProjectCollectionBroadcastMessage): void;
  /** Subscribe to project collection messages. Returns an unsubscribe function. */
  subscribe(listener: (message: ProjectCollectionBroadcastMessage) => void): () => void;
  /** Close the underlying channel and remove local listeners. */
  close(): void;
}

/** Return the BroadcastChannel name for one app namespace. */
export function projectCollectionBroadcastChannelName(keyPrefix: string): string {
  return `${keyPrefix}:project-collections`;
}

/** Create a project collection broadcast channel for one app namespace. */
export function createProjectCollectionBroadcast(keyPrefix: string): ProjectCollectionBroadcast {
  if (typeof BroadcastChannel === "undefined") {
    return createNoopBroadcast();
  }
  return new BrowserProjectCollectionBroadcast(projectCollectionBroadcastChannelName(keyPrefix));
}

function createNoopBroadcast(): ProjectCollectionBroadcast {
  return {
    post() {},
    subscribe() {
      return () => {};
    },
    close() {},
  };
}

function isProjectCollectionBroadcastMessage(value: unknown): value is ProjectCollectionBroadcastMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Partial<ProjectCollectionBroadcastMessage>;
  if (message.type === "project-collection-changed") {
    return typeof message.projectCollectionId === "string";
  }
  if (message.type === "project-collection-tombstoned") {
    return typeof message.projectCollectionId === "string";
  }
  if (message.type === "project-tombstoned") {
    return typeof message.projectCollectionId === "string" && typeof message.projectId === "string";
  }
  return false;
}

class BrowserProjectCollectionBroadcast implements ProjectCollectionBroadcast {
  private readonly channel: BroadcastChannel;
  private readonly listeners = new Map<
    (message: ProjectCollectionBroadcastMessage) => void,
    (event: MessageEvent<unknown>) => void
  >();

  constructor(channelName: string) {
    this.channel = new BroadcastChannel(channelName);
    (this.channel as BroadcastChannel & { unref?: () => void }).unref?.();
  }

  post(message: ProjectCollectionBroadcastMessage): void {
    this.channel.postMessage(message);
  }

  subscribe(listener: (message: ProjectCollectionBroadcastMessage) => void): () => void {
    const handler = (event: MessageEvent<unknown>) => {
      if (isProjectCollectionBroadcastMessage(event.data)) {
        listener(event.data);
      }
    };
    this.listeners.set(listener, handler);
    this.channel.addEventListener("message", handler);
    return () => {
      const stored = this.listeners.get(listener);
      if (!stored) {
        return;
      }
      this.channel.removeEventListener("message", stored);
      this.listeners.delete(listener);
    };
  }

  close(): void {
    for (const handler of this.listeners.values()) {
      this.channel.removeEventListener("message", handler);
    }
    this.listeners.clear();
    this.channel.close();
  }
}
