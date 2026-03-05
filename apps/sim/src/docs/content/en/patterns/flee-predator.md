# Flee from Predators

A common survival pattern for herbivores to escape carnivores.

When a carnivore is detected, the actor turns away and moves in the opposite direction.
This pattern should appear near the top of the rule list so it takes priority over
foraging or wandering.

## Rules

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.carnivore"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.distance.faraway"]}]
```

## Tips

- Place this rule above feeding and wandering rules so the actor flees first.
- Combine with `tile:tile.modifier->modifier.distance.nearby` on the WHEN side to
  only flee when the predator is close, saving energy when it is far away.
- Use `tile:tile.actuator->switch-page` to switch to a dedicated "flee" page
  with multiple escape rules.
