import type { IncomingMessage } from "node:http";
import type { Context } from "hono";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const STALE_BUCKET_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(n = 1): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

export class TokenBucketMap {
  private readonly buckets = new Map<string, Bucket>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  consume(key: string, n = 1): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsed = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillRate);
      bucket.lastRefill = now;
    }
    if (bucket.tokens < n) return false;
    bucket.tokens -= n;
    return true;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > STALE_BUCKET_MS) {
        this.buckets.delete(key);
      }
    }
  }

  dispose(): void {
    clearInterval(this.sweepTimer);
    this.buckets.clear();
  }
}

export function getClientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp;
  const incoming = (c.env as Record<string, unknown>).incoming as IncomingMessage | undefined;
  return incoming?.socket?.remoteAddress ?? "unknown";
}
