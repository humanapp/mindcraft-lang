# Default Wandering

A fallback movement pattern for when no other rules fire.

Place a wander rule at the bottom of the rule list with an empty WHEN side.
The actor moves forward and occasionally turns to explore the environment.

## Rules

```brain
[{"when":[],"do":["tile.actuator->actuator.move","tile.modifier->modifier.movement.forward"]}]
```

```brain
[{"when":["tile.sensor->sensor.timeout"],"do":["tile.actuator->actuator.turn"]}]
```

## Tips

- The first rule has an empty WHEN side so it fires every frame, keeping the
  actor moving.
- The timeout rule periodically changes direction to avoid movine in a straight
  line forever.
- These rules should be the lowest priority -- place them at the bottom of the
  rule list so any detection or reaction rules take precedence.

## See Also

`tile:tile.sensor->sensor.timeout`
`tile:tile.actuator->actuator.move`
`tile:tile.actuator->actuator.turn`
`tile:tile.modifier->modifier.movement.toward`
