# Bump

Fires when this actor collides with another actor.

Place `tile:tile.sensor->sensor.bump` on the WHEN side to react to contact.
Combine with entity type modifiers to respond only to specific kinds of actors.

## Example

```brain
[{"when":["tile.sensor->sensor.bump","tile.modifier->modifier.actor_kind.carnivore"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.distance.faraway"]}]
```

This rule moves away when bumping into a carnivore.

## See Also

- `tile:tile.sensor->sensor.see`
- `tile:tile.actuator->actuator.eat`
- `tile:tile.actuator->actuator.move`
- `tile:tile.actuator->actuator.say`
- `tile:tile.actuator->actuator.turn`
