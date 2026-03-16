import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { computeGradient } from "../../src/world/voxel/field";
import { syncChunkPadding } from "../../src/world/voxel/halo";
import { CHUNK_SIZE, FIELD_PAD, sampleIndex } from "../../src/world/voxel/types";
import { flatPlane, slopedHill, sphere } from "./fixtures";
import { assertApproxEqual, makeChunkGrid } from "./helpers";

describe("field continuity across chunk boundaries", () => {
  test("flat plane density is continuous across Y boundary", () => {
    const height = 16;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 1, cz: 0 },
      ],
      flatPlane(height)
    );

    const lower = chunks.get("0,0,0")!;
    const upper = chunks.get("0,1,0")!;

    // Sample along the Y boundary: lower chunk's last row vs upper chunk's first row
    // The boundary in world coords is at wy = CHUNK_SIZE (= 32).
    // In the lower chunk, that's local y = CHUNK_SIZE, field index ly = CHUNK_SIZE + FIELD_PAD.
    // In the upper chunk, that's local y = 0, field index ly = FIELD_PAD.
    const epsilon = 1e-6;
    for (let lx = FIELD_PAD; lx < FIELD_PAD + CHUNK_SIZE; lx++) {
      for (let lz = FIELD_PAD; lz < FIELD_PAD + CHUNK_SIZE; lz++) {
        const lowerVal = lower.field[sampleIndex(lx, CHUNK_SIZE + FIELD_PAD, lz)];
        const upperVal = upper.field[sampleIndex(lx, FIELD_PAD, lz)];
        assertApproxEqual(lowerVal, upperVal, epsilon, `mismatch at lx=${lx}, lz=${lz}`);
      }
    }
  });

  test("flat plane density is continuous across X boundary", () => {
    const height = 16;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(height)
    );

    const left = chunks.get("0,0,0")!;
    const right = chunks.get("1,0,0")!;

    const epsilon = 1e-6;
    for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
      for (let lz = FIELD_PAD; lz < FIELD_PAD + CHUNK_SIZE; lz++) {
        const leftVal = left.field[sampleIndex(CHUNK_SIZE + FIELD_PAD, ly, lz)];
        const rightVal = right.field[sampleIndex(FIELD_PAD, ly, lz)];
        assertApproxEqual(leftVal, rightVal, epsilon, `mismatch at ly=${ly}, lz=${lz}`);
      }
    }
  });

  test("sphere density is continuous across chunk boundary", () => {
    const center: [number, number, number] = [CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE];
    const radius = 12;
    const chunks = makeChunkGrid(
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
      sphere(center, radius)
    );

    // Check continuity at the X boundary between chunks (0,0,0) and (1,0,0)
    const left = chunks.get("0,0,0")!;
    const right = chunks.get("1,0,0")!;
    const epsilon = 1e-6;

    for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
      for (let lz = FIELD_PAD; lz < FIELD_PAD + CHUNK_SIZE; lz++) {
        const leftVal = left.field[sampleIndex(CHUNK_SIZE + FIELD_PAD, ly, lz)];
        const rightVal = right.field[sampleIndex(FIELD_PAD, ly, lz)];
        assertApproxEqual(leftVal, rightVal, epsilon, `X boundary mismatch at ly=${ly}, lz=${lz}`);
      }
    }
  });

  test("halo padding matches neighbor core data", () => {
    const height = 20;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(height)
    );

    const left = chunks.get("0,0,0")!;
    const right = chunks.get("1,0,0")!;

    // The right halo of the left chunk should match the left core of the right chunk
    const epsilon = 1e-10;
    for (let pad = 1; pad <= FIELD_PAD; pad++) {
      for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
        for (let lz = FIELD_PAD; lz < FIELD_PAD + CHUNK_SIZE; lz++) {
          const haloLx = CHUNK_SIZE + FIELD_PAD + pad;
          const coreLx = FIELD_PAD + pad;
          const haloVal = left.field[sampleIndex(haloLx, ly, lz)];
          const coreVal = right.field[sampleIndex(coreLx, ly, lz)];
          assertApproxEqual(haloVal, coreVal, epsilon, `halo pad=${pad} ly=${ly} lz=${lz}`);
        }
      }
    }
  });
});

describe("gradient continuity across chunk boundaries", () => {
  test("sloped hill gradient is consistent across X boundary", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      slopedHill(16, 0.5, 0.0)
    );

    const left = chunks.get("0,0,0")!;
    const right = chunks.get("1,0,0")!;
    const epsilon = 1e-4;

    const ly = FIELD_PAD + CHUNK_SIZE / 2;
    const lz = FIELD_PAD + CHUNK_SIZE / 2;

    // Gradient at the right edge of left chunk
    const leftGrad = computeGradient(left.field, CHUNK_SIZE + FIELD_PAD - 1, ly, lz);
    // Gradient at the left edge of right chunk
    const rightGrad = computeGradient(right.field, FIELD_PAD + 1, ly, lz);

    assertApproxEqual(leftGrad[0], rightGrad[0], epsilon, "gx");
    assertApproxEqual(leftGrad[1], rightGrad[1], epsilon, "gy");
    assertApproxEqual(leftGrad[2], rightGrad[2], epsilon, "gz");
  });
});

describe("field sampling near chunk boundaries", () => {
  test("all corner-adjacent samples are finite for a sphere field", () => {
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], sphere([16, 16, 16], 10));
    const chunk = chunks.get("0,0,0")!;

    for (let lz = 0; lz < FIELD_PAD + CHUNK_SIZE + FIELD_PAD; lz++) {
      for (let ly = 0; ly < FIELD_PAD + CHUNK_SIZE + FIELD_PAD; ly++) {
        for (let lx = 0; lx < FIELD_PAD + CHUNK_SIZE + FIELD_PAD; lx++) {
          const val = chunk.field[sampleIndex(lx, ly, lz)];
          assert.ok(Number.isFinite(val), `non-finite at (${lx},${ly},${lz}): ${val}`);
        }
      }
    }
  });
});
