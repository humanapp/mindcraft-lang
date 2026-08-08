import type { Obstacle } from "../brain/vision";
import { pixelsToStuds, SIM_WORLD_HEIGHT, SIM_WORLD_WIDTH, simToWorld } from "./scale";

const GROUND_THICKNESS = 4;
const WALL_HEIGHT = 8;
const WALL_THICKNESS = 2;
const CRATE_HEIGHT = 6;
const GROUND_COLOR = Color3.fromRGB(96, 140, 84);
const WALL_COLOR = Color3.fromRGB(72, 78, 90);
const CRATE_COLOR = Color3.fromRGB(140, 110, 76);
const SPAWN_MARGIN_PX = 120;

/**
 * Static line-of-sight blockers, in simulation pixels. The same rectangles
 * feed the rendered crates, the occlusion tests, and obstacle avoidance.
 */
const CRATES: readonly Obstacle[] = [
  { x: 420, y: 340, width: 110, height: 70 },
  { x: 1180, y: 320, width: 80, height: 120 },
  { x: 500, y: 880, width: 90, height: 90 },
  { x: 1120, y: 900, width: 130, height: 60 },
];

/** The built arena: its instance tree and the obstacles the engine reads. */
export interface Arena {
  /** Folder holding the ground, walls, and crates. */
  readonly container: Folder;
  /** Folder creature and blip parts are parented to. */
  readonly actorContainer: Folder;
  /** Static obstacle rectangles in simulation pixels. */
  readonly obstacles: readonly Obstacle[];
}

function createSlab(name: string, size: Vector3, position: Vector3, color: Color3, parent: Instance): Part {
  const part = new Instance("Part");
  part.Name = name;
  part.Anchored = true;
  part.CanCollide = true;
  part.Size = size;
  part.CFrame = new CFrame(position);
  part.Color = color;
  part.Material = Enum.Material.SmoothPlastic;
  part.TopSurface = Enum.SurfaceType.Smooth;
  part.BottomSurface = Enum.SurfaceType.Smooth;
  part.Parent = parent;
  return part;
}

/**
 * Builds the arena from code: ground sized to the simulation bounds, four
 * perimeter walls, the static crates, and a player spawn near the west edge.
 * Ground level is world Y = 0.
 *
 * @param parent - Instance the arena folder is parented to, normally Workspace.
 * @returns The arena handle, including the obstacle list the engine needs.
 */
export function buildArena(parent: Instance): Arena {
  const widthStuds = pixelsToStuds(SIM_WORLD_WIDTH);
  const depthStuds = pixelsToStuds(SIM_WORLD_HEIGHT);

  const container = new Instance("Folder");
  container.Name = "Arena";
  container.Parent = parent;

  createSlab(
    "Ground",
    new Vector3(widthStuds, GROUND_THICKNESS, depthStuds),
    new Vector3(0, -GROUND_THICKNESS / 2, 0),
    GROUND_COLOR,
    container
  );

  const wallY = WALL_HEIGHT / 2;
  const halfWidth = widthStuds / 2;
  const halfDepth = depthStuds / 2;
  const wallSpan = widthStuds + WALL_THICKNESS * 2;

  createSlab(
    "WallWest",
    new Vector3(WALL_THICKNESS, WALL_HEIGHT, depthStuds),
    new Vector3(-halfWidth - WALL_THICKNESS / 2, wallY, 0),
    WALL_COLOR,
    container
  );
  createSlab(
    "WallEast",
    new Vector3(WALL_THICKNESS, WALL_HEIGHT, depthStuds),
    new Vector3(halfWidth + WALL_THICKNESS / 2, wallY, 0),
    WALL_COLOR,
    container
  );
  createSlab(
    "WallNorth",
    new Vector3(wallSpan, WALL_HEIGHT, WALL_THICKNESS),
    new Vector3(0, wallY, -halfDepth - WALL_THICKNESS / 2),
    WALL_COLOR,
    container
  );
  createSlab(
    "WallSouth",
    new Vector3(wallSpan, WALL_HEIGHT, WALL_THICKNESS),
    new Vector3(0, wallY, halfDepth + WALL_THICKNESS / 2),
    WALL_COLOR,
    container
  );

  for (let i = 0; i < CRATES.size(); i++) {
    const crate = CRATES[i];
    createSlab(
      `Crate${i + 1}`,
      new Vector3(pixelsToStuds(crate.width), CRATE_HEIGHT, pixelsToStuds(crate.height)),
      simToWorld(crate.x, crate.y, CRATE_HEIGHT / 2),
      CRATE_COLOR,
      container
    );
  }

  const spawn = new Instance("SpawnLocation");
  spawn.Name = "ArenaSpawn";
  spawn.Anchored = true;
  spawn.CanCollide = true;
  spawn.Size = new Vector3(8, 1, 8);
  spawn.CFrame = new CFrame(simToWorld(SPAWN_MARGIN_PX, SIM_WORLD_HEIGHT / 2, 0.5));
  spawn.Color = Color3.fromRGB(200, 200, 200);
  spawn.TopSurface = Enum.SurfaceType.Smooth;
  spawn.BottomSurface = Enum.SurfaceType.Smooth;
  spawn.Parent = container;

  const actorContainer = new Instance("Folder");
  actorContainer.Name = "Actors";
  actorContainer.Parent = parent;

  return { container, actorContainer, obstacles: CRATES };
}
