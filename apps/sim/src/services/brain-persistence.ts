import { BrainDef, brainJsonFromPlain } from "@mindcraft-lang/core/app";
import type { Archetype } from "@/brain/actor";
import { getMindcraftEnvironment } from "./mindcraft-environment";

const STORAGE_KEY_PREFIX = "brain-archetype-";

// -- Default brain cache (populated from .brain asset files during Preloader) --

const defaultBrainCache = new Map<Archetype, BrainDef>();

function normalizeBrainDef(brainDef: unknown): BrainDef {
  if (!(brainDef instanceof BrainDef)) {
    throw new Error("Expected BrainDef from mindcraft environment");
  }

  if (brainDef.pages().size() === 0) {
    brainDef.appendNewPage();
  }

  return brainDef;
}

/**
 * Deserialize a BrainDef from an ArrayBuffer (the raw bytes of a .brain file).
 * Returns undefined if deserialization fails.
 */
export function deserializeBrainFromArrayBuffer(buffer: ArrayBuffer): BrainDef | undefined {
  try {
    const uint8Array = new Uint8Array(buffer);
    let brainDef: BrainDef;
    const environment = getMindcraftEnvironment();

    // Detect format by checking if file starts with '{' (0x7B = JSON)
    if (uint8Array[0] === 0x7b) {
      const text = new TextDecoder().decode(uint8Array);
      brainDef = normalizeBrainDef(environment.deserializeBrainJson(brainJsonFromPlain(JSON.parse(text) as unknown)));
    } else {
      brainDef = normalizeBrainDef(environment.deserializeBrainFromBytes(uint8Array));
    }

    return brainDef;
  } catch (err) {
    console.error("Failed to deserialize brain from ArrayBuffer:", err);
    return undefined;
  }
}

/**
 * Store a pre-loaded default brain for an archetype.
 * Called during asset loading (Preloader scene) so the Engine can
 * synchronously fall back to these when localStorage has no entry.
 */
export function setDefaultBrain(archetype: Archetype, brainDef: BrainDef): void {
  defaultBrainCache.set(archetype, brainDef);
}

/**
 * Retrieve the pre-loaded default brain for an archetype, or undefined
 * if no default was loaded.
 */
export function getDefaultBrain(archetype: Archetype): BrainDef | undefined {
  return defaultBrainCache.get(archetype);
}

/**
 * Save a brain definition to localStorage for a specific archetype.
 * Serializes the brain to binary format and stores as base64.
 */
export function saveBrainToLocalStorage(archetype: Archetype, brainDef: BrainDef): void {
  try {
    const bytes = getMindcraftEnvironment().serializeBrainToBytes(brainDef) as Uint8Array;
    const base64 = uint8ArrayToBase64(bytes);

    const key = `${STORAGE_KEY_PREFIX}${archetype}`;
    localStorage.setItem(key, base64);

    console.log(`Brain saved to localStorage for archetype: ${archetype}`);
  } catch (err) {
    console.error(`Failed to save brain to localStorage for ${archetype}:`, err);
  }
}

/**
 * Load a brain definition from localStorage for a specific archetype.
 * Returns undefined if no saved brain exists or if deserialization fails.
 */
export function loadBrainFromLocalStorage(archetype: Archetype): BrainDef | undefined {
  try {
    const key = `${STORAGE_KEY_PREFIX}${archetype}`;
    const base64 = localStorage.getItem(key);

    if (!base64) {
      return undefined;
    }

    const bytes = base64ToUint8Array(base64);
    const brainDef = normalizeBrainDef(getMindcraftEnvironment().deserializeBrainFromBytes(bytes));

    console.log(`Brain loaded from localStorage for archetype: ${archetype}`);
    return brainDef;
  } catch (err) {
    console.error(`Failed to load brain from localStorage for ${archetype}:`, err);
    return undefined;
  }
}

/**
 * Clear saved brain for a specific archetype.
 */
export function clearBrainFromLocalStorage(archetype: Archetype): void {
  const key = `${STORAGE_KEY_PREFIX}${archetype}`;
  localStorage.removeItem(key);
  console.log(`Brain cleared from localStorage for archetype: ${archetype}`);
}

/**
 * Clear all saved brains from localStorage.
 */
export function clearAllBrainsFromLocalStorage(): void {
  const keys = Object.keys(localStorage);
  keys.forEach((key) => {
    if (key.startsWith(STORAGE_KEY_PREFIX)) {
      localStorage.removeItem(key);
    }
  });
  console.log("All brains cleared from localStorage");
}

// Helper functions for base64 conversion
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
