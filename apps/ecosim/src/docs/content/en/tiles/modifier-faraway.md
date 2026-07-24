# Far Away

Modifies a sensor or actuator to prefer distant targets.

---

Attach `tile:tile.modifier->modifier.distance.faraway` to move away from a detected actor
or to filter detection to only faraway actors.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.see",
        "tile.modifier->modifier.actor_kind.carnivore",
        "tile.modifier->modifier.distance.faraway"
      ],
      "do": [
        "tile.actuator->actuator.move",
        "modifier->modifier.movement.toward"
      ],
      "children": [],
      "comment": "Move toward a far away carnivore."
    }
  ],
  "catalog": []
}
```

## See Also

`tile:tile.modifier->modifier.distance.nearby`
`tile:tile.sensor->sensor.see`
`tile:tile.actuator->actuator.move`
`tile:tile.actuator->actuator.turn`
