interface VfsSwScope {
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(): Promise<VfsSwClient[]> };
  addEventListener(type: string, listener: (event: VfsSwEvent) => void): void;
}

interface VfsSwClient {
  postMessage(message: unknown, transfer: unknown[]): void;
}

interface VfsSwEvent {
  waitUntil?(p: Promise<unknown>): void;
  respondWith?(response: Promise<Response> | Response): void;
  request?: { url: string };
  data?: unknown;
}

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
  if (clients.length === 0) {
    return Promise.resolve({ found: false });
  }

  return new Promise((resolve) => {
    let settled = false;
    let remaining = clients.length;

    const settle = (result: { found: boolean; content?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    setTimeout(() => settle({ found: false }), 2000);

    for (const client of clients) {
      const channel = new MessageChannel();
      channel.port1.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { found: boolean; content?: string } | undefined;
        if (msg?.found) {
          settle(msg);
        } else {
          remaining--;
          if (remaining <= 0) {
            settle({ found: false });
          }
        }
      };
      client.postMessage({ type: "vfs-read", path }, [channel.port2]);
    }
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
      const clients = await sw.clients.matchAll();
      const result = await readViaClient(clients, vfsPath);

      if (!result.found || result.content === undefined) {
        return new Response("Not found", { status: 404, statusText: "Not Found" });
      }

      return new Response(result.content, {
        status: 200,
        headers: { "Content-Type": mimeForPath(vfsPath), "Cache-Control": "no-store" },
      });
    })()
  );
});

sw.addEventListener("message", (event) => {
  const data = event.data as Record<string, unknown> | undefined;
  if (data?.type === "claim") {
    event.waitUntil!(sw.clients.claim());
  }
});

export {};
