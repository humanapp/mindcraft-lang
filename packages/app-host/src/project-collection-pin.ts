import { appHostError } from "./app-host-error.js";
import type { ProjectCollectionPinVerifier } from "./project-collection.js";

/** PBKDF2 iteration count for v1 project collection PIN verifiers. */
export const PIN_PBKDF2_ITERATIONS = 150_000;

/** Salt byte length for v1 project collection PIN verifiers. */
export const PIN_SALT_BYTES = 16;

/** Hash byte length for v1 project collection PIN verifiers. */
export const PIN_HASH_BYTES = 32;

/** Minimum accepted PIN length after trimming. */
export const PROJECT_COLLECTION_PIN_MIN_LENGTH = 4;

/** Maximum accepted PIN length after trimming. */
export const PROJECT_COLLECTION_PIN_MAX_LENGTH = 128;

/**
 * Trim and validate a project collection PIN.
 *
 * @param pin - User-entered PIN or phrase.
 * @returns The trimmed PIN that should be verified or hashed.
 * @throws AppHostError when the PIN does not satisfy W6a validation rules.
 */
export function normalizeProjectCollectionPin(pin: string): string {
  const trimmed = pin.trim();
  if (
    trimmed.length < PROJECT_COLLECTION_PIN_MIN_LENGTH ||
    trimmed.length > PROJECT_COLLECTION_PIN_MAX_LENGTH ||
    containsControlCharacter(trimmed)
  ) {
    throw appHostError(
      "INVALID_PROJECT_COLLECTION_PIN",
      `Workspace PIN must be ${PROJECT_COLLECTION_PIN_MIN_LENGTH} to ${PROJECT_COLLECTION_PIN_MAX_LENGTH} printable characters`
    );
  }
  return trimmed;
}

/**
 * Build a v1 verifier for a project collection PIN.
 *
 * @param pin - User-entered PIN or phrase.
 * @param now - Unix epoch timestamp in milliseconds for verifier creation.
 */
export async function createProjectCollectionPinVerifier(
  pin: string,
  now = Date.now()
): Promise<ProjectCollectionPinVerifier> {
  const normalized = normalizeProjectCollectionPin(pin);
  const salt = new Uint8Array(PIN_SALT_BYTES);
  getPinCrypto().getRandomValues(salt);
  const hash = await derivePinHash(normalized, salt);
  return {
    scheme: "v1",
    salt: bytesToBase64(salt),
    hash: bytesToBase64(hash),
    createdAt: now,
  };
}

/**
 * Verify a PIN against a stored project collection verifier.
 *
 * @param pin - User-entered PIN or phrase.
 * @param verifier - Stored verifier from the project collection record.
 * @returns `true` when the PIN matches the verifier.
 */
export async function verifyProjectCollectionPin(
  pin: string,
  verifier: ProjectCollectionPinVerifier
): Promise<boolean> {
  const normalized = normalizeProjectCollectionPin(pin);
  if (verifier.scheme !== "v1") {
    throw appHostError("PROJECT_COLLECTION_PIN_INVALID", "Unsupported workspace PIN verifier scheme");
  }
  const salt = base64ToBytes(verifier.salt);
  const expected = base64ToBytes(verifier.hash);
  if (salt.length !== PIN_SALT_BYTES || expected.length !== PIN_HASH_BYTES) {
    throw appHostError("PROJECT_COLLECTION_PIN_INVALID", "Invalid workspace PIN verifier");
  }
  const actual = await derivePinHash(normalized, salt);
  return timingSafeBytesEqual(actual, expected);
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function getPinCrypto(): Crypto {
  const candidate = globalThis.crypto;
  if (!candidate?.subtle || typeof candidate.getRandomValues !== "function") {
    throw appHostError(
      "PROJECT_COLLECTION_PIN_CAPABILITY_UNAVAILABLE",
      "WebCrypto PBKDF2 is required for workspace PINs"
    );
  }
  return candidate;
}

async function derivePinHash(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const subtle = getPinCrypto().subtle;
  const keyMaterial = new TextEncoder().encode(pin);
  const key = await subtle.importKey("raw", keyMaterial, "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations: PIN_PBKDF2_ITERATIONS,
    },
    key,
    PIN_HASH_BYTES * 8
  );
  return new Uint8Array(bits);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw appHostError("PROJECT_COLLECTION_PIN_INVALID", "Invalid workspace PIN verifier");
  }
}

function timingSafeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}
