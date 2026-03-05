# Shoot

Fires a projectile in the direction the actor is facing.

Place `tile:tile.actuator->actuator.shoot` on the DO side to launch a projectile.
The projectile travels forward and interacts with other actors it contacts.

## Example

```brain
[{"when":["tile.sensor->sensor.see","tile.modifier->modifier.actor_kind.herbivore"],"do":["tile.actuator->actuator.shoot"]}]
```

This rule shoots when a herbivore is visible.
