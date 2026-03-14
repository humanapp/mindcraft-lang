import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import type { MesherOptions } from "../../src/world/terrain/mesher";
import { extractSurfaceNets } from "../../src/world/terrain/mesher";
import { CHUNK_SIZE } from "../../src/world/terrain/types";
import { flatPlane, sphere } from "./fixtures";
import { assertApproxEqual, findClosestVertex, makeChunkGrid, meshVerticesInRange } from "./helpers";

const RELAXED: MesherOptions = { vertexRelaxation: true };

describe("vertex relaxation seam correctness", () => {
  test("relaxed flat plane across X boundary has matching overlap vertices", () => {
    const height = 16;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      flatPlane(height)
    );

    const leftChunk = chunks.get("0,0,0")!;
    const rightChunk = chunks.get("1,0,0")!;

    const leftMesh = extractSurfaceNets(leftChunk.field, leftChunk.coord, RELAXED);
    const rightMesh = extractSurfaceNets(rightChunk.field, rightChunk.coord, RELAXED);

    assert.ok(leftMesh.vertexCount > 0, "left relaxed mesh should have vertices");
    assert.ok(rightMesh.vertexCount > 0, "right relaxed mesh should have vertices");

    const leftOverlap = meshVerticesInRange(leftMesh, "x", CHUNK_SIZE, CHUNK_SIZE + 1);
    const rightOverlap = meshVerticesInRange(rightMesh, "x", CHUNK_SIZE, CHUNK_SIZE + 1);

    assert.ok(leftOverlap.length > 0, "left chunk should have relaxed vertices in overlap");
    assert.ok(rightOverlap.length > 0, "right chunk should have relaxed vertices in overlap");

    const posEpsilon = 1e-4;
    for (const lv of leftOverlap) {
      const closest = findClosestVertex(lv.pos, rightMesh);
      assertApproxEqual(
        closest.distance,
        0,
        posEpsilon,
        `relaxed X overlap vertex (${lv.pos.join(",")}) has no nearby match`
      );
    }
  });

  test("relaxed flat plane across Y boundary has matching overlap vertices", () => {
    const height = CHUNK_SIZE;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 0, cy: 1, cz: 0 },
      ],
      flatPlane(height)
    );

    const lowerChunk = chunks.get("0,0,0")!;
    const upperChunk = chunks.get("0,1,0")!;

    const lowerMesh = extractSurfaceNets(lowerChunk.field, lowerChunk.coord, RELAXED);
    const upperMesh = extractSurfaceNets(upperChunk.field, upperChunk.coord, RELAXED);

    if (lowerMesh.vertexCount > 0 && upperMesh.vertexCount > 0) {
      const lowerOverlap = meshVerticesInRange(lowerMesh, "y", CHUNK_SIZE, CHUNK_SIZE + 1);
      const upperOverlap = meshVerticesInRange(upperMesh, "y", CHUNK_SIZE, CHUNK_SIZE + 1);

      if (lowerOverlap.length > 0 && upperOverlap.length > 0) {
        const posEpsilon = 1e-4;
        for (const lv of lowerOverlap) {
          const closest = findClosestVertex(lv.pos, upperMesh);
          assertApproxEqual(
            closest.distance,
            0,
            posEpsilon,
            `relaxed Y overlap vertex (${lv.pos.join(",")}) has no nearby match`
          );
        }
      }
    }
  });

  test("relaxed flat plane across Z boundary has matching overlap vertices", () => {
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

    const frontMesh = extractSurfaceNets(frontChunk.field, frontChunk.coord, RELAXED);
    const backMesh = extractSurfaceNets(backChunk.field, backChunk.coord, RELAXED);

    assert.ok(frontMesh.vertexCount > 0, "front relaxed mesh should have vertices");
    assert.ok(backMesh.vertexCount > 0, "back relaxed mesh should have vertices");

    const frontOverlap = meshVerticesInRange(frontMesh, "z", CHUNK_SIZE, CHUNK_SIZE + 1);
    const backOverlap = meshVerticesInRange(backMesh, "z", CHUNK_SIZE, CHUNK_SIZE + 1);

    assert.ok(frontOverlap.length > 0, "front chunk should have relaxed vertices in Z overlap");
    assert.ok(backOverlap.length > 0, "back chunk should have relaxed vertices in Z overlap");

    const posEpsilon = 1e-4;
    for (const fv of frontOverlap) {
      const closest = findClosestVertex(fv.pos, backMesh);
      assertApproxEqual(
        closest.distance,
        0,
        posEpsilon,
        `relaxed Z overlap vertex (${fv.pos.join(",")}) has no nearby match`
      );
    }
  });

  test("relaxed sphere crossing X boundary has matching overlap vertices", () => {
    const center: [number, number, number] = [CHUNK_SIZE, 16, 16];
    const radius = 10;
    const chunks = makeChunkGrid(
      [
        { cx: 0, cy: 0, cz: 0 },
        { cx: 1, cy: 0, cz: 0 },
      ],
      sphere(center, radius)
    );

    const leftChunk = chunks.get("0,0,0")!;
    const rightChunk = chunks.get("1,0,0")!;

    const leftMesh = extractSurfaceNets(leftChunk.field, leftChunk.coord, RELAXED);
    const rightMesh = extractSurfaceNets(rightChunk.field, rightChunk.coord, RELAXED);

    assert.ok(leftMesh.vertexCount > 0, "left relaxed mesh should have vertices");
    assert.ok(rightMesh.vertexCount > 0, "right relaxed mesh should have vertices");

    const leftOverlap = meshVerticesInRange(leftMesh, "x", CHUNK_SIZE, CHUNK_SIZE + 1);
    const rightOverlap = meshVerticesInRange(rightMesh, "x", CHUNK_SIZE, CHUNK_SIZE + 1);

    assert.ok(leftOverlap.length > 0, "relaxed sphere should have left X overlap vertices");
    assert.ok(rightOverlap.length > 0, "relaxed sphere should have right X overlap vertices");

    const posEpsilon = 1e-4;
    for (const lv of leftOverlap) {
      const closest = findClosestVertex(lv.pos, rightMesh);
      assertApproxEqual(
        closest.distance,
        0,
        posEpsilon,
        `relaxed sphere X overlap vertex (${lv.pos.join(",")}) has no nearby match`
      );
    }
  });

  test("vertex relaxation does not change vertex count", () => {
    const height = 16;
    const chunks = makeChunkGrid([{ cx: 0, cy: 0, cz: 0 }], flatPlane(height));
    const chunk = chunks.get("0,0,0")!;

    const plain = extractSurfaceNets(chunk.field, chunk.coord);
    const relaxed = extractSurfaceNets(chunk.field, chunk.coord, RELAXED);

    assert.equal(plain.vertexCount, relaxed.vertexCount, "relaxation should not add or remove vertices");
    assert.equal(plain.indexCount, relaxed.indexCount, "relaxation should not change index count");
  });
});
