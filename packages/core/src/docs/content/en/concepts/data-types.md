# Data Types

The brain language supports several data types:

## Number

Numeric values used for counting, measuring, and arithmetic.
Number literals can be typed directly (e.g. `42`, `3.14`).

## Boolean

True or false values used in conditions and logic.
Boolean tiles represent yes/no states.

## String

Text values used for display and identification.

## Variables

Variables store values that persist across frames.
Create a variable by placing a variable factory tile on the DO side.
Read its value by placing the variable tile on either side.
Assign a value with `tile:tile.op->assign`.

## Operators

Use arithmetic operators (`tile:tile.op->add`, `tile:tile.op->sub`, `tile:tile.op->mul`, `tile:tile.op->div`)
and comparison operators (`tile:tile.op->eq`, `tile:tile.op->lt`, `tile:tile.op->gt`)
to compute and compare values.
