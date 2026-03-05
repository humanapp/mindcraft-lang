# Far Away

Modifies a sensor or actuator to prefer distant targets.

Attach `tile:tile.modifier->modifier.distance.faraway` to move away from a detected actor
or to filter detection to only faraway actors.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.carnivore"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.distance.faraway"]}]
```

This rule moves away from a visible carnivore.

## See Also

- `tile:tile.modifier->modifier.distance.nearby`
- `tile:tile.sensor->sensor.see`
- `tile:tile.actuator->actuator.move`
- `tile:tile.actuator->actuator.turn`
