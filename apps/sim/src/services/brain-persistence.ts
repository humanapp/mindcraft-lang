import { BrainDef, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { Archetype } from "@/brain/actor";

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
 * Deserialize a BrainDef from an ArrayBuffer (the raw bytes of a .brain JSON file).
 * Returns undefined if deserialization fails.
 */
export function deserializeBrainFromArrayBuffer(env: MindcraftEnvironment, buffer: ArrayBuffer): BrainDef | undefined {
  try {
    const text = new TextDecoder().decode(new Uint8Array(buffer));
    const brainDef = normalizeBrainDef(env.deserializeBrainJsonFromPlain(JSON.parse(text) as unknown));
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
 * Serializes the brain to JSON format and stores as a string.
 */
export function saveBrainToLocalStorage(archetype: Archetype, brainDef: BrainDef): void {
  try {
    const json = brainDef.toJson();
    const text = JSON.stringify(json);

    const key = `${STORAGE_KEY_PREFIX}${archetype}`;
    localStorage.setItem(key, text);

    console.log(`Brain saved to localStorage for archetype: ${archetype}`);
  } catch (err) {
    console.error(`Failed to save brain to localStorage for ${archetype}:`, err);
  }
}

/**
 * Load a brain definition from localStorage for a specific archetype.
 * Returns undefined if no saved brain exists or if deserialization fails.
 */
export function loadBrainFromLocalStorage(env: MindcraftEnvironment, archetype: Archetype): BrainDef | undefined {
  try {
    const key = `${STORAGE_KEY_PREFIX}${archetype}`;
    const stored = localStorage.getItem(key);

    if (!stored) {
      return undefined;
    }

    const brainDef = normalizeBrainDef(env.deserializeBrainJsonFromPlain(JSON.parse(stored) as unknown));

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
