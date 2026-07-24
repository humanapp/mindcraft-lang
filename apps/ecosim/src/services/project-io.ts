import { buildActiveProjectExportDocument, type ProjectManager } from "@mindcraft-lang/app-host";
import type { Archetype } from "@/brain/actor";
import { ARCHETYPES } from "@/brain/archetypes";
import type { Obstacle } from "@/brain/vision";
import { name as simName } from "../../package.json";

/** One actor roster entry of the sim's session chunk in a shared `.mindcraft` document. */
export interface EcosimAppChunkActor {
  /** Archetype name of the roster entry. */
  archetype: string;
  /** Brain key flashed onto the archetype, or `null` when it has no brain. */
  brain: string | null;
  /** Number of live instances the scene keeps for the archetype. */
  desiredCount: number;
}

/** The sim's session chunk inside a document manifest's `app` map: actor roster and obstacles. */
export interface EcosimAppChunk {
  actors: EcosimAppChunkActor[];
  obstacles?: Obstacle[];
}

/**
 * Builds a shared `.mindcraft` document string for the active project: the
 * common export document with the sim's session chunk embedded in the
 * manifest's `app` map under the sim's own key. Chunks stored for other apps
 * are preserved.
 *
 * @param projectManager - Manager holding the active project to export.
 * @param desiredCounts - Live instance count per archetype for the roster.
 * @param obstacles - Scene obstacles; omitted from the chunk when empty.
 */
export async function buildEcosimExportDocument(
  projectManager: ProjectManager,
  desiredCounts: Partial<Record<Archetype, number>>,
  obstacles: readonly Obstacle[] | undefined
): Promise<string> {
  // Sim brains are stored under their archetype key; the roster reads the same keys.
  let brains: Record<string, unknown> = {};
  try {
    const raw = await projectManager.loadAppData("brains");
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        brains = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // corrupted brain data -- export an empty roster mapping
  }

  const actors: EcosimAppChunkActor[] = [];
  for (const archetype of Object.keys(ARCHETYPES)) {
    const hasBrain = archetype in brains;
    actors.push({
      archetype,
      brain: hasBrain ? archetype : null,
      desiredCount: desiredCounts[archetype as Archetype] ?? 0,
    });
  }

  const app: EcosimAppChunk = { actors };
  if (obstacles && obstacles.length > 0) {
    app.obstacles = obstacles.map((obstacle) => ({
      x: obstacle.x,
      y: obstacle.y,
      width: obstacle.width,
      height: obstacle.height,
      ...(obstacle.rotation !== undefined ? { rotation: obstacle.rotation } : {}),
    }));
  }

  const doc = await buildActiveProjectExportDocument(projectManager, {
    appChunk: { name: simName, chunk: app },
  });
  return JSON.stringify(doc, null, 2);
}
