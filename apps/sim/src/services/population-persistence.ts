import type { Archetype } from "@/brain/actor";
import { ARCHETYPES } from "@/brain/archetypes";

const STORAGE_KEY = "population-desired-counts";

type DesiredCounts = Record<Archetype, number>;

function defaults(): DesiredCounts {
  return {
    carnivore: ARCHETYPES.carnivore.initialSpawnCount,
    herbivore: ARCHETYPES.herbivore.initialSpawnCount,
    plant: ARCHETYPES.plant.initialSpawnCount,
  };
}

/** Load persisted population counts, falling back to archetype defaults. */
export function loadDesiredCounts(): DesiredCounts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DesiredCounts>;
      const base = defaults();
      for (const key of Object.keys(base) as Archetype[]) {
        if (typeof parsed[key] === "number") {
          base[key] = parsed[key];
        }
      }
      return base;
    }
  } catch {
    // Corrupted data -- fall through to defaults.
  }
  return defaults();
}

/** Persist the current desired population counts. */
export function saveDesiredCounts(counts: DesiredCounts): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
  } catch {
    // Storage full or unavailable -- silently ignore.
  }
}
