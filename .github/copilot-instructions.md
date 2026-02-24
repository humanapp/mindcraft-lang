<!-- Last reviewed: 2026-02-22 -->
<!-- Sync: Multi-Target Core rules duplicated in .github/instructions/core.instructions.md -->

# Copilot Instructions

These instructions apply to all Copilot features, including inline tab completions.

## Code Quality

- Never emit placeholder code. Do not use `TODO`, `FIXME`, `...`, `/* implementation */`,
  `throw new Error("Not implemented")`, or any other stub pattern unless the user has
  explicitly written a stub and is asking to fill it in.
- Never produce non-production statements such as `console.log("test")`,
  `console.log("here")`, hardcoded magic strings used only for debugging, or temporary
  workarounds presented as real code.
- Complete functions fully. If a complete implementation cannot be inferred from context,
  suggest the minimal correct skeleton rather than a placeholder body.
- Do not add comments that just restate what the code does. Only include comments that
  explain non-obvious intent, invariants, or constraints.
- Do not suggest comments in new code blocks that say things like "// no implementation yet, but could add things like `this` or `that`...". This is not helpful. It is better to leave it blank or with a minimal concrete code suggestion.

## Project-Specific Rules

### Multi-Target Core (`packages/core`)

- Avoid Node.js-only or browser-only APIs in shared code under `packages/core/src`.
- Prefer `List` and `Dict` from `packages/core/src/platform` over native `Array` and `Map`.
- Use `unknown` or specific types instead of `any`.
- Do not use the global `Error` class in shared code; import `Error` from
  `../../platform/error` (or the equivalent relative path).
- Do not use `typeof x === "string"` etc.; use `TypeUtils.isString()`,
  `TypeUtils.isNumber()`, `TypeUtils.isBoolean()` from `platform/types.ts`.
- Do not use Luau reserved words as identifiers: `and`, `break`, `do`, `else`, `elseif`,
  `end`, `false`, `for`, `function`, `if`, `in`, `local`, `nil`, `not`, `or`, `repeat`,
  `return`, `then`, `true`, `until`, `while`.
- Do not use `globalThis` in shared code; it is only allowed in `.node.ts` platform files.

### Text and Comments

- Use only ASCII characters in comments, documentation, and log strings.
  - Use `->` not Unicode arrow, `--` not em-dash, `-` not bullet characters.
