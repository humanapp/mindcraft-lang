```brain noframe when
{
  "tileId": "tile.sensor->sensor.bump",
  "catalog": []
}
```

# Bump

Fires when this actor collides with another actor.

---

Place `tile:tile.sensor->sensor.bump` on the **WHEN** side of a rule to detect contact with other actors. Add entity type modifiers to filter to specific kinds of actors.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.bump",
        "tile.modifier->modifier.actor_kind.carnivore"
      ],
      "do": [
        "tile.actuator->actuator.move",
        "tile.modifier->modifier.movement.awayfrom",
        "tile.modifier->modifier.quickly",
        "tile.modifier->modifier.quickly",
        "tile.modifier->modifier.quickly"
      ],
      "children": [],
      "comment": "If a carnivore bumps me, flee!"
    }
  ],
  "catalog": [
    {
      "version": 2,
      "kind": "literal",
      "tileId": "tile.literal->string:<string>->yikes!",
      "valueType": "string:<string>",
      "value": "yikes!",
      "valueLabel": "yikes!",
      "displayFormat": "default"
    },
    {
      "version": 2,
      "kind": "literal",
      "tileId": "tile.literal->number:<number>->0.5[time_seconds]",
      "valueType": "number:<number>",
      "value": 0.5,
      "valueLabel": "0.5",
      "displayFormat": "time_seconds"
    }
  ]
}
```

## Modifiers

| Modifier | Description |
|------|------|
|`tile:tile.modifier->modifier.actor_kind.plant` | Only fire if bumping a plant|
|`tile:tile.modifier->modifier.actor_kind.herbivore` | Only fire if bumping a herbivore|
|`tile:tile.modifier->modifier.actor_kind.carnivore` | Only fire if bumping a carnivore|

## See Also

`tile:tile.sensor->sensor.see`
`tile:tile.actuator->actuator.eat`
`tile:tile.actuator->actuator.move`
`tile:tile.actuator->actuator.turn`
`tile:tile.actuator->actuator.say`
