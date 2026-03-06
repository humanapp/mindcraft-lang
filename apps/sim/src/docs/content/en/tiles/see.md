# See `tag:Sensor;color:#aa11aa`

Detects other actors visible in front of this actor.

Place `tile:tile.sensor->sensor.see` on the **WHEN** side of a rule to detect other actors in visible range.
Combine with modifier tiles like `tile:tile.modifier->modifier.actor_kind.carnivore` or
`tile:tile.modifier->modifier.actor_kind.plant` to filter what is detected.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.herbivore","tile.modifier->modifier.distance.nearby"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.movement.toward"]}]
```

This rule moves toward a nearby herbivore in vision range.

## Modifiers

| Tile | Description |
|------|-------------|
| `tile:tile.modifier->modifier.actor_kind.carnivore` | Only see carnivores |
| `tile:tile.modifier->modifier.actor_kind.herbivore` | Only see herbivores |
| `tile:tile.modifier->modifier.actor_kind.plant` | Only see plants |
| `tile:tile.modifier->modifier.distance.nearby` | Filter seen actors by distance. Up to three instances of this tile may be added, to increase the effect. |
| `tile:tile.modifier->modifier.distance.faraway` | Filter seen actors by distance. Up to three instances of this tile may be added, to increase the effect. |


## See Also

`tile:tile.sensor->sensor.bump`
`tile:tile.actuator->actuator.move`
`tile:tile.actuator->actuator.turn`
`tile:tile.actuator->actuator.shoot`
