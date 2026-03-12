```brain noframe do
{ "tile": "tile.actuator->actuator.say" }
```

# Say

Displays a text bubble above the actor.

---

Place `tile:tile.actuator->actuator.say` on the **DO** side of a rule to show a message to show a speech bubble. If you omit something to say, any existing speech bubble will be closed.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.bump"
      ],
      "do": [
        "tile.actuator->actuator.say",
        "tile.literal->string:<string>->Bumped!"
      ],
      "children": [],
      "comment": "Say \"Bumped!\" when bumping another actor."
    }
  ],
  "catalog": [
    {
      "version": 2,
      "kind": "literal",
      "tileId": "tile.literal->string:<string>->Bumped!",
      "valueType": "string:<string>",
      "value": "Bumped!",
      "valueLabel": "Bumped!",
      "displayFormat": "default"
    }
  ]
}
```

## Parameters

| Parameter                                 | Type     | Description                                                                          |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| (anonymous)                               | `Text`   | The text to show in the speech bubble. If omitted, closes the current speech bubble. |
| `tile:tile.parameter->parameter.duration` | `Number` | How long the speech bubble should show, in seconds. Default: `5`                     |

## See Also

`tile:tile.lit.factory->string`
`tile:tile.var.factory->string`
`tile:tile.parameter->parameter.duration`
`tile:tile.sensor->sensor.bump`
