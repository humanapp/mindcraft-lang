# Nearby

Filters a sensor down to creatures WITHIN a distance and drops every creature farther out. It is a hard cut, not a preference: when nothing is inside the distance, the sensor does not fire at all. One nearby keeps creatures within 100 pixels, two within about 71, three within about 58 -- each extra tile divides the squared distance, so the distance itself shrinks by the square root of the count. Three is the most you can stack.

---

Attach `tile:tile.modifier->modifier.distance.nearby` to `tile:tile.sensor->sensor.see` to notice
only the creatures that are close by.

## It is a filter, not a preference

Nearby does not mean "pick the closest one you can find". It draws a line and throws away
everything past it. If the nearest carnivore is 150 pixels away and you asked for nearby, the rule
does not fire -- there is nothing within 100 pixels for it to fire about.

Among the creatures that do get through, the target is the nearest of them.

## Stacking is not linear

| Nearby tiles | Keeps creatures within |
| ------------ | ---------------------- |
| 1            | 100 px                 |
| 2            | about 71 px            |
| 3            | about 58 px            |

A second nearby does not halve 100 to 50. The tile works on the **squared** distance and divides
that by the number of tiles, so the distance you actually get is 100 divided by the square root of
the count: 100, then 100 / sqrt(2) = 70.7, then 100 / sqrt(3) = 57.7.

## Example

```brain
{
  "ruleJsons": [
    {
      "version": 1,
      "when": [
        "tile.sensor->sensor.see",
        "tile.modifier->modifier.actor_kind.carnivore",
        "tile.modifier->modifier.distance.nearby"
      ],
      "do": [
        "tile.actuator->actuator.move",
        "tile.modifier->modifier.movement.awayfrom"
      ],
      "children": [],
      "comment": "Move away from a nearby carnivore."
    }
  ],
  "catalog": []
}
```

## See Also

`tile:tile.modifier->modifier.distance.faraway`
`tile:tile.sensor->sensor.see`
`tile:tile.actuator->actuator.move`
`tile:tile.actuator->actuator.eat`
