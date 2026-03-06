# Move `tag:Actuator;color:#11aa11`

Moves the actor in a direction.

Place `tile:tile.actuator->actuator.move` on the **DO** side to make the actor move.
Combine with modifiers to move toward or away from detected actors.

Without modifiers, the actor moves forward in the direction it is facing.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.plant"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.movement.toward"]}]
```

This rule moves toward the seen plant.

## See Also

`tile:tile.actuator->actuator.turn`

`tile:tile.sensor->sensor.see`
