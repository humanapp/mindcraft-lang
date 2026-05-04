When kicking off a work phase, this prompt is a useful framing:

---

Implement Phase L1 of the TS VM Page Lifecycle Hooks spec at [docs/specs/features/ts-vm-page-lifecycle-hooks-2026-05-03.md](docs/specs/features/ts-vm-page-lifecycle-hooks-2026-05-03.md).

**Before writing any code:**

1. Read the spec end-to-end. Pay particular attention to `## Lifetime Contract`, `## Key Invariants`, `## Pinned Decisions`, and the `## Phase L1` section. Do not re-litigate any pinned decision -- if implementation conflicts with one, STOP and present the conflict.
2. List `.github/instructions/` and read `global.instructions.md` plus the area-specific files: `core.instructions.md`, `brain.instructions.md`, `vm.instructions.md`. Re-read them; don't rely on already being in context.
3. Read [docs/specs/features/ts-vm-dense-runtime-state-plan-2026-05-02.md](docs/specs/features/ts-vm-dense-runtime-state-plan-2026-05-02.md)'s `## Workflow Convention` section -- this spec inherits its loop verbatim, including the Phase Log 15-line cap and the rule that post-mortems happen only when the user declares the unit complete.
4. Confirm prerequisite: dense-state plan D0 and D1 are landed. The `services.action` (`ensureCallsite` / `getStateSlot` / `setStateSlot`) and `services.callSite` (`getHostState` / `setHostState`) adapters exist in [packages/core/src/runtime/dense-shims.ts](packages/core/src/runtime/dense-shims.ts). If not, STOP.

**Then execute Phase L1 only:**

- Run the "Audit step" first. Record the inspection commit SHA + any source-path drift + the ts-compiler initializer-emission file/function pin in the L1 phase log entry you'll draft (but do not commit the phase log entry yet -- it lands during the post-mortem after I declare the unit complete).
- Follow the L1 procedure (9 steps). The tree must compile after each step.
- Implement all 10 regression tests under `## Regression tests`. They must all pass.
- The unit gate is the full chain from `packages/core`: `npm run typecheck && npm run check && npm test && npm run build`. Plus the same four gates from `apps/sim`. `npm run build` is mandatory -- it is the only thing that catches Roblox-ts / Luau incompatibilities.

**Constraints to honor proactively (don't fix reactively):**

- Multi-target core: `List<T>` / `Dict<K, V>` from `packages/core/src/platform`, no native `Array` / `Map`, no `Object.freeze`, no `globalThis`, no Luau reserved words, import `Error` from `../platform/error`.
- Zero-noise policy for `npm run check`: any output beyond the summary line is a failure. Write code that doesn't trigger biome rules in the first place; do not rely on `--write` to auto-fix.
- No placeholder code, no `TODO` / `FIXME`, no debug `console.log`. No phase markers in shipped code.
- Do not edit anything under `apps/sim`; sim is exercised only as a downstream gate.

**Stop conditions:**

- After completing all L1 procedure steps and confirming both gate runs pass, STOP. Present the work for review with: list of files changed, summary of behavior change, regression test output, and both gate runs' summary lines. Do **not** write the Phase Log entry, update Current State, or write a repo memory note. Those are post-mortem artifacts that only land when I say "Run post-mortem for L1."
- If you hit a conflict with a Pinned Decision, an Inherited Rule, or a Key Invariant, STOP and ask. Do not autonomously reverse a design decision.

Begin with the audit step.
