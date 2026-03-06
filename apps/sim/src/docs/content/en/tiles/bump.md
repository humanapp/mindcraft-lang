# Bump Sensor

Fires when this actor collides with another actor.

Place `tile:tile.sensor->sensor.bump` on the **WHEN** side of a rule to detect contact with other actors. Add entity type modifiers to filter to specific kinds of actors.

### **Example**

```brain
[{"when":["tile.sensor->sensor.bump","tile.modifier->modifier.actor_kind.carnivore"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.movement.awayfrom"]}]
```

This rule moves away when bumping into a carnivore.

### **Modifiers**

| Tile | Desc |
|------|------|
|`tile:tile.modifier->modifier.actor_kind.plant` | Only fire if bumping a plant|
|`tile:tile.modifier->modifier.actor_kind.herbivore` | Only fire if bumping an herbivore|
|`tile:tile.modifier->modifier.actor_kind.carnivore` | Only fire if bumping a carnivore|

### **See Also**

`tile:tile.sensor->sensor.see`
`tile:tile.actuator->actuator.eat`
`tile:tile.actuator->actuator.move`
`tile:tile.actuator->actuator.turn`
`tile:tile.actuator->actuator.say`
