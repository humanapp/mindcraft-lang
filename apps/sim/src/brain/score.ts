import type { Archetype } from "./actor";

/** Per-archetype statistics. */
export interface ArchetypeStats {
  /** Number of deaths recorded since the tracker was created/reset. */
  deaths: number;
  /** Sum of all completed lifespans in seconds (used for average). */
  totalLifespan: number;
  /** Longest single life in seconds. */
  longestLife: number;
  /** Running total of seconds survived across all actors (living + dead). */
  totalSurvivalTime: number;
  /** Current number of alive actors. */
  aliveCount: number;
  /** Sum of current energy across alive actors (for average energy calc). */
  totalEnergy: number;
}

/** Snapshot of the full scoreboard, emitted to the UI each update. */
export interface ScoreSnapshot {
  carnivore: ArchetypeStats;
  herbivore: ArchetypeStats;
  plant: ArchetypeStats;
  /** Composite ecosystem score -- rewards all species thriving together. */
  ecosystemScore: number;
  /** Wall-clock seconds since the tracker started (for display). */
  elapsed: number;
}

const ARCHETYPE_KEYS: readonly Archetype[] = ["carnivore", "herbivore", "plant"];

function emptyStats(): ArchetypeStats {
  return {
    deaths: 0,
    totalLifespan: 0,
    longestLife: 0,
    totalSurvivalTime: 0,
    aliveCount: 0,
    totalEnergy: 0,
  };
}

/**
 * Tracks simulation statistics and computes a composite ecosystem score.
 *
 * The engine calls:
 * - `recordDeath(archetype, lifespanMs)` when an actor dies
 * - `update(aliveCountsByArchetype, energySumsByArchetype, elapsedMs)` each tick
 *
 * After `update()`, call `getSnapshot()` to read the latest scoreboard data.
 */
export class ScoreTracker {
  private stats: Record<Archetype, ArchetypeStats> = {
    carnivore: emptyStats(),
    herbivore: emptyStats(),
    plant: emptyStats(),
  };

  /** Simulation elapsed time in seconds, updated each tick. */
  private elapsed = 0;

  /** Record the death of an actor, given its lifespan in milliseconds. */
  recordDeath(archetype: Archetype, lifespanMs: number): void {
    const s = this.stats[archetype];
    const lifespanSec = lifespanMs / 1000;
    s.deaths++;
    s.totalLifespan += lifespanSec;
    if (lifespanSec > s.longestLife) {
      s.longestLife = lifespanSec;
    }
  }

  /**
   * Called once per tick to refresh live population data.
   *
   * @param aliveCounts  Number of alive actors per archetype
   * @param energySums   Sum of energy values of alive actors per archetype
   * @param elapsedMs    Total simulation time elapsed in milliseconds
   * @param dtMs         Delta time for this tick in milliseconds
   */
  update(
    aliveCounts: Record<Archetype, number>,
    energySums: Record<Archetype, number>,
    elapsedMs: number,
    dtMs: number
  ): void {
    this.elapsed = elapsedMs / 1000;
    const dtSec = dtMs / 1000;
    for (const arch of ARCHETYPE_KEYS) {
      const s = this.stats[arch];
      s.aliveCount = aliveCounts[arch];
      s.totalEnergy = energySums[arch];
      // Accumulate survival time: each alive actor contributes dtSec per tick
      s.totalSurvivalTime += aliveCounts[arch] * dtSec;
    }
  }

  /** Build a read-only snapshot of the current scores. */
  getSnapshot(): ScoreSnapshot {
    const c = this.stats.carnivore;
    const h = this.stats.herbivore;
    const p = this.stats.plant;

    // Average lifespan helper: uses recorded deaths if available,
    // otherwise estimates from current survival time.
    const avgLifespan = (s: ArchetypeStats): number => {
      if (s.deaths > 0) return s.totalLifespan / s.deaths;
      // No deaths yet -- use total survival time / alive count as estimate
      if (s.aliveCount > 0) return s.totalSurvivalTime / s.aliveCount;
      return 0;
    };

    const avgC = avgLifespan(c);
    const avgH = avgLifespan(h);

    // Geometric mean of animal archetypes only (plants excluded -- their
    // passive regen gives them very different lifespans that skew the score).
    // Adding 1 before the root avoids zero-product collapse when one species
    // has 0 average lifespan; the -1 at the end removes the offset.
    const ecosystemScore = Math.round(((avgC + 1) * (avgH + 1)) ** (1 / 2) - 1);

    return {
      carnivore: { ...c },
      herbivore: { ...h },
      plant: { ...p },
      ecosystemScore,
      elapsed: this.elapsed,
    };
  }

  /** Reset all stats (e.g. on sim restart). */
  reset(): void {
    for (const arch of ARCHETYPE_KEYS) {
      this.stats[arch] = emptyStats();
    }
    this.elapsed = 0;
  }
}
