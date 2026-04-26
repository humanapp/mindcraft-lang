---
applyTo: "**"
---

<!-- Last reviewed: 2026-03-09 -->

# GitHub Copilot Instructions

## Code Examples and Documentation

**NEVER create example .ts files in the project src folder.**

If you choose to create ad-hoc feature documentation or example files, they must be placed in a folder called `generated-docs/` in the project root to clearly indicate non-source, auto-generated status. **Never place example or documentation files in any `src/` folder.**. And, always include the date of creation in the file name, e.g., `example-feature-2024-06-15.ts` or `docs-feature-2025-01-31.md`.

## Comments in Source Files

This codebase is used for teaching, so API documentation is desired. Document
exported types, functions, classes, and non-trivial fields with JSDoc that
explains **what** they are and how to use them, so a reader can understand the
code without external context.

What to write:

- JSDoc on exported symbols (types, interfaces, classes, functions, public
  methods) describing purpose, inputs, outputs, and invariants.
- Field-level JSDoc on non-obvious properties (units, formats, allowed values,
  nullability semantics).
- Brief inline comments where the logic itself is non-obvious and a reader
  would genuinely benefit from a hint about intent or an invariant.

What NOT to write:

- **Rationale or history-lesson comments.** Do not explain why a file is
  structured a certain way, why a refactor was done, or what constraints drove
  a past design decision. That belongs in commit messages or design docs.
- Comments that just restate what the code literally does
  (`// increment i by 1`).
- Stub-style placeholders like
  `// no implementation yet, but could add things like ...`.

Examples of comments to avoid:

- `// extracted to its own file so that Foo.tsx only exports components`
- `// moved here to avoid circular dependency`
- `// refactored from X to satisfy Y constraint`

Also avoid **design-justification** comments that explain why the current
shape was chosen rather than what it is. These read as "what" but are
actually "why we chose this over an alternative." A reader who has never
seen the alternative gains nothing from them.

Examples to avoid:

- `// returned as a URL so clients can fetch without a server round-trip`
- `// optional because callers may not have computed it yet`
- `// stored as a string instead of a number so leading zeros are preserved`
- `// exposed publicly so the listing endpoint can avoid a join`
- `// the URL representation -- not a storage key -- is exposed so ...`

Treat the following phrasings as red flags in JSDoc on exported symbols
and delete them when they introduce design rationale (they are usually
fine inside cross-references like "call `foo()` rather than `bar()`"):

- "... so that ..."
- "... rather than ..." (when comparing the chosen design to an alternative)
- "... instead of ..." (same)
- "... not a ... -- ..."
- "... is exposed because ..."
- "... was chosen ..."

Removal test: cover the comment with your hand and re-read the code. If a
reader cannot figure out **what the field/function is** or **how to use it
correctly** without the comment, keep it. If covering the comment only
removes *justification* of the current design, delete it.

## ASCII-Only Text in Comments and Documentation

**Use only keyboard-typable ASCII characters** in code comments, markdown documentation, and string literals used for logging/display. Do not use Unicode arrows, em dashes, bullet characters, box-drawing characters, or other non-keyboard symbols.

Common substitutions:

- `->` instead of `→`
- `<-` instead of `←`
- `--` instead of `—` (em dash)
- `-` instead of `–` (en dash), `•`, or `·`
- `|` instead of `│` (box-drawing vertical)
- `-` instead of `─` (box-drawing horizontal)
- `[x]` instead of `✅`
- `[ok]` instead of `✓`

## Communication Style

**Avoid excessive agreement and reinforcement phrases** such as "You're right!", "Exactly!", "Perfect!", etc. Be direct and matter-of-fact in responses. Focus on providing solutions and information rather than validating the user's statements.

## Generated Files -- Do Not Read

**Never read `packages/ts-compiler/src/compiler/lib-dts.generated.ts`** when exploring the codebase. It is a machine-generated file that repackages TypeScript's `lib.d.ts` as a string constant. It contains no project logic and is extremely large. Skip it in all searches and explorations.

## After Making Code Changes

After making any code changes in this workspace, always run `npm run typecheck` and `npm run check` in the package directory where the files were modified. This runs TypeScript (type checking) and Biome (linter/formatter) to ensure code validity and style consistency.

## Broad View Before Acting

Before making any change that touches more than one call site, method signature, or data flow, read all involved files end-to-end and explicitly identify every invariant the change must preserve -- ordering, symmetry, consistency across parallel code paths, and structural conventions -- before writing a single line of code.

Examples of invariants to check:

- If two methods delegate to the same set of components, they must call them in the same order.
- If a refactor introduces a new interface (e.g. `physicsTick` / `gameplayTick`), all implementations must be symmetric -- no component gets one method but not the other.
- If a pattern exists across parallel code paths (e.g. plant and animal processing pipelines), changes must preserve that parallelism.

If a proposed change would violate any identified invariant, reject it and find an approach that does not.

The goal is not just to fix the immediate problem -- it is to leave the code cleaner and more coherent than it was found. If the task reveals a structural issue adjacent to the immediate change (fragmented logic, asymmetric patterns, misplaced responsibilities), address it as part of the same change rather than leaving it as-is. A narrowly transactional fix that technically works but worsens the overall structure is not acceptable. Use the sanity check: is the code more coherent after this change than before? If not, reconsider the approach.
