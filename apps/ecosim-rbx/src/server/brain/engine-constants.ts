/**
 * Number of vision phases. Actors are assigned phase = actorId % VISION_PHASES.
 * Only actors whose phase matches the current tick run a vision query.
 * Higher = more amortization but staler sight data.
 * 3 phases at 60fps = each actor refreshes vision every ~50ms.
 */
export const VISION_PHASES = 3;

/** Max actors to spawn per archetype per tick to avoid frame spikes. */
export const MAX_SPAWNS_PER_TICK = 3;
