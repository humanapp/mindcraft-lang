# Say

Displays a text bubble above the actor.

Place `tile:tile.actuator->actuator.say` on the DO side to show a message.
Set the text by editing the tile's value. The bubble appears for a short time.

## Example

```brain
[{"when":["tile.sensor->sensor.bump","tile.modifier->modifier.actor_kind.herbivore"],"do":["tile.actuator->actuator.say"]}]
```

This rule says something when bumping into a herbivore.

## See Also

- `tile:tile.sensor->sensor.see`
- `tile:tile.sensor->sensor.bump`
