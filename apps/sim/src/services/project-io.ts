import { buildActiveProjectExportDocument, type ProjectManager } from "@mindcraft-lang/app-host";
import type { Archetype } from "@/brain/actor";
import { ARCHETYPES } from "@/brain/archetypes";
import type { Obstacle } from "@/brain/vision";
import { name as simName } from "../../package.json";

/** One actor roster entry of the sim's payload in a shared `.mindcraft` document. */
export interface SimTargetActor {
  /** Archetype name of the roster entry. */
  archetype: string;
  /** Brain key flashed onto the archetype, or `null` when it has no brain. */
  brain: string | null;
  /** Number of live instances the scene keeps for the archetype. */
  desiredCount: number;
}

/** The sim's payload inside the shared document's `targets` map: actor roster and obstacles. */
export interface SimTarget {
  actors: SimTargetActor[];
  obstacles?: Obstacle[];
}

/**
 * Builds a shared `.mindcraft` document string for the active project: the
 * common export document plus the sim's payload under the sim's own `targets`
 * key. Unknown `targets` entries are preserved.
 *
 * @param projectManager - Manager holding the active project to export.
 * @param desiredCounts - Live instance count per archetype for the roster.
 * @param obstacles - Scene obstacles; omitted from the payload when empty.
 */
export async function buildSimExportDocument(
  projectManager: ProjectManager,
  desiredCounts: Partial<Record<Archetype, number>>,
  obstacles: readonly Obstacle[] | undefined
): Promise<string> {
  const doc = await buildActiveProjectExportDocument(projectManager);

  const actors: SimTargetActor[] = [];
  for (const archetype of Object.keys(ARCHETYPES)) {
    const hasBrain = archetype in (doc.brains as Record<string, unknown>);
    actors.push({
      archetype,
      brain: hasBrain ? archetype : null,
      desiredCount: desiredCounts[archetype as Archetype] ?? 0,
    });
  }

  const app: SimTarget = { actors };
  if (obstacles && obstacles.length > 0) {
    app.obstacles = obstacles.map((obstacle) => ({
      x: obstacle.x,
      y: obstacle.y,
      width: obstacle.width,
      height: obstacle.height,
      ...(obstacle.rotation !== undefined ? { rotation: obstacle.rotation } : {}),
    }));
  }

  return JSON.stringify({ ...doc, targets: { ...doc.targets, [simName]: app } }, null, 2);
}
