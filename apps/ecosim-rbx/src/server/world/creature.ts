import { CollectionService } from "@rbxts/services";
import type { Archetype } from "../brain/actor";
import { ARCHETYPES } from "../brain/archetypes";
import { packedToColor3 } from "./color";
import { pixelsToStuds, simToWorld } from "./scale";
import { ACTOR_ID_ATTRIBUTE, ACTOR_TAG, CreatureSprite } from "./sprite";
import { type CreatureVisuals, createCreatureVisuals } from "./visuals";

/**
 * Density scale applied to `mass / radius^3` so the three archetypes keep
 * ecosim's 1:5:1 mass ratio while staying inside Roblox's density range.
 */
const DENSITY_SCALE = 0.14;

/** A newly built creature: its sprite facade and its floating widgets. */
export interface SpawnedCreature {
  readonly sprite: CreatureSprite;
  readonly visuals: CreatureVisuals;
}

/**
 * Builds the Roblox part for one creature and wraps it in the facade the
 * simulation drives.
 *
 * @param container - Instance the part is parented to.
 * @param archetype - Which creature kind to build.
 * @param actorId - Engine id stamped onto the part as an attribute.
 * @param x - Spawn position along simulation x, in pixels.
 * @param y - Spawn position along simulation y, in pixels.
 * @param heading - Initial heading in radians.
 * @returns The sprite facade and the creature's visuals.
 */
export function spawnCreature(
  container: Instance,
  archetype: Archetype,
  actorId: number,
  x: number,
  y: number,
  heading: number
): SpawnedCreature {
  const config = ARCHETYPES[archetype].physics;
  const radiusStuds = pixelsToStuds(config.radius * config.scale);

  const part = new Instance("Part");
  part.Name = `${archetype}_${actorId}`;
  part.Shape = Enum.PartType.Ball;
  part.Size = new Vector3(radiusStuds * 2, radiusStuds * 2, radiusStuds * 2);
  part.Color = packedToColor3(config.color);
  part.Material = Enum.Material.SmoothPlastic;
  part.Anchored = false;
  part.CanCollide = true;
  part.TopSurface = Enum.SurfaceType.Smooth;
  part.BottomSurface = Enum.SurfaceType.Smooth;
  part.CustomPhysicalProperties = new PhysicalProperties(
    (DENSITY_SCALE * config.mass) / (radiusStuds * radiusStuds * radiusStuds),
    config.friction,
    config.restitution
  );
  part.CFrame = new CFrame(simToWorld(x, y, radiusStuds));
  part.SetAttribute(ACTOR_ID_ATTRIBUTE, actorId);
  part.Parent = container;
  CollectionService.AddTag(part, ACTOR_TAG);
  part.SetNetworkOwner(undefined);

  return {
    sprite: new CreatureSprite(part, config.mass, heading),
    visuals: createCreatureVisuals(part, radiusStuds),
  };
}
