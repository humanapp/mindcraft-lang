# Hunt and Eat

A basic predator pattern for finding prey and consuming it.

The actor searches for prey, moves toward it, and eats it on contact.
Two rules work together: one to approach and one to consume.

## Rules

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.herbivore"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.distance.nearby"]}]
```

```brain
[{"when":["tile.sensor->sensor.bump","tile.modifier->modifier.actor_kind.herbivore"],"do":["tile.actuator->actuator.eat"]}]
```

## Tips

- Place the bump/eat rule above the see/move rule so the actor eats immediately
  on contact rather than continuing to chase.
- Add a wandering rule below these so the actor explores when no prey is visible.
- Herbivores can use the same pattern with `tile:tile.modifier->modifier.actor_kind.plant`
  to forage for food.
