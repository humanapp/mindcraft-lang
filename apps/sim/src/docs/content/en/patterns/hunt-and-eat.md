# Hunt and Eat

A basic predator pattern for finding prey and consuming it.

The actor searches for prey, moves toward it, and eats it on contact.
Two rules work together: one to approach and one to consume.

## Rules

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.see",
        "tile.modifier->modifier.actor_kind.herbivore",
        "tile.modifier->modifier.distance.nearby"
      ],
      "do": [
        "tile.actuator->actuator.move",
        "tile.modifier->modifier.movement.toward",
        "tile.modifier->modifier.quickly"
      ],
      "children": []
    }
  ],
  "catalog": []
}
```

```brain
[{"when":["tile.sensor->sensor.bump","tile.modifier->modifier.actor_kind.herbivore"],"do":["tile.actuator->actuator.eat"]}]
```

## Tips

- Place the bump/eat rule above the see/move rule so the actor eats immediately
  on contact rather than continuing to chase.
- Add a wandering rule below these so the actor explores when no prey is visible.
- Herbivores can use the same pattern with `tile:tile.modifier->modifier.actor_kind.plant`
  to forage for food.

## See Also

`tile:tile.sensor->sensor.see`
`tile:tile.sensor->sensor.bump`
`tile:tile.actuator->actuator.move`
`tile:tile.actuator->actuator.eat`
`tile:tile.modifier->modifier.actor_kind.herbivore`
`tile:tile.modifier->modifier.distance.nearby`
`tile:tile.modifier->modifier.movement.toward`
`tile:tile.modifier->modifier.quickly`
