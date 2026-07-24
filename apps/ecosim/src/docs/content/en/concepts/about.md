# Mindcraft Ecosystem Sim

A living ecosystem where **carnivores**, **herbivores**, and **plants** compete to survive -- and you program their brains.

Every creature runs a brain built from tiles -- visual blocks that sense the world, make decisions, and take actions. Edit any brain and watch your changes ripple through the ecosystem.

## What does a brain look like?

A brain is a list of rules. Each rule has a **WHEN** side (conditions) and a **DO** side (actions). Here is a rule that makes a carnivore chase nearby herbivores:

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.see",
        "tile.modifier->modifier.actor_kind.herbivore",
        "tile.modifier->modifier.distance.nearby"
      ],
      "do": [
        "tile.actuator->actuator.move",
        "tile.modifier->modifier.movement.toward"
      ],
      "children": []
    }
  ],
  "catalog": []
}
```

And here is a rule that makes a herbivore flee when a carnivore gets close:

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.carnivore","tile.modifier->modifier.distance.nearby"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.movement.awayfrom"]}]
```

Rules are evaluated top-to-bottom. Place important rules (like fleeing) above less urgent ones (like wandering) so they take priority.

## Getting started

1. **Watch.** Let the simulation run. The **Liveliness** score at the top of the sidebar measures overall ecosystem health -- higher is better.
2. **Edit a brain.** Click **Edit Brain** on any creature type. Add tiles to build rules, then close the editor to apply your changes.
3. **Adjust populations.** Use the sidebar sliders to change species counts and see how the balance shifts.
4. **Control time.** The **Time Scale** slider speeds up or slows down the simulation.

## The challenge

Keep all three species alive at once. Carnivores eat herbivores, herbivores eat plants, and plants just grow. If a species dies out, more will spawn -- but can you maximize their liveliness?

## Tips

- A herbivore that flees `tile:tile.modifier->modifier.actor_kind.carnivore` lives much longer than one that wanders blindly.
- The **best** lifespan stat tracks the longest any individual has survived -- try to beat it.
- Use the docs panel (the book icon) to learn about tiles and brain patterns.
