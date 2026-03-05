# Herbivore

Filters detection to herbivore actors only.

Attach `tile:tile.modifier->modifier.actor_kind.herbivore` to a sensor or actuator
to restrict it to herbivores. Herbivores eat plants and are eaten by carnivores.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.herbivore"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.distance.nearby"]}]
```

This rule approaches visible herbivores.

## See Also

- `tile:tile.modifier->modifier.actor_kind.carnivore`
- `tile:tile.modifier->modifier.actor_kind.plant`
- `tile:tile.sensor->sensor.see`
- `tile:tile.actuator->actuator.shoot`
