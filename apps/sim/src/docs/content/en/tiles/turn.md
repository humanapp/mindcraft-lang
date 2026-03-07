```brain noframe do
{ "tile": "tile.actuator->actuator.turn" }
```

# Turn

Changes the actor's facing direction.

---

Place `tile:tile.actuator->actuator.turn` on the **DO** side of a rule to change facing direction.
Without modifiers, the actor turns continuously around. Combine with modifiers to turn
toward or away from specific actors.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.carnivore"],"do":["tile.actuator->actuator.turn","tile.modifier->modifier.movement.toward"]}]
```

This rule turns the actor away from a visible carnivore.

## Modifiers & Parameters

| Modifier | Description |
|------|---------|
| `tile:tile.modifier->modifier.movement.toward` | Turn toward the target |
| `tile:tile.modifier->modifier.movement.awayfrom` | Turn away from the target |
| `tile:tile.modifier->modifier.turn.around` | Turn around |
| `tile:tile.modifier->modifier.turn.left` | Turn left |
| `tile:tile.modifier->modifier.turn.right` | Turn right |
| `tile:tile.modifier->modifier.direction.north` | Turn north (screen up) |
| `tile:tile.modifier->modifier.direction.south` | Turn south (screen down) |
| `tile:tile.modifier->modifier.direction.east` | Turn north (screen right) |
| `tile:tile.modifier->modifier.direction.west` | Turn north (screen left) |
| `tile:tile.modifier->modifier.quickly` | Turn quickly. Up to three instances of this tile may be added, to increase the effect. |
| `tile:tile.modifier->modifier.slowly` | Turn slowly. Up to three instances of this tile may be added, to increase the effect. |

| Parameter | Type | Description |
|-----------|------|-------------|
| Anonymous Actor | `Actor` | The target to turn toward or away from. If not provided, the best target will be inferred from context. |

## See Also

`tile:tile.actuator->actuator.move`
`tile:tile.sensor->sensor.see`
