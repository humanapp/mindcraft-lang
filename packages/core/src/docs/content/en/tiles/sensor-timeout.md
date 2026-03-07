```brain noframe when
{
  "tileId": "tile.sensor->sensor.timeout",
  "catalog": []
}
```

# Timeout

Fires after a specified number of seconds have elapsed.

---

Place `tile:tile.sensor->sensor.timeout` on the WHEN side to create time-based behavior.
Set the duration by editing the tile's value. The timer resets each time the page is entered.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.timeout",
        "tile.literal->number:<number>->5[time_seconds]"
      ],
      "do": [
        "tile.actuator->switch-page",
        "tile.literal->number:<number>->2"
      ],
      "children": []
    }
  ],
  "catalog": [
    {
      "version": 2,
      "kind": "literal",
      "tileId": "tile.literal->number:<number>->5[time_seconds]",
      "valueType": "number:<number>",
      "value": 5,
      "valueLabel": "5",
      "displayFormat": "time_seconds"
    },
    {
      "version": 2,
      "kind": "literal",
      "tileId": "tile.literal->number:<number>->2",
      "valueType": "number:<number>",
      "value": 2,
      "valueLabel": "2",
      "displayFormat": "default"
    }
  ]
}
```

This rule turns the actor after the timeout period elapses.

## See Also

`tile:tile.sensor->on-page-entered`
`tile:tile.actuator->switch-page`
`tile:tile.actuator->restart-page`
