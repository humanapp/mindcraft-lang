```brain noframe when
{
  "tileId": "tile.out->boolean:<boolean>.shot fired",
  "catalog": []
}
```

# The shot fired

True when the `shoot` call just made actually launched a blip, and false when it
launched nothing because the rate cooldown was still running, the shooter could
not pay the energy, or the world had no blip to give.

---

Place `tile:tile.out->boolean:<boolean>.shot fired` in the rule that shoots or in
any rule below it. Every `shoot` call sets it, so a creature can count the blips
it really sent instead of the times it tried.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.see",
        "tile.modifier->modifier.actor_kind.carnivore"
      ],
      "do": [
        "tile.actuator->actuator.shoot"
      ],
      "children": [
        {
          "version": 1,
          "when": [
            "tile.out->boolean:<boolean>.shot fired"
          ],
          "do": [
            "tile.actuator->actuator.turn",
            "tile.modifier->modifier.turn.around"
          ],
          "children": [],
          "comment": "Turn around, but only on the thinks a blip really went out."
        }
      ],
      "comment": "Shoot at every carnivore in sight."
    }
  ],
  "catalog": []
}
```

## See Also

`tile:tile.actuator->actuator.shoot`
`tile:tile.parameter->parameter.rate`
