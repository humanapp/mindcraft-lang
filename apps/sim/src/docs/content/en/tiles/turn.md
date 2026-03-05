# Turn

Rotates the actor to face a new direction.

Place `tile:tile.actuator->actuator.turn` on the DO side to change facing.
Without modifiers, the actor turns randomly. Combine with modifiers to turn
toward or away from specific actors.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.carnivore"],"do":["tile.actuator->actuator.turn","tile.modifier->modifier.distance.faraway"]}]
```

This rule turns the actor away from a visible carnivore.
