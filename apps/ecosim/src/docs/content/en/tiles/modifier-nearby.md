# Nearby

Modifies a sensor or actuator to prefer close targets.

---

Attach `tile:tile.modifier->modifier.distance.nearby` to move toward a detected actor
or to filter detection to only nearby actors.

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
        "tile.actuator->actuator.move",
        "modifier->modifier.movement.awayfrom"
      ],
      "children": [],
      "comment": "Move away from a nearby carnivore."
    }
  ],
  "catalog": []
}
```

## See Also

`tile:tile.modifier->modifier.distance.faraway`
`tile:tile.sensor->sensor.see`
`tile:tile.actuator->actuator.move`
`tile:tile.actuator->actuator.eat`
