```brain noframe do
{ "tile": "tile.actuator->actuator.say" }
```

# Say

Displays a text bubble above the actor.

---

Place `tile:tile.actuator->actuator.say` on the DO side to show a message.
Set the text by editing the tile's value. The bubble appears for a short time.

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
      "children": []
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

_Say "Bumped!" when bumping another actor._

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| 

## See Also

`tile:tile.sensor->sensor.see`
`tile:tile.sensor->sensor.bump`
