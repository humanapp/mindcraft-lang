# Timeout

Fires after a specified number of seconds have elapsed.

Place `tile:tile.sensor->sensor.timeout` on the WHEN side to create time-based behavior.
Set the duration by editing the tile's value. The timer resets each time the page is entered.

## Example

```brain
[{"when":["tile.sensor->sensor.timeout"],"do":["tile.actuator->actuator.turn"]}]
```

This rule turns the actor after the timeout period elapses.
