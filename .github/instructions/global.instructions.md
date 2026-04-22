---
applyTo: "**"
---

<!-- Last reviewed: 2026-03-09 -->

# GitHub Copilot Instructions

## Code Examples and Documentation

**NEVER create example .ts files in the project src folder.**

If you choose to create ad-hoc feature documentation or example files, they must be placed in a folder called `generated-docs/` in the project root to clearly indicate non-source, auto-generated status. **Never place example or documentation files in any `src/` folder.**. And, always include the date of creation in the file name, e.g., `example-feature-2024-06-15.ts` or `docs-feature-2025-01-31.md`.

## Comments in Source Files

**Do not add rationale or explanatory comments to source files.** Comments that explain why a file is structured a certain way, why a refactor was done, or what constraints drove a design decision do not belong in source code. The code should speak for itself, and historical rationale belongs in commit messages or design docs -- not inline.

Examples of comments to avoid:

- `// extracted to its own file so that Foo.tsx only exports components`
- `// moved here to avoid circular dependency`
- `// refactored from X to satisfy Y constraint`

Only add comments where the logic itself is non-obvious and a reader would genuinely benefit from a brief hint.

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
