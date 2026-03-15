import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { computeBrushPatches } from "../../src/world/terrain/edit";
import { syncChunkPadding } from "../../src/world/terrain/halo";
import { CHUNK_SIZE, FIELD_PAD, sampleIndex } from "../../src/world/terrain/types";
import { flatPlane, sphere } from "./fixtures";
import { assertApproxEqual, makeChunkGrid } from "./helpers";

describe("halo sync after edits", () => {
  test("editing a chunk and re-syncing propagates to neighbor halo", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(16)
    );

    const left = chunks.get("0,0,0")!;
    const right = chunks.get("1,0,0")!;

    // Apply a brush edit to the left chunk near the X boundary
    const brush = { radius: 4, strength: 5, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches([CHUNK_SIZE - 3, 16, 16], brush, "raise", chunks, 1.0);
    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.index] = p.after;
    }

    // Re-sync halos for the right chunk
    syncChunkPadding(right, chunks);

    // The right chunk's left halo should now reflect the edited left chunk's core
    const epsilon = 1e-10;
    for (let pad = 1; pad <= FIELD_PAD; pad++) {
      const ly = FIELD_PAD + CHUNK_SIZE / 2;
      const lz = FIELD_PAD + CHUNK_SIZE / 2;
      // Right chunk halo sample at x offset -pad from core start
      const haloLx = FIELD_PAD - pad;
      // Corresponding left chunk core sample
      const coreLx = CHUNK_SIZE + FIELD_PAD - pad;
      const haloVal = right.field[sampleIndex(haloLx, ly, lz)];
      const coreVal = left.field[sampleIndex(coreLx, ly, lz)];
      assertApproxEqual(haloVal, coreVal, epsilon, `halo pad=${pad}`);
    }
  });

  test("edited density at boundary remains continuous after halo re-sync", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(16)
    );

    const left = chunks.get("0,0,0")!;
    const right = chunks.get("1,0,0")!;

    // Edit straddles the X boundary
    const brush = { radius: 5, strength: 3, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches([CHUNK_SIZE, 16, 16], brush, "raise", chunks, 1.0);
    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.index] = p.after;
    }

    // Re-sync both chunks
    syncChunkPadding(left, chunks);
    syncChunkPadding(right, chunks);

    // Verify density continuity at the boundary
    const epsilon = 1e-6;
    for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
      for (let lz = FIELD_PAD; lz < FIELD_PAD + CHUNK_SIZE; lz++) {
        const leftVal = left.field[sampleIndex(CHUNK_SIZE + FIELD_PAD, ly, lz)];
        const rightVal = right.field[sampleIndex(FIELD_PAD, ly, lz)];
        assertApproxEqual(leftVal, rightVal, epsilon, `post-edit boundary mismatch at ly=${ly}, lz=${lz}`);
      }
    }
  });

  test("edit near Y boundary re-syncs upper chunk halo correctly", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 1, cz: 0 },
      ],
      flatPlane(16)
    );

    const lower = chunks.get("0,0,0")!;
    const upper = chunks.get("0,1,0")!;

    const brush = { radius: 4, strength: 3, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches([16, CHUNK_SIZE - 2, 16], brush, "raise", chunks, 1.0);
    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.index] = p.after;
    }

    syncChunkPadding(upper, chunks);

    const epsilon = 1e-10;
    for (let pad = 1; pad <= FIELD_PAD; pad++) {
      const lx = FIELD_PAD + CHUNK_SIZE / 2;
      const lz = FIELD_PAD + CHUNK_SIZE / 2;
      const haloLy = FIELD_PAD - pad;
      const coreLy = CHUNK_SIZE + FIELD_PAD - pad;
      const haloVal = upper.field[sampleIndex(lx, haloLy, lz)];
      const coreVal = lower.field[sampleIndex(lx, coreLy, lz)];
      assertApproxEqual(haloVal, coreVal, epsilon, `Y halo pad=${pad}`);
    }
  });

  test("edit near Z boundary re-syncs back-neighbor halo correctly", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 0, cz: 1 },
      ],
      flatPlane(16)
    );

    const front = chunks.get("0,0,0")!;
    const back = chunks.get("0,0,1")!;

    const brush = { radius: 4, strength: 3, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches([16, 16, CHUNK_SIZE - 2], brush, "raise", chunks, 1.0);
    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.index] = p.after;
    }

    syncChunkPadding(back, chunks);

    const epsilon = 1e-10;
    for (let pad = 1; pad <= FIELD_PAD; pad++) {
      const lx = FIELD_PAD + CHUNK_SIZE / 2;
      const ly = FIELD_PAD + CHUNK_SIZE / 2;
      const haloLz = FIELD_PAD - pad;
      const coreLz = CHUNK_SIZE + FIELD_PAD - pad;
      const haloVal = back.field[sampleIndex(lx, ly, haloLz)];
      const coreVal = front.field[sampleIndex(lx, ly, coreLz)];
      assertApproxEqual(haloVal, coreVal, epsilon, `Z halo pad=${pad}`);
    }
  });

  test("corner edit re-sync propagates to all 8 neighbors", () => {
    const allCoords = [];
    for (let cz = 0; cz < 2; cz++) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cx = 0; cx < 2; cx++) {
          allCoords.push({ cx, cy, cz });
        }
      }
    }
    const chunks = makeChunkGrid(allCoords, flatPlane(16));

    // Edit right at the 8-chunk corner
    const brush = { radius: 4, strength: 3, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches([CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE], brush, "raise", chunks, 1.0);
    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.index] = p.after;
    }

    // Re-sync all halos
    for (const chunk of chunks.values()) {
      syncChunkPadding(chunk, chunks);
    }

    // Check density continuity across all 3 axis-aligned boundaries through the corner
    const epsilon = 1e-6;

    // X boundary between (0,0,0) and (1,0,0)
    const c00 = chunks.get("0,0,0")!;
    const c10 = chunks.get("1,0,0")!;
    for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
      for (let lz = FIELD_PAD; lz < FIELD_PAD + CHUNK_SIZE; lz++) {
        const leftVal = c00.field[sampleIndex(CHUNK_SIZE + FIELD_PAD, ly, lz)];
        const rightVal = c10.field[sampleIndex(FIELD_PAD, ly, lz)];
        assertApproxEqual(leftVal, rightVal, epsilon, `X boundary ly=${ly} lz=${lz}`);
      }
    }

    // Y boundary between (0,0,0) and (0,1,0)
    const c01 = chunks.get("0,1,0")!;
    for (let lx = FIELD_PAD; lx < FIELD_PAD + CHUNK_SIZE; lx++) {
      for (let lz = FIELD_PAD; lz < FIELD_PAD + CHUNK_SIZE; lz++) {
        const loVal = c00.field[sampleIndex(lx, CHUNK_SIZE + FIELD_PAD, lz)];
        const hiVal = c01.field[sampleIndex(lx, FIELD_PAD, lz)];
        assertApproxEqual(loVal, hiVal, epsilon, `Y boundary lx=${lx} lz=${lz}`);
      }
    }

    // Z boundary between (0,0,0) and (0,0,1)
    const c001 = chunks.get("0,0,1")!;
    for (let lx = FIELD_PAD; lx < FIELD_PAD + CHUNK_SIZE; lx++) {
      for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
        const fVal = c00.field[sampleIndex(lx, ly, CHUNK_SIZE + FIELD_PAD)];
        const bVal = c001.field[sampleIndex(lx, ly, FIELD_PAD)];
        assertApproxEqual(fVal, bVal, epsilon, `Z boundary lx=${lx} ly=${ly}`);
      }
    }
  });
});
