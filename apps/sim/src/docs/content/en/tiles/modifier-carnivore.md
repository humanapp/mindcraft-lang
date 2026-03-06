# Carnivore

Filters detection to carnivore actors only.

Attach `tile:tile.modifier->modifier.actor_kind.carnivore` to a sensor or actuator
to restrict it to carnivores. Carnivores are predator actors that eat herbivores.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.carnivore"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.movement.awayfrom"]}]
```

This rule flees from visible carnivores.

## See Also

- `tile:tile.modifier->modifier.actor_kind.herbivore`
- `tile:tile.modifier->modifier.actor_kind.plant`
- `tile:tile.sensor->sensor.see`
- `tile:tile.sensor->sensor.bump`
