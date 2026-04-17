import { type ActorRef, type Context, choice, modifier, optional, repeated, Sensor, type Vector2 } from "mindcraft";

const kNearbyDistanceThreshold = 100;
const kFarAwayDistanceThreshold = 300;

export default Sensor({
  name: "detect",
  icon: "./detect.svg",
  docs: "./detect.md",
  args: [
    optional(
      choice(
        modifier("modifier.actor_kind.carnivore"),
        modifier("modifier.actor_kind.herbivore"),
        modifier("modifier.actor_kind.plant")
      )
    ),
    optional(
      choice(
        repeated(modifier("modifier.distance.nearby"), { max: 3 }),
        repeated(modifier("modifier.distance.faraway"), { max: 3 })
      )
    ),
  ],
  onExecute(
    ctx: Context,
    args: {
      carnivore: boolean;
      herbivore: boolean;
      plant: boolean;
      nearby: number;
      faraway: number;
    }
  ): boolean {
    let archetype: string | null = null;
    if (args.carnivore) {
      archetype = "carnivore";
    } else if (args.herbivore) {
      archetype = "herbivore";
    } else if (args.plant) {
      archetype = "plant";
    }

    let nearbyThresholdSq = kNearbyDistanceThreshold * kNearbyDistanceThreshold;
    let farAwayThresholdSq = kFarAwayDistanceThreshold * kFarAwayDistanceThreshold;
    const nearbyCount = args.nearby;
    const farAwayCount = args.faraway;
    if (nearbyCount > 0) {
      nearbyThresholdSq = nearbyThresholdSq / nearbyCount;
    }
    if (farAwayCount > 0) {
      farAwayThresholdSq = farAwayThresholdSq * farAwayCount;
    }

    const archetypes: string[] = archetype !== null ? [archetype] : ["carnivore", "herbivore", "plant"];

    let closestActor: ActorRef | null = null;
    let closestDistSq = Infinity;

    for (const arch of archetypes) {
      const actors = ctx.engine.getActorsByArchetype(arch);
      for (const actor of actors) {
        if (actor.id === ctx.self.id) continue;
        const dx = actor.position.x - ctx.self.position.x;
        const dy = actor.position.y - ctx.self.position.y;
        const distSq = dx * dx + dy * dy;

        if (nearbyCount > 0 && distSq > nearbyThresholdSq) continue;
        if (farAwayCount > 0 && nearbyCount === 0 && distSq < farAwayThresholdSq) continue;

        if (distSq < closestDistSq) {
          closestDistSq = distSq;
          closestActor = actor;
        }
      }
    }

    if (closestActor === null) {
      return false;
    }

    ctx.rule.setVariable("targetActor", closestActor.id);
    ctx.rule.setVariable("targetPos", closestActor.position);

    return true;
  },
});
