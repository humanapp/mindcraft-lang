```brain noframe when
{
  "tileId": "tile.sensor->otherwise",
  "catalog": []
}
```

# Otherwise

Fires when the rule just above did not.

---

Put `tile:tile.sensor->otherwise` on the **WHEN** side to make a rule the other
half of the rule above it. The two take turns: on every frame the rule above
checks its condition and does not fire, this rule does instead.

That gives you the "this, or else that" shape. Write the interesting case as the
first rule, then write a second rule whose WHEN side is just `otherwise` and
whose DO side is what should happen the rest of the time.

## While the rule above is busy

An action can take time -- scrolling a message, playing a sound, moving somewhere.
A rule that started one has already fired, and it stays fired until that work
finishes. So the `otherwise` rule waits quietly instead of cutting in halfway
through. When the rule above checks its condition again, the two go back to
taking turns.

## Two things to watch for

A rule with an **empty WHEN side** fires on every frame, so an `otherwise` rule
placed under one never gets a turn.

`otherwise` also needs a rule above it at the same level. The very first rule has
nothing above it, so `otherwise` there is marked as a mistake until you add a
rule above it or move it down.

## Making a longer chain

For "this, or else this, or else that", indent the later choices under an
`otherwise` rule. The indented rules only get their turn when the rule above the
`otherwise` did not fire, and among themselves they take turns the same way.

## See Also

`tile:tile.sensor->on-page-entered`
