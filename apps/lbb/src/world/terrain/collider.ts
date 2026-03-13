import type RAPIER from "@dimforge/rapier3d-compat";
import type { MeshData } from "./types";

export function createTrimeshCollider(
  world: RAPIER.World,
  rapier: typeof RAPIER,
  mesh: MeshData
): RAPIER.Collider | null {
  if (mesh.vertexCount === 0 || mesh.indexCount === 0) return null;

  const desc = rapier.ColliderDesc.trimesh(mesh.positions, new Uint32Array(mesh.indices));
  if (!desc) return null;

  return world.createCollider(desc);
}

export function replaceTrimeshCollider(
  world: RAPIER.World,
  rapier: typeof RAPIER,
  existing: RAPIER.Collider | null,
  mesh: MeshData
): RAPIER.Collider | null {
  if (existing) {
    world.removeCollider(existing, false);
  }
  return createTrimeshCollider(world, rapier, mesh);
}
