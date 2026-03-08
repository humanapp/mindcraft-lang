# Far Away

Modifies a sensor or actuator to prefer distant targets.

---

Attach `tile:tile.modifier->modifier.distance.faraway` to move away from a detected actor
or to filter detection to only faraway actors.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.carnivore", "tile.modifier->modifier.distance.faraway"],"do":["tile.actuator->actuator.move","modifier->modifier.movement.toward"]}]
```

_Move toward a far away carnivore._

## See Also

`tile:tile.modifier->modifier.distance.nearby`
`tile:tile.sensor->sensor.see`
`tile:tile.actuator->actuator.move`
`tile:tile.actuator->actuator.turn`
