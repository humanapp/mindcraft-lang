import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { computeGradient } from "../../src/world/voxel/field";
import { extractSurfaceNets } from "../../src/world/voxel/mesher";
import { CHUNK_SIZE, FIELD_PAD, sampleIndex } from "../../src/world/voxel/types";
import { flatPlane, slopedHill, sphere } from "./fixtures";
import { assertApproxEqual, findClosestVertex, makeChunkGrid, meshVerticesInRange } from "./helpers";

describe("field continuity across Z boundary", () => {
  test("flat plane density is continuous across Z boundary", () => {
    const height = 16;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 0, cz: 1 },
      ],
      flatPlane(height)
    );

    const front = chunks.get("0,0,0")!;
    const back = chunks.get("0,0,1")!;
    const epsilon = 1e-6;

    for (let lx = FIELD_PAD; lx < FIELD_PAD + CHUNK_SIZE; lx++) {
      for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
        const frontVal = front.field[sampleIndex(lx, ly, CHUNK_SIZE + FIELD_PAD)];
        const backVal = back.field[sampleIndex(lx, ly, FIELD_PAD)];
        assertApproxEqual(frontVal, backVal, epsilon, `Z boundary lx=${lx} ly=${ly}`);
      }
    }
  });

  test("sphere density is continuous across Z boundary", () => {
    const center: [number, number, number] = [16, 16, CHUNK_SIZE];
    const radius = 12;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 0, cz: 1 },
      ],
      sphere(center, radius)
    );

    const front = chunks.get("0,0,0")!;
    const back = chunks.get("0,0,1")!;
    const epsilon = 1e-6;

    for (let lx = FIELD_PAD; lx < FIELD_PAD + CHUNK_SIZE; lx++) {
      for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
        const frontVal = front.field[sampleIndex(lx, ly, CHUNK_SIZE + FIELD_PAD)];
        const backVal = back.field[sampleIndex(lx, ly, FIELD_PAD)];
        assertApproxEqual(frontVal, backVal, epsilon, `Z sphere boundary lx=${lx} ly=${ly}`);
      }
    }
  });

  test("halo padding matches neighbor core across Z boundary", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 0, cz: 1 },
      ],
      flatPlane(20)
    );

    const front = chunks.get("0,0,0")!;
    const back = chunks.get("0,0,1")!;
    const epsilon = 1e-10;

    for (let pad = 1; pad <= FIELD_PAD; pad++) {
      for (let lx = FIELD_PAD; lx < FIELD_PAD + CHUNK_SIZE; lx++) {
        for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
          const haloLz = CHUNK_SIZE + FIELD_PAD + pad;
          const coreLz = FIELD_PAD + pad;
          const haloVal = front.field[sampleIndex(lx, ly, haloLz)];
          const coreVal = back.field[sampleIndex(lx, ly, coreLz)];
          assertApproxEqual(haloVal, coreVal, epsilon, `Z halo pad=${pad} lx=${lx} ly=${ly}`);
        }
      }
    }
  });
});

describe("gradient continuity across Z boundary", () => {
  test("sloped hill gradient is consistent across Z boundary", () => {
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 0, cz: 1 },
      ],
      slopedHill(16, 0.0, 0.5)
    );

    const front = chunks.get("0,0,0")!;
    const back = chunks.get("0,0,1")!;
    const epsilon = 1e-4;

    const lx = FIELD_PAD + CHUNK_SIZE / 2;
    const ly = FIELD_PAD + CHUNK_SIZE / 2;

    const frontGrad = computeGradient(front.field, lx, ly, CHUNK_SIZE + FIELD_PAD - 1);
    const backGrad = computeGradient(back.field, lx, ly, FIELD_PAD + 1);

    assertApproxEqual(frontGrad[0], backGrad[0], epsilon, "gx");
    assertApproxEqual(frontGrad[1], backGrad[1], epsilon, "gy");
    assertApproxEqual(frontGrad[2], backGrad[2], epsilon, "gz");
  });
});

describe("mesh seam correctness across Z boundary", () => {
  test("flat plane across two Z-adjacent chunks has no seam", () => {
    const height = 16;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 0, cz: 1 },
      ],
      flatPlane(height)
    );

    const frontChunk = chunks.get("0,0,0")!;
    const backChunk = chunks.get("0,0,1")!;

    const frontMesh = extractSurfaceNets(frontChunk.field, frontChunk.coord);
    const backMesh = extractSurfaceNets(backChunk.field, backChunk.coord);

    assert.ok(frontMesh.vertexCount > 0, "front mesh should have vertices");
    assert.ok(backMesh.vertexCount > 0, "back mesh should have vertices");

    const frontOverlap = meshVerticesInRange(frontMesh, "z", CHUNK_SIZE, CHUNK_SIZE + 1);
    const backOverlap = meshVerticesInRange(backMesh, "z", CHUNK_SIZE, CHUNK_SIZE + 1);

    assert.ok(frontOverlap.length > 0, "front chunk should have vertices in Z overlap");
    assert.ok(backOverlap.length > 0, "back chunk should have vertices in Z overlap");

    const posEpsilon = 1e-4;
    for (const fv of frontOverlap) {
      const closest = findClosestVertex(fv.pos, backMesh);
      assertApproxEqual(closest.distance, 0, posEpsilon, `Z seam vertex (${fv.pos.join(",")}) has no nearby match`);
    }
  });

  test("sphere crossing Z chunk boundary has matching vertices", () => {
    const center: [number, number, number] = [16, 16, CHUNK_SIZE];
    const radius = 10;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 0, cz: 1 },
      ],
      sphere(center, radius)
    );

    const frontChunk = chunks.get("0,0,0")!;
    const backChunk = chunks.get("0,0,1")!;

    const frontMesh = extractSurfaceNets(frontChunk.field, frontChunk.coord);
    const backMesh = extractSurfaceNets(backChunk.field, backChunk.coord);

    assert.ok(frontMesh.vertexCount > 0, "front mesh should have vertices");
    assert.ok(backMesh.vertexCount > 0, "back mesh should have vertices");

    const frontOverlap = meshVerticesInRange(frontMesh, "z", CHUNK_SIZE, CHUNK_SIZE + 1);
    const backOverlap = meshVerticesInRange(backMesh, "z", CHUNK_SIZE, CHUNK_SIZE + 1);

    assert.ok(frontOverlap.length > 0, "front chunk Z overlap should have vertices");
    assert.ok(backOverlap.length > 0, "back chunk Z overlap should have vertices");

    const posEpsilon = 1e-4;
    for (const fv of frontOverlap) {
      const closest = findClosestVertex(fv.pos, backMesh);
      assertApproxEqual(
        closest.distance,
        0,
        posEpsilon,
        `Z sphere overlap vertex (${fv.pos.join(",")}) has no nearby match`
      );
    }
  });
});

describe("diagonal and true-corner chunk boundaries", () => {
  test("sphere at XY edge has continuous density across both axes", () => {
    const center: [number, number, number] = [CHUNK_SIZE, CHUNK_SIZE, 16];
    const radius = 10;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
        { cx: 0, cy: 1, cz: 0 },
        { cx: 1, cy: 1, cz: 0 },
      ],
      sphere(center, radius)
    );

    const epsilon = 1e-6;

    // X boundary: (0,0,0) -> (1,0,0)
    const c00 = chunks.get("0,0,0")!;
    const c10 = chunks.get("1,0,0")!;
    for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
      for (let lz = FIELD_PAD; lz < FIELD_PAD + CHUNK_SIZE; lz++) {
        const a = c00.field[sampleIndex(CHUNK_SIZE + FIELD_PAD, ly, lz)];
        const b = c10.field[sampleIndex(FIELD_PAD, ly, lz)];
        assertApproxEqual(a, b, epsilon, `XY-edge X boundary ly=${ly} lz=${lz}`);
      }
    }

    // Y boundary: (0,0,0) -> (0,1,0)
    const c01 = chunks.get("0,1,0")!;
    for (let lx = FIELD_PAD; lx < FIELD_PAD + CHUNK_SIZE; lx++) {
      for (let lz = FIELD_PAD; lz < FIELD_PAD + CHUNK_SIZE; lz++) {
        const a = c00.field[sampleIndex(lx, CHUNK_SIZE + FIELD_PAD, lz)];
        const b = c01.field[sampleIndex(lx, FIELD_PAD, lz)];
        assertApproxEqual(a, b, epsilon, `XY-edge Y boundary lx=${lx} lz=${lz}`);
      }
    }
  });

  test("sphere at XYZ corner has continuous density across all 3 axes", () => {
    const center: [number, number, number] = [CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE];
    const radius = 10;
    const allCoords = [];
    for (let cz = 0; cz < 2; cz++) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cx = 0; cx < 2; cx++) {
          allCoords.push({ cx, cy, cz });
        }
      }
    }
    const chunks = makeChunkGrid(allCoords, sphere(center, radius));
    const epsilon = 1e-6;

    // Check all 3 axis boundaries radiating from (0,0,0)
    const c000 = chunks.get("0,0,0")!;

    // X
    const c100 = chunks.get("1,0,0")!;
    for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
      for (let lz = FIELD_PAD; lz < FIELD_PAD + CHUNK_SIZE; lz++) {
        const a = c000.field[sampleIndex(CHUNK_SIZE + FIELD_PAD, ly, lz)];
        const b = c100.field[sampleIndex(FIELD_PAD, ly, lz)];
        assertApproxEqual(a, b, epsilon, `XYZ corner X boundary ly=${ly} lz=${lz}`);
      }
    }

    // Y
    const c010 = chunks.get("0,1,0")!;
    for (let lx = FIELD_PAD; lx < FIELD_PAD + CHUNK_SIZE; lx++) {
      for (let lz = FIELD_PAD; lz < FIELD_PAD + CHUNK_SIZE; lz++) {
        const a = c000.field[sampleIndex(lx, CHUNK_SIZE + FIELD_PAD, lz)];
        const b = c010.field[sampleIndex(lx, FIELD_PAD, lz)];
        assertApproxEqual(a, b, epsilon, `XYZ corner Y boundary lx=${lx} lz=${lz}`);
      }
    }

    // Z
    const c001 = chunks.get("0,0,1")!;
    for (let lx = FIELD_PAD; lx < FIELD_PAD + CHUNK_SIZE; lx++) {
      for (let ly = FIELD_PAD; ly < FIELD_PAD + CHUNK_SIZE; ly++) {
        const a = c000.field[sampleIndex(lx, ly, CHUNK_SIZE + FIELD_PAD)];
        const b = c001.field[sampleIndex(lx, ly, FIELD_PAD)];
        assertApproxEqual(a, b, epsilon, `XYZ corner Z boundary lx=${lx} ly=${ly}`);
      }
    }
  });

  test("sphere mesh at XYZ corner has matching overlap vertices on all 3 axes", () => {
    const center: [number, number, number] = [CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE];
    const radius = 10;
    const allCoords = [];
    for (let cz = 0; cz < 2; cz++) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cx = 0; cx < 2; cx++) {
          allCoords.push({ cx, cy, cz });
        }
      }
    }
    const chunks = makeChunkGrid(allCoords, sphere(center, radius));

    const meshes = new Map<string, ReturnType<typeof extractSurfaceNets>>();
    for (const [id, chunk] of chunks) {
      meshes.set(id, extractSurfaceNets(chunk.field, chunk.coord));
    }

    const posEpsilon = 1e-4;

    // X boundary overlap between (0,0,0) and (1,0,0)
    const m000 = meshes.get("0,0,0")!;
    const m100 = meshes.get("1,0,0")!;
    const xOverlap = meshVerticesInRange(m000, "x", CHUNK_SIZE, CHUNK_SIZE + 1);
    for (const v of xOverlap) {
      const closest = findClosestVertex(v.pos, m100);
      assertApproxEqual(closest.distance, 0, posEpsilon, `XYZ corner X mesh vertex (${v.pos.join(",")})`);
    }

    // Y boundary overlap between (0,0,0) and (0,1,0)
    const m010 = meshes.get("0,1,0")!;
    const yOverlap = meshVerticesInRange(m000, "y", CHUNK_SIZE, CHUNK_SIZE + 1);
    for (const v of yOverlap) {
      const closest = findClosestVertex(v.pos, m010);
      assertApproxEqual(closest.distance, 0, posEpsilon, `XYZ corner Y mesh vertex (${v.pos.join(",")})`);
    }

    // Z boundary overlap between (0,0,0) and (0,0,1)
    const m001 = meshes.get("0,0,1")!;
    const zOverlap = meshVerticesInRange(m000, "z", CHUNK_SIZE, CHUNK_SIZE + 1);
    for (const v of zOverlap) {
      const closest = findClosestVertex(v.pos, m001);
      assertApproxEqual(closest.distance, 0, posEpsilon, `XYZ corner Z mesh vertex (${v.pos.join(",")})`);
    }
  });
});
