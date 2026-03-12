```brain noframe do
{ "tile": "tile.actuator->actuator.shoot" }
```

# Shoot

Launch a blip projectile.

---

Place `tile:tile.actuator->actuator.shoot` on the **DO** side of a rule to launch blips. Launching blips consumes energy. If the actor doesn't have enough energy, it will not be able to shoot.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.see",
        "tile.modifier->modifier.actor_kind.carnivore",
        "tile.modifier->modifier.distance.nearby"
      ],
      "do": [
        "tile.actuator->actuator.shoot",
        "tile.parameter->parameter.rate",
        "tile.literal->number:<number>->3"
      ],
      "children": [],
      "comment": "Shoot blips at the nearby carnivore at a rate of 3 per second."
    }
  ],
  "catalog": [
    {
      "version": 2,
      "kind": "literal",
      "tileId": "tile.literal->number:<number>->3",
      "valueType": "number:<number>",
      "value": 3,
      "valueLabel": "3",
      "displayFormat": "default"
    }
  ]
}
```

## Parameters

| Parameter                             | Type   | Description                                              |
| ------------------------------------- | ------ | -------------------------------------------------------- |
| `tile:tile.parameter->parameter.rate` | Number | The per-second rate of fire. Maximum: `5`. Default: `1`. |

## See Also

`tile:tile.sensor->sensor.see`
`tile:tile.actuator->actuator.turn`
`tile:tile.modifier->modifier.actor_kind.carnivore`
`tile:tile.modifier->modifier.actor_kind.herbivore`
