---
applyTo: "**"
---

<!-- Last reviewed: 2026-07-17 -->

# Global Instructions

These rules apply to every agent working anywhere in this repository. This file
is the canonical home of the comment guidelines, the ASCII-only rule, the
zero-noise check policy, the display-prose test rule, and the broad-view rule.

## Code Examples and Documentation

Never create example source files in a project's `src` folder.

If creating ad-hoc feature documentation or example files, place them in a
`generated-docs/` folder at the project root to clearly indicate non-source,
auto-generated status. Include the creation date in the file name, for example
`example-feature-2026-05-10.ts` or `docs-feature-2026-05-10.md`.

## Comments in Source Files

This codebase is used for teaching, so API documentation is desired. Document
exported types, functions, classes, and non-trivial fields with JSDoc that
explains what they are and how to use them, so a reader can understand the code
without external context.

What to write:

- JSDoc on exported symbols, including types, interfaces, classes, functions,
  and public methods, describing purpose, inputs, outputs, and invariants.
- Field-level JSDoc on non-obvious properties, including units, formats,
  allowed values, and nullability semantics.
- Brief inline comments where the logic itself is non-obvious and a reader
  would genuinely benefit from a hint about intent or an invariant.

What not to write:

- Rationale or history-lesson comments. Do not explain why a file is structured
  a certain way, why a refactor was done, or what constraints drove a past
  design decision.
- Comments that just restate what the code literally does.
- Stub-style placeholders like `// no implementation yet, but could add things
  like ...`.

Avoid design-justification comments that explain why the current shape was
chosen rather than what it is. A reader who has never seen the alternative gains
nothing from them.

Treat the following phrasings as red flags in JSDoc on exported symbols and
delete them when they introduce design rationale:

- "... so that ..."
- "... rather than ..." when comparing the chosen design to an alternative
- "... instead of ..." when comparing the chosen design to an alternative
- "... not a ... -- ..."
- "... is exposed because ..."
- "... was chosen ..."

Removal test: cover the comment with your hand and re-read the code. If a
reader cannot figure out what the field or function is, or how to use it
correctly, without the comment, keep it. If covering the comment only removes
justification of the current design, delete it.

Scope each comment to its own symbol. Document what the symbol is, its inputs,
outputs, and errors -- nothing about what it is not, or what a different symbol
does. Do not redirect the reader to another API for a related-but-different
task, and do not contrast this symbol with an alternative. Phrasings like "to do
X instead, use `Y`", "use `Y` to ...", or "unlike `Y`, this ..." pull in scope
the reader did not ask about and invite tangential questions ("can this not do
X?", "what is `Y`?"). A cross-reference is justified only when a reader cannot
use this symbol correctly without it -- a required companion call or a
precondition established elsewhere -- and then state it as a plain instruction
("call `init()` first"), never as a contrast or a redirect to alternative
functionality.

- Avoid: `Compiles and links a brain. To run one instead, use createBrain().`
- Avoid: `Builds the image without constructing a runtime.`
- Prefer: `Compiles and links a brain and returns the linked program. Throws if
  it fails to compile or link.`

## ASCII-Only Text in Comments and Documentation

Use only keyboard-typable ASCII characters in code comments, markdown
documentation, and string literals used for logging or display. Do not use
Unicode arrows, em dashes, bullet characters, box-drawing characters, or other
non-keyboard symbols.

Common substitutions:

- `->` instead of Unicode right arrows
- `<-` instead of Unicode left arrows
- `--` instead of em dash
- `-` instead of en dash, bullet characters, or middle dots
- `|` instead of box-drawing vertical lines
- `-` instead of box-drawing horizontal lines
- `[x]` instead of checkmark emoji
- `[ok]` instead of checkmark symbols

## Communication Style

Avoid excessive agreement and reinforcement phrases such as "You're right!",
"Exactly!", and "Perfect!". Be direct and matter-of-fact in responses. Focus on
providing solutions and information rather than validating statements.

## Generated Files -- Do Not Read

Never read `packages/ts-compiler/src/compiler/lib-dts.generated.ts` when
exploring the codebase. It is a machine-generated file that repackages
TypeScript's `lib.d.ts` as a string constant. It contains no project logic and
is extremely large. Skip it in all searches and explorations.

## After Making Code Changes

After making code changes in this workspace, run `npm run typecheck` and
`npm run check` in the package directory where the files were modified. This
runs TypeScript (type checking) and Biome (linter/formatter) to ensure code
validity and style consistency.

### Zero-Noise Policy for `npm run check`

The passing bar for `npm run check` is the summary line only:

```
Checked N files in Nms. No fixes applied.
```

Any output beyond that line -- errors, warnings, or infos -- means the check has
failed. Infos are not acceptable noise; treat them identically to errors.

Write code that is clean from the first run rather than fixing biome output
reactively. Patterns to avoid proactively:

- `findIndex((v) => v === x)` triggers `lint/complexity/useIndexOf`. When
  testing `findIndex` specifically, use a real predicate (`v > x`,
  `v.startsWith(...)`, etc.) rather than an equality check.
- Arrow callbacks to `forEach` that return a value trigger
  `lint/suspicious/useIterableCallbackReturn`. Use a block body `{ stmt; }`
  instead of an expression arrow.
- `biome check --write` only applies safe auto-fixes. Unsafe fixes are silently
  skipped and leave residual infos. Never rely on `--write` to clean up code
  you wrote.

## Tests Never Key on Display Prose

Static display chrome -- placeholders, labels, button captions, tooltips,
aria-labels, and any other user-facing wording -- is not a test contract.
Do not assert it in tests: wording changes freely and will be localized, and
a test keyed to it breaks without any behavior change.

- Assert structure and behavior instead: the element exists (queried by role
  or a test id), its disabled/enabled state, the callback fired, the value
  produced.
- Dynamic data rendered into output IS assertable: a resolved reference, a
  version, an error code, a file path. These are machine forms produced by
  the behavior under test.
- Error and diagnostic assertions match stable codes, never message prose.

## Broad View Before Acting

Before making any change that touches more than one call site, method
signature, or data flow, read all involved files end-to-end and explicitly
identify every invariant the change must preserve: ordering, symmetry,
consistency across parallel code paths, and structural conventions.

Examples of invariants to check:

- If two methods delegate to the same set of components, they must call them in
  the same order.
- If a refactor introduces a new interface, all implementations must be
  symmetric.
- If a pattern exists across parallel code paths, changes must preserve that
  parallelism.

If a proposed change would violate any identified invariant, reject it and find
an approach that does not.

The goal is not just to fix the immediate problem. Leave the code cleaner and
more coherent than it was found. If the task reveals a structural issue adjacent
to the immediate change, address it as part of the same change when doing so is
within scope.
