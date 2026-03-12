```brain noframe when
{
  "tileId": "tile.modifier->modifier.actor_kind.carnivore",
  "catalog": []
}
```

# Carnivore

Filters detection to carnivore actors only.

---

Attach `tile:tile.modifier->modifier.actor_kind.carnivore` to a sensor or actuator
to restrict it to carnivores. Carnivores are predator actors that eat herbivores.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.see",
        "tile.modifier->modifier.actor_kind.carnivore"
      ],
      "do": [
        "tile.actuator->actuator.move",
        "tile.modifier->modifier.movement.awayfrom"
      ],
      "children": [],
      "comment": "Flee from visible carnivores."
    }
  ],
  "catalog": []
}
```

## See Also

`tile:tile.modifier->modifier.actor_kind.herbivore`
`tile:tile.modifier->modifier.actor_kind.plant`
`tile:tile.sensor->sensor.see`
`tile:tile.sensor->sensor.bump`
