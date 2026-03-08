{
  "tileId": "tile.modifier->modifier.actor_kind.plant",
  "catalog": []
}

# Plant

Filters detection to plant actors only.

---

Attach `tile:tile.modifier->modifier.actor_kind.plant` to a sensor or actuator
to restrict it to plants. Plants are stationary and are eaten by herbivores.

## Example

```brain
[{"when":["tile.sensor->sensor.bump","tile.modifier->modifier.actor_kind.plant"],"do":["tile.actuator->actuator.eat"]}]
```

_Take a bite of the bumped plant._

## See Also

`tile:tile.modifier->modifier.actor_kind.herbivore`
`tile:tile.modifier->modifier.actor_kind.carnivore`
`tile:tile.sensor->sensor.see`
`tile:tile.sensor->sensor.bump`
`tile:tile.actuator->actuator.eat`
