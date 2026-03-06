# Move

Moves the actor in a direction.

Place `tile:tile.actuator->actuator.move` on the DO side to make the actor walk.
Combine with distance modifiers to move toward or away from detected actors.

Without modifiers, the actor moves forward in the direction it is facing.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.plant"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.movement.toward"]}]
```

This rule moves toward a visible plant.

## See Also

- `tile:tile.actuator->actuator.turn`
- `tile:tile.sensor->sensor.see`
- `tile:tile.modifier->modifier.movement.toward`
- `tile:tile.modifier->modifier.movement.awayfrom`
