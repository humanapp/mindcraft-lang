# Eat

Attempts to consume an adjacent actor.

Place `tile:tile.actuator->actuator.eat` on the DO side to eat a nearby actor.
The target must be close enough to consume. Carnivores eat herbivores;
herbivores eat plants.

## Example

```brain
[{"when":["tile.sensor->sensor.bump","tile.modifier->modifier.actor_kind.plant"],"do":["tile.actuator->actuator.eat"]}]
```

This rule eats a plant when the actor bumps into one.

## See Also

- `tile:tile.sensor->sensor.bump`
- `tile:tile.sensor->sensor.see`
- `tile:tile.modifier->modifier.distance.nearby`
- `tile:tile.modifier->modifier.actor_kind.plant`
- `tile:tile.modifier->modifier.actor_kind.herbivore`
