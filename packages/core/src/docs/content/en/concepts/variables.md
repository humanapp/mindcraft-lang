# Variables

Variables let a brain store a value and read it back in a later rule or a later frame.

## Creating a Variable

Place a **variable factory tile** on the DO side of a rule. The factory tile creates the variable
and gives it its initial value when the rule fires for the first time.

The factory tile appears in the tile picker under the Variables section when you right-click.

## Reading a Variable

Once a variable is declared, it appears as a named tile in the tile picker.
Place the variable tile on the WHEN or DO side of any rule to read its current value.

## Writing to a Variable

Use the `tile:tile.op->assign` operator to update a variable's value.
Put the variable tile on the left and a value expression on the right.

```brain
[{"when":[],"do":["tile.op->assign"]}]
```

## Variable Scope

Variables belong to a single brain and are not shared between actors.
Each actor instance has its own copy of every variable.

## Persistence

Variable values persist across frames. A value written in one frame is still there on the next frame,
unless the variable is reassigned.

## Tips

- Use variables to count events (e.g., how many times an actor has eaten this page).
- Use variables as flags -- assign 1 when something happens, check `> 0` in a later rule.
- Reset variables by assigning `0` or `false` on a page-enter rule.
