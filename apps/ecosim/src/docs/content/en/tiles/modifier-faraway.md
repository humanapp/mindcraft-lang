# Far Away

Filters a sensor down to creatures AT LEAST a distance away and drops every creature closer in. It is a hard cut, not a preference: when nothing is out that far, the sensor does not fire at all. One far away keeps creatures at least 300 pixels out, two at least about 424, three at least about 520 -- each extra tile multiplies the squared distance, so the distance itself grows by the square root of the count. Three is the most you can stack, and sight stops at 600 pixels, so three leaves only a thin band to look in.

---

Attach `tile:tile.modifier->modifier.distance.faraway` to `tile:tile.sensor->sensor.see` to notice
only the creatures that are off in the distance.

## It is a filter, not a preference

Far away does not mean "pick the most distant one you can find". It draws a line and throws away
everything nearer than it. If the only carnivore around is 200 pixels away and you asked for far
away, the rule does not fire -- nothing is out past 300 pixels for it to fire about.

Among the creatures that do get through, the target is still the **nearest** of them: the nearest
creature that is far enough away.

## Stacking is not linear

| Far away tiles | Keeps creatures at least | Which leaves a band of |
| -------------- | ------------------------ | ---------------------- |
| 1              | 300 px                   | 300 to 600 px          |
| 2              | about 424 px             | 424 to 600 px          |
| 3              | about 520 px             | 520 to 600 px          |

A second far away does not double 300 to 600. The tile works on the **squared** distance and
multiplies that by the number of tiles, so the distance you actually get is 300 times the square
root of the count: 300, then 300 * sqrt(2) = 424.3, then 300 * sqrt(3) = 519.6.

Sight itself reaches only 600 pixels, so each extra tile narrows the band a creature can be spotted
in rather than reaching further out.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.see",
        "tile.modifier->modifier.actor_kind.carnivore",
        "tile.modifier->modifier.distance.faraway"
      ],
      "do": [
        "tile.actuator->actuator.move",
        "tile.modifier->modifier.movement.toward"
      ],
      "children": [],
      "comment": "Move toward a far away carnivore."
    }
  ],
  "catalog": []
}
```

## See Also

`tile:tile.modifier->modifier.distance.nearby`
`tile:tile.sensor->sensor.see`
`tile:tile.actuator->actuator.move`
`tile:tile.actuator->actuator.turn`
