/**
 * Width of the brain-visible simulation world, in ecosim pixels.
 * Every position the brain sees or writes is expressed in this space.
 */
export const SIM_WORLD_WIDTH = 1600;

/** Height of the brain-visible simulation world, in ecosim pixels. */
export const SIM_WORLD_HEIGHT = 1200;

/** Roblox studs per simulation pixel. The only place the two spaces meet. */
export const STUDS_PER_PIXEL = 1 / 15;

/**
 * Simulation steps per second. Velocities inside the sprite facade are
 * expressed in pixels per step so ecosim's Matter-derived constants carry over
 * unchanged.
 */
export const SIM_STEPS_PER_SECOND = 60;

/** Milliseconds of simulation time in one step. */
export const MS_PER_SIM_STEP = 1000 / SIM_STEPS_PER_SECOND;

/** Multiplier converting a px/step velocity component into studs/second. */
export const PX_PER_STEP_TO_STUDS_PER_SECOND = SIM_STEPS_PER_SECOND * STUDS_PER_PIXEL;

const HALF_WIDTH_PX = SIM_WORLD_WIDTH / 2;
const HALF_HEIGHT_PX = SIM_WORLD_HEIGHT / 2;

/**
 * Converts a pixel length to studs.
 *
 * @param pixels - Length in simulation pixels.
 * @returns The same length in Roblox studs.
 */
export function pixelsToStuds(pixels: number): number {
  return pixels * STUDS_PER_PIXEL;
}

/**
 * Converts a stud length to simulation pixels.
 *
 * @param studs - Length in Roblox studs.
 * @returns The same length in simulation pixels.
 */
export function studsToPixels(studs: number): number {
  return studs / STUDS_PER_PIXEL;
}

/**
 * Converts a simulation x coordinate to a Roblox world X coordinate. The arena
 * is centred on the world origin, so sim x = 0 maps to the arena's west edge.
 *
 * @param simX - Simulation x in pixels.
 * @returns World X in studs.
 */
export function simXToWorldX(simX: number): number {
  return (simX - HALF_WIDTH_PX) * STUDS_PER_PIXEL;
}

/**
 * Converts a simulation y coordinate to a Roblox world Z coordinate.
 *
 * @param simY - Simulation y in pixels.
 * @returns World Z in studs.
 */
export function simYToWorldZ(simY: number): number {
  return (simY - HALF_HEIGHT_PX) * STUDS_PER_PIXEL;
}

/**
 * Converts a Roblox world X coordinate back to simulation x.
 *
 * @param worldX - World X in studs.
 * @returns Simulation x in pixels.
 */
export function worldXToSimX(worldX: number): number {
  return worldX / STUDS_PER_PIXEL + HALF_WIDTH_PX;
}

/**
 * Converts a Roblox world Z coordinate back to simulation y.
 *
 * @param worldZ - World Z in studs.
 * @returns Simulation y in pixels.
 */
export function worldZToSimY(worldZ: number): number {
  return worldZ / STUDS_PER_PIXEL + HALF_HEIGHT_PX;
}

/**
 * Builds a world position from a simulation position and an explicit height.
 *
 * @param simX - Simulation x in pixels.
 * @param simY - Simulation y in pixels.
 * @param worldY - World Y (height) in studs, which the simulation does not model.
 * @returns The world-space position.
 */
export function simToWorld(simX: number, simY: number, worldY: number): Vector3 {
  return new Vector3(simXToWorldX(simX), worldY, simYToWorldZ(simY));
}

/**
 * Yaw (rotation about world Y) that points a part's front along a simulation
 * heading. Simulation headings are radians with 0 = +x (world +X) and positive
 * values rotating toward +y (world +Z), so the facing vector in world space is
 * `(cos h, 0, sin h)`.
 *
 * @param heading - Simulation heading in radians.
 * @returns Yaw in radians for `CFrame.Angles(0, yaw, 0)`.
 */
export function headingToYaw(heading: number): number {
  return -heading - math.pi / 2;
}

/**
 * Builds the CFrame of a part standing at `position` and facing `heading`.
 *
 * @param position - World-space position of the part's centre.
 * @param heading - Simulation heading in radians.
 * @returns The oriented CFrame.
 */
export function headingCFrame(position: Vector3, heading: number): CFrame {
  return new CFrame(position).mul(CFrame.Angles(0, headingToYaw(heading), 0));
}
