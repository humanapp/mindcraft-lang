import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { computeBrushPatches } from "../../src/world/terrain/edit";
import { syncChunkPadding } from "../../src/world/voxel/halo";
import { extractSurfaceNets } from "../../src/world/voxel/mesher";
import { CHUNK_SIZE, FIELD_PAD, SAMPLES, SAMPLES_SQ, sampleIndex } from "../../src/world/voxel/types";
import { flatPlane } from "./fixtures";
import { assertApproxEqual, makeChunkGrid, meshVerticesInRange } from "./helpers";

const CORE_MIN = FIELD_PAD;
const CORE_MAX = FIELD_PAD + CHUNK_SIZE + 1;

describe("edge/corner halo sync after edits", () => {
  test("edge-halo samples match neighbor core after edit near chunk edge", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
        { cx: 0, cy: 1, cz: 0 },
        { cx: 1, cy: 1, cz: 0 },
      ],
      flatPlane(16)
    );

    const brush = { radius: 4, strength: 5, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches([CHUNK_SIZE - 1, CHUNK_SIZE - 1, 16], brush, "raise", chunks, 1.0);
    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.fieldIndex] = p.after;
    }

    for (const chunk of chunks.values()) {
      syncChunkPadding(chunk, chunks);
    }

    const c11 = chunks.get("1,1,0")!;
    const c00 = chunks.get("0,0,0")!;

    let mismatches = 0;
    for (let lz = CORE_MIN; lz <= CORE_MAX; lz++) {
      for (let ly = 0; ly < CORE_MIN; ly++) {
        for (let lx = 0; lx < CORE_MIN; lx++) {
          const haloVal = c11.field[lx + ly * SAMPLES + lz * SAMPLES_SQ];

          const srcX = lx + CHUNK_SIZE;
          const srcY = ly + CHUNK_SIZE;
          const srcZ = lz;
          const coreVal = c00.field[srcX + srcY * SAMPLES + srcZ * SAMPLES_SQ];

          if (Math.abs(haloVal - coreVal) > 1e-10) {
            mismatches++;
          }
        }
      }
    }

    assert.strictEqual(mismatches, 0, `edge-halo region has ${mismatches} stale samples after edit + syncChunkPadding`);
  });

  test("corner-halo samples match diagonal neighbor core after edit", () => {
    const allCoords = [];
    for (let cz = 0; cz < 2; cz++) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cx = 0; cx < 2; cx++) {
          allCoords.push({ cx, cy, cz });
        }
      }
    }
    const chunks = makeChunkGrid(allCoords, flatPlane(16));

    const brush = { radius: 4, strength: 5, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches([CHUNK_SIZE - 1, CHUNK_SIZE - 1, CHUNK_SIZE - 1], brush, "raise", chunks, 1.0);
    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.fieldIndex] = p.after;
    }

    for (const chunk of chunks.values()) {
      syncChunkPadding(chunk, chunks);
    }

    const c111 = chunks.get("1,1,1")!;
    const c000 = chunks.get("0,0,0")!;

    let mismatches = 0;
    for (let lz = 0; lz < CORE_MIN; lz++) {
      for (let ly = 0; ly < CORE_MIN; ly++) {
        for (let lx = 0; lx < CORE_MIN; lx++) {
          const haloVal = c111.field[lx + ly * SAMPLES + lz * SAMPLES_SQ];

          const srcX = lx + CHUNK_SIZE;
          const srcY = ly + CHUNK_SIZE;
          const srcZ = lz + CHUNK_SIZE;
          const coreVal = c000.field[srcX + srcY * SAMPLES + srcZ * SAMPLES_SQ];

          if (Math.abs(haloVal - coreVal) > 1e-10) {
            mismatches++;
          }
        }
      }
    }

    assert.strictEqual(
      mismatches,
      0,
      `corner-halo region has ${mismatches} stale samples after edit + syncChunkPadding`
    );
  });

  test("boundary normals agree between diagonal chunks after edit near edge", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
        { cx: 0, cy: 1, cz: 0 },
        { cx: 1, cy: 1, cz: 0 },
      ],
      flatPlane(CHUNK_SIZE - 2)
    );

    const brush = { radius: 6, strength: 8, shape: "sphere" as const, falloff: 1 };
    const patches = computeBrushPatches([CHUNK_SIZE, CHUNK_SIZE, 16], brush, "raise", chunks, 1.0);
    for (const p of patches) {
      const chunk = chunks.get(p.chunkId);
      if (chunk) chunk.field[p.fieldIndex] = p.after;
    }

    for (const chunk of chunks.values()) {
      syncChunkPadding(chunk, chunks);
    }

    const c00 = chunks.get("0,0,0")!;
    const c10 = chunks.get("1,0,0")!;
    const c01 = chunks.get("0,1,0")!;
    const c11 = chunks.get("1,1,0")!;

    const meshes = [
      { mesh: extractSurfaceNets(c00.field, c00.coord), id: "0,0" },
      { mesh: extractSurfaceNets(c10.field, c10.coord), id: "1,0" },
      { mesh: extractSurfaceNets(c01.field, c01.coord), id: "0,1" },
      { mesh: extractSurfaceNets(c11.field, c11.coord), id: "1,1" },
    ];

    const xBound = CHUNK_SIZE;
    const yBound = CHUNK_SIZE;
    const nearCorner: { pos: [number, number, number]; nx: number; ny: number; nz: number; src: string }[] = [];

    for (const { mesh, id } of meshes) {
      for (let i = 0; i < mesh.vertexCount; i++) {
        const px = mesh.positions[i * 3];
        const py = mesh.positions[i * 3 + 1];
        const pz = mesh.positions[i * 3 + 2];
        if (Math.abs(px - xBound) < 1.5 && Math.abs(py - yBound) < 1.5) {
          nearCorner.push({
            pos: [px, py, pz],
            nx: mesh.normals[i * 3],
            ny: mesh.normals[i * 3 + 1],
            nz: mesh.normals[i * 3 + 2],
            src: id,
          });
        }
      }
    }

    assert.ok(nearCorner.length >= 2, `expected vertices near the 4-chunk corner, found ${nearCorner.length}`);

    let normalMismatches = 0;
    const posEps = 0.01;
    const normEps = 0.05;

    for (let i = 0; i < nearCorner.length; i++) {
      for (let j = i + 1; j < nearCorner.length; j++) {
        const a = nearCorner[i];
        const b = nearCorner[j];
        if (a.src === b.src) continue;
        const dx = a.pos[0] - b.pos[0];
        const dy = a.pos[1] - b.pos[1];
        const dz = a.pos[2] - b.pos[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > posEps) continue;
        const dot = a.nx * b.nx + a.ny * b.ny + a.nz * b.nz;
        if (dot < 1 - normEps) {
          normalMismatches++;
        }
      }
    }

    assert.strictEqual(
      normalMismatches,
      0,
      `${normalMismatches} co-located vertices near 4-chunk corner have mismatched normals`
    );
  });
});
