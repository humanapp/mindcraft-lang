# How Rules Work

Rules are the basic unit of brain logic. Each rule has two sides:

- **WHEN** -- the condition tiles that must be satisfied
- **DO** -- the action tiles that execute when the condition passes

Rules execute in order from top to bottom on every simulation frame.
Every rule whose condition is satisfied runs its actions -- not just the first one.
A rule that does not match is simply skipped for that frame, and the next rule is checked.

## Rule Order

Because the list runs top to bottom, a rule lower down acts after the ones above it.
Indent a rule under another to create a child rule -- it only runs when its parent's condition is also true.

## Empty WHEN Side

If the WHEN side has no tiles, the rule always fires every frame. This is useful for default behaviors like wandering.
