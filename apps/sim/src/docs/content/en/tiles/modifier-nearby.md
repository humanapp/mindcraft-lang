# Nearby

Modifies a sensor or actuator to prefer close targets.

Attach `tile:tile.modifier->modifier.distance.nearby` to move toward a detected actor
or to filter detection to only nearby actors.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.plant","tile.modifier->modifier.distance.nearby"],"do":["tile.actuator->actuator.eat"]}]
```

This rule eats when a plant is both visible and nearby.

## See Also

- `tile:tile.modifier->modifier.distance.faraway`
- `tile:tile.sensor->sensor.see`
- `tile:tile.actuator->actuator.move`
- `tile:tile.actuator->actuator.eat`
