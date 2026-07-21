<!-- Last reviewed: 2026-07-17 -->

# Agent Instructions

These instructions apply to this repository.

Before working in any area of the codebase, list `.github/instructions/` and
read `global.instructions.md` plus any instruction files whose name matches the
area you are working in. `global.instructions.md` is the canonical home of the
comment guidelines, the ASCII-only rule, the zero-noise check policy, the
display-prose test rule, and the broad-view rule; those rules are not repeated
here. Package rules are also not repeated here: `core.instructions.md` covers
the multi-target constraints for `packages/core` (platform containers, Roblox-TS
gotchas), and `ui.instructions.md` covers the source-only shared UI package.

## Command Approvals

- When requesting escalated command approval, include a narrow `prefix_rule`
  when safe and allowed so repeated commands can be approved persistently.
- Do not include a `prefix_rule` for destructive commands, heredocs, or overly
  broad command prefixes.

## Code Quality

- Never emit placeholder code. Do not use `TODO`, `FIXME`, `...`,
  `/* implementation */`, `throw new Error("Not implemented")`, or any other
  stub pattern unless the user has explicitly written a stub and is asking to
  fill it in.
- Never produce non-production statements such as `console.log("test")`,
  `console.log("here")`, hardcoded magic strings used only for debugging, or
  temporary workarounds presented as real code.
- Complete functions fully. If a complete implementation cannot be inferred
  from context, suggest the minimal correct skeleton rather than a placeholder
  body.
- Never use inline `import()` type expressions in `.ts` or `.tsx` files; use a
  top-level `import type` statement instead. Exception: `.d.ts` ambient
  declaration files and Roblox `.rbx.ts` platform shims where top-level imports
  would break the ambient module context.
