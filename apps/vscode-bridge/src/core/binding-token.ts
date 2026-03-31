import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { logger } from "#core/logging/logger.js";

let secret: string | undefined;

export function initBindingSecret(): void {
  const envSecret = process.env.BRIDGE_BINDING_SECRET;
  if (envSecret) {
    secret = envSecret;
  } else {
    secret = randomUUID();
    logger.warn("BRIDGE_BINDING_SECRET not set; binding tokens will not survive bridge restart");
  }
}

export function generateBindingId(): string {
  return randomUUID();
}

export function createBindingToken(bindingId: string): string {
  if (!secret) throw new Error("binding secret not initialized");
  const sig = createHmac("sha256", secret).update(bindingId).digest("hex");
  return `${bindingId}.${sig}`;
}

export function verifyBindingToken(token: string): string | undefined {
  if (!secret) return undefined;
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return undefined;
  const bindingId = token.substring(0, dotIndex);
  const sig = token.substring(dotIndex + 1);
  const expected = createHmac("sha256", secret).update(bindingId).digest("hex");
  try {
    const sigBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expectedBuf.length) return undefined;
    return timingSafeEqual(sigBuf, expectedBuf) ? bindingId : undefined;
  } catch {
    return undefined;
  }
}
