import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { computeBrushPatches } from "../../src/world/terrain/edit";
import { CHUNK_SIZE, chunkId, localVoxelToSampleIndex } from "../../src/world/voxel/types";
import { slopedHill } from "./fixtures";
import { makeChunkGrid } from "./helpers";

function makeBoundaryGrid() {
  return makeChunkGrid(
    [
      { cx: 0, cy: 0, cz: 0 },
      { cx: 1, cy: 0, cz: 0 },
      { cx: 0, cy: 1, cz: 0 },
      { cx: 1, cy: 1, cz: 0 },
      { cx: 0, cy: 0, cz: 1 },
      { cx: 1, cy: 0, cz: 1 },
      { cx: 0, cy: 1, cz: 1 },
      { cx: 1, cy: 1, cz: 1 },
    ],
    slopedHill(16, 0.5, 0.3)
  );
}

describe("smooth/roughen after prior edit without halo re-sync", () => {
  test("smooth near X boundary reads correct neighbor data after prior edit", () => {
    const chunks = makeBoundaryGrid();
    const chunkA = chunks.get(chunkId({ cx: 0, cy: 0, cz: 0 }))!;
    const chunkB = chunks.get(chunkId({ cx: 1, cy: 0, cz: 0 }))!;

    const boundary = CHUNK_SIZE;
    const brushY = 16;
    const brushZ = 16;

    const raiseBrush = { radius: 3, strength: 10, shape: "sphere" as const, falloff: 1 };
    const raisePatches = computeBrushPatches([boundary - 2, brushY, brushZ], raiseBrush, "raise", chunks, 1.0);

    for (const p of raisePatches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.fieldIndex] = p.after;
    }

    const smoothBrush = { radius: 4, strength: 5, shape: "sphere" as const, falloff: 1 };
    const smoothPatches = computeBrushPatches([boundary + 1, brushY, brushZ], smoothBrush, "smooth", chunks, 1.0);

    const boundaryPatches = smoothPatches.filter((p) => {
      if (p.chunkId !== chunkId({ cx: 1, cy: 0, cz: 0 })) return false;
      const lx = 0;
      const fieldIdx = localVoxelToSampleIndex(lx, 0, 0);
      const stride = localVoxelToSampleIndex(1, 0, 0) - fieldIdx;
      return (
        (p.fieldIndex - fieldIdx) % stride === 0 &&
        p.fieldIndex >= localVoxelToSampleIndex(0, 0, 0) &&
        p.fieldIndex < localVoxelToSampleIndex(1, 0, 0)
      );
    });

    for (const p of boundaryPatches) {
      const xMinusOne = chunkA.field[localVoxelToSampleIndex(CHUNK_SIZE, 0, 0)];
      assert.ok(Number.isFinite(p.after), `smooth patch at boundary should be finite: ${p.after}`);
      assert.notEqual(p.after, p.before, "smooth near modified boundary should change density");
    }

    assert.ok(smoothPatches.length > 0, "smooth should produce patches");
  });

  test("smooth patches agree across X boundary after prior edit", () => {
    const chunks = makeBoundaryGrid();
    const boundary = CHUNK_SIZE;
    const brushY = 16;
    const brushZ = 16;

    const raiseBrush = { radius: 3, strength: 10, shape: "sphere" as const, falloff: 1 };
    const raisePatches = computeBrushPatches([boundary - 1, brushY, brushZ], raiseBrush, "raise", chunks, 1.0);

    for (const p of raisePatches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.fieldIndex] = p.after;
    }

    const smoothBrush = { radius: 5, strength: 5, shape: "sphere" as const, falloff: 1 };
    const smoothPatches = computeBrushPatches([boundary, brushY, brushZ], smoothBrush, "smooth", chunks, 1.0);

    const patchByWorld = new Map<string, number>();
    for (const p of smoothPatches) {
      const coord = p.chunkId.split(",").map(Number);
      const ox = coord[0] * CHUNK_SIZE;
      const oy = coord[1] * CHUNK_SIZE;
      const oz = coord[2] * CHUNK_SIZE;
      patchByWorld.set(`${p.chunkId}:${p.fieldIndex}`, p.after);
    }

    const chunkAId = chunkId({ cx: 0, cy: 0, cz: 0 });
    const chunkBId = chunkId({ cx: 1, cy: 0, cz: 0 });

    for (let ly = Math.max(0, brushY - 5); ly <= Math.min(CHUNK_SIZE, brushY + 5); ly++) {
      for (let lz = Math.max(0, brushZ - 5); lz <= Math.min(CHUNK_SIZE, brushZ + 5); lz++) {
        const idxA = localVoxelToSampleIndex(CHUNK_SIZE, ly, lz);
        const idxB = localVoxelToSampleIndex(0, ly, lz);

        const patchA = smoothPatches.find((p) => p.chunkId === chunkAId && p.fieldIndex === idxA);
        const patchB = smoothPatches.find((p) => p.chunkId === chunkBId && p.fieldIndex === idxB);

        if (!patchA || !patchB) continue;

        const valA = patchA.after;
        const valB = patchB.after;

        const chunkAField = chunks.get(chunkAId)!.field;
        const chunkBField = chunks.get(chunkBId)!.field;
        const coreA = chunkAField[idxA];
        const coreB = chunkBField[idxB];
        assert.ok(
          Math.abs(coreA - coreB) < 1e-6,
          `Core overlap at lx=CHUNK_SIZE (A) vs lx=0 (B), ly=${ly}, lz=${lz} ` + `should agree: A=${coreA} B=${coreB}`
        );

        assert.ok(
          Math.abs(valA - valB) < 1e-4,
          `Smooth result for shared voxel at ly=${ly}, lz=${lz} should agree: ` +
            `A=${valA} B=${valB} diff=${Math.abs(valA - valB)}`
        );
      }
    }
  });

  test("roughen patches agree across X boundary after prior edit", () => {
    const chunks = makeBoundaryGrid();
    const boundary = CHUNK_SIZE;
    const brushY = 16;
    const brushZ = 16;

    const raiseBrush = { radius: 3, strength: 10, shape: "sphere" as const, falloff: 1 };
    const raisePatches = computeBrushPatches([boundary - 1, brushY, brushZ], raiseBrush, "raise", chunks, 1.0);

    for (const p of raisePatches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.fieldIndex] = p.after;
    }

    const roughenBrush = { radius: 5, strength: 5, shape: "sphere" as const, falloff: 1 };
    const roughenPatches = computeBrushPatches([boundary, brushY, brushZ], roughenBrush, "roughen", chunks, 1.0);

    const chunkAId = chunkId({ cx: 0, cy: 0, cz: 0 });
    const chunkBId = chunkId({ cx: 1, cy: 0, cz: 0 });

    for (let ly = Math.max(0, brushY - 5); ly <= Math.min(CHUNK_SIZE, brushY + 5); ly++) {
      for (let lz = Math.max(0, brushZ - 5); lz <= Math.min(CHUNK_SIZE, brushZ + 5); lz++) {
        const idxA = localVoxelToSampleIndex(CHUNK_SIZE, ly, lz);
        const idxB = localVoxelToSampleIndex(0, ly, lz);

        const patchA = roughenPatches.find((p) => p.chunkId === chunkAId && p.fieldIndex === idxA);
        const patchB = roughenPatches.find((p) => p.chunkId === chunkBId && p.fieldIndex === idxB);

        if (!patchA || !patchB) continue;

        assert.ok(
          Math.abs(patchA.after - patchB.after) < 1e-4,
          `Roughen result for shared voxel at ly=${ly}, lz=${lz} should agree: ` +
            `A=${patchA.after} B=${patchB.after} diff=${Math.abs(patchA.after - patchB.after)}`
        );
      }
    }
  });
});
