# Plant

Filters detection to plant actors only.

Attach `tile:tile.modifier->modifier.actor_kind.plant` to a sensor or actuator
to restrict it to plants. Plants are stationary and are eaten by herbivores.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.plant"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.distance.nearby"]}]
```

This rule approaches visible plants to forage.
