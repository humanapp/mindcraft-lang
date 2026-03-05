# See

Detects other actors visible in front of this actor.

Place `tile:tile.sensor->sensor.see` on the WHEN side to check if another actor is visible.
Combine with modifier tiles like `tile:tile.modifier->modifier.actor_kind.carnivore` or
`tile:tile.modifier->modifier.distance.nearby` to filter what is detected.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.herbivore"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.distance.nearby"]}]
```

This rule moves toward a nearby herbivore when one is seen.

## See Also

- `tile:tile.sensor->sensor.bump`
- `tile:tile.actuator->actuator.move`
- `tile:tile.actuator->actuator.turn`
- `tile:tile.actuator->actuator.shoot`
