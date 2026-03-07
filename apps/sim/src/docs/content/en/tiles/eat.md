```brain noframe do
{
  "tileId": "tile.actuator->actuator.eat",
  "catalog": []
}
```

# Eat

Consume energy from the target actor.

---

Place `tile:tile.actuator->actuator.eat` on the DO side to take a bite of another actor. This action consumes some of the target actor's energy. If the target's energy goes to zero, they will die.

**Eat** has a cooldown period. An actor won't be able to continuously eat every frame.

Carnivores may eat only herbivores; herbivores may eat only plants.

## Example

```brain
[{"when":["tile.sensor->sensor.bump","tile.modifier->modifier.actor_kind.plant"],"do":["tile.actuator->actuator.eat"]}]
```

This rule eats a plant when the actor bumps into it.

## See Also

`tile:tile.sensor->sensor.bump`
`tile:tile.sensor->sensor.see`
`tile:tile.modifier->modifier.actor_kind.plant`
`tile:tile.modifier->modifier.actor_kind.herbivore`
`tile:tile.modifier->modifier.actor_kind.carnivore`
