# How Rules Work

Rules are the basic unit of brain logic. Each rule has two sides:

- **WHEN** -- the condition tiles that must all be satisfied
- **DO** -- the action tiles that execute when the condition passes

Rules execute in order from top to bottom on every simulation frame.
The first rule whose condition is satisfied runs its actions.

## Rule Priority

Rules near the top of the list have higher priority.
Indent a rule under another to create a child rule -- it only runs when its parent's condition is also true.

## Empty WHEN Side

If the WHEN side has no tiles, the rule always fires every frame.
Use this sparingly -- it is useful for default behaviors like wandering.
