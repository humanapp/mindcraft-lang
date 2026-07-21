<!-- Last reviewed: 2026-07-17 -->

# Project Rules

This file is a pointer, not the rule set. Before any work, read `AGENTS.md` in
full, then list `.github/instructions/` and read `global.instructions.md` plus
every instruction file whose `applyTo` glob matches the area you are touching.

`global.instructions.md` is the canonical home of the comment guidelines, the
ASCII-only rule, the zero-noise check policy, the display-prose test rule, and
the broad-view rule. Package-specific rules live in the other
`*.instructions.md` files -- for example `core.instructions.md` for
`packages/core` (multi-target build, Roblox-TS gotchas) and
`ui.instructions.md` for the source-only `packages/ui`.
