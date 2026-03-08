```brain noframe when
{
  "tileId": "tile.modifier->modifier.actor_kind.herbivore",
  "catalog": []
}
```

# Herbivore

Filters detection to herbivore actors only.

---

Attach `tile:tile.modifier->modifier.actor_kind.herbivore` to a sensor or actuator
to restrict it to herbivores. Herbivores eat plants and are eaten by carnivores.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.herbivore", "tile.modifier->modifier.distance.faraway"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.movement.toward"]}]
```

_Move toward a distant herbivore._

## See Also

`tile:tile.modifier->modifier.actor_kind.carnivore`
`tile:tile.modifier->modifier.actor_kind.plant`
`tile:tile.sensor->sensor.see`
`tile:tile.sensor->sensor.bump`
