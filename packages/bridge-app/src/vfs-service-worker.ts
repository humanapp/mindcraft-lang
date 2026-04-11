interface VfsSwScope {
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(): Promise<VfsSwClient[]> };
  addEventListener(type: string, listener: (event: VfsSwEvent) => void): void;
  caches: { open(name: string): Promise<VfsSwCache> };
  registration: { scope: string };
}

interface VfsSwClient {
  postMessage(message: unknown, transfer: unknown[]): void;
}

interface VfsSwCache {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
}

interface VfsSwEvent {
  waitUntil?(p: Promise<unknown>): void;
  respondWith?(response: Promise<Response> | Response): void;
  request?: { url: string };
  data?: unknown;
  source?: { postMessage(message: unknown): void } | null;
}

const VFS_CACHE = "vfs";
const VFS_PREFIX = "/vfs/";

const MIME_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".md": "text/markdown",
  ".ts": "text/plain",
  ".json": "application/json",
  ".txt": "text/plain",
};

function mimeForPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME_TYPES[path.slice(dot)] ?? "application/octet-stream";
}

function readViaClient(clients: VfsSwClient[], path: string): Promise<{ found: boolean; content?: string }> {
  const client = clients[0];
  if (!client) {
    return Promise.resolve({ found: false });
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { found: boolean; content?: string } | undefined;
      resolve(msg ?? { found: false });
    };
    client.postMessage({ type: "vfs-read", path }, [channel.port2]);
  });
}

const sw: VfsSwScope = self as unknown as VfsSwScope;

sw.addEventListener("install", () => {
  void sw.skipWaiting();
});

sw.addEventListener("activate", (event) => {
  event.waitUntil!(sw.clients.claim());
});

sw.addEventListener("fetch", (event) => {
  const url = new URL(event.request!.url);
  if (!url.pathname.startsWith(VFS_PREFIX)) {
    return;
  }

  const vfsPath = decodeURIComponent(url.pathname.slice(VFS_PREFIX.length));

  event.respondWith!(
    (async () => {
      const cache = await sw.caches.open(VFS_CACHE);

      const cached = await cache.match(event.request!.url);
      if (cached) return cached;

      const clients = await sw.clients.matchAll();
      const result = await readViaClient(clients, vfsPath);

      if (!result.found || result.content === undefined) {
        return new Response("Not found", { status: 404, statusText: "Not Found" });
      }

      const response = new Response(result.content, {
        status: 200,
        headers: { "Content-Type": mimeForPath(vfsPath) },
      });

      await cache.put(event.request!.url, response.clone());
      return response;
    })()
  );
});

sw.addEventListener("message", (event) => {
  const data = event.data as Record<string, unknown> | undefined;
  event.source?.postMessage({ type: "vfs-ack", received: data?.type });
});

export {};
