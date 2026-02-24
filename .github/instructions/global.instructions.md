---
applyTo: '**'
---
<!-- Last reviewed: 2026-02-22 -->

# GitHub Copilot Instructions

## Code Examples and Documentation

**NEVER create example .ts files in the project src folder.**

If you choose to create ad-hoc feature documentation or example files, they must be placed in a folder called `generated-docs/` in the project root to clearly indicate non-source, auto-generated status. **Never place example or documentation files in any `src/` folder.**. And, always include the date of creation in the file name, e.g., `example-feature-2024-06-15.ts` or `docs-feature-2025-01-31.md`.

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
