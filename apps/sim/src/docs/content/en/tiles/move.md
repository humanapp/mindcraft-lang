```brain noframe do
{ "tile": "tile.actuator->actuator.move" }
```

# Move

Tells the actor to move.

---

Place `tile:tile.actuator->actuator.move` on the **DO** side of a rule to make the actor move.
Combine with modifiers to move toward or away from other actors, or move in a specific direction.

Without modifiers, the actor moves forward in the direction it is facing.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.plant"],"do":["tile.actuator->actuator.move","tile.modifier->modifier.movement.toward"]}]
```

_Move toward the seen plant._

## Modifiers & Parameters

| Modifier | Description |
|----------|-------------|
| `tile:tile.modifier->modifier.movement.forward` | Move forward |
| `tile:tile.modifier->modifier.movement.toward` | Move toward the target |
| `tile:tile.modifier->modifier.movement.awayfrom` | Move away from the target |
| `tile:tile.modifier->modifier.movement.avoid` | Move to avoid the target |
| `tile:tile.modifier->modifier.movement.wander` | Wander around the map |
| `tile:tile.modifier->modifier.quickly` | Move quickly. Up to three instances of this tile may be added, to increase the effect |
| `tile:tile.modifier->modifier.slowly` | Move slowly. Up to three instances of this tile may be added, to increase the effect |

| Parameter | Type | Description |
|-----------|------|--------------|
| Anonymous Actor | `Actor` | The target to move toward or away from. If not provided, the best target will be inferred from context. Default: `tile:tile.literal->struct:<actorRef>->it` |
| `tile:tile.parameter->parameter.priority` | `Number` | Priority of this action in relation to other queued movements |


## See Also

`tile:tile.actuator->actuator.turn`
`tile:tile.sensor->sensor.see`
