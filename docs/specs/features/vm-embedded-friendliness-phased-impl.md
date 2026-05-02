# VM Embedded-Friendliness -- Phased Implementation Plan

**Status:** In progress (V0.1 + V1.1 + V1.2 + V1.3 + V1.4 + V2.0 + V2.1 + V2.2 + V3.1 + V3.2 + V4.1 + V4.2 complete)
**Created:** 2026-04-28
**Related:**

- [vm-embedded-hostility-audit-2026-04-27.md](../../../generated-docs/vm-embedded-hostility-audit-2026-04-27.md)
  -- background audit identifying 13 issues
- [vm-embedded-friendliness-plan-2026-04-27.md](../../../generated-docs/vm-embedded-friendliness-plan-2026-04-27.md)
  -- planning doc with per-item analysis, dry-run risks, and the
  fresh review that produced this implementation plan
- [program-tree-shaking-phased-impl.md](program-tree-shaking-phased-impl.md)
  -- tree-shaker remapping pass touched by several phases
- [../core/brain-runtime.md](../core/brain-runtime.md) -- DAP shape
  consumed by `ErrorValue.tag` change

Reshapes the TS VM at `packages/core/src/brain/runtime/vm.ts` to
converge with the eventual C++ MCU implementation. The TS VM is the
_reference implementation_; the C++ MCU VM will be a _faithful but
not line-by-line_ port.

The two VMs share an **implementation contract** (opcode set, operand
semantics, value model, calling convention, error model, feature
flags) but **not** a wire format. Compiled programs intended for the
MCU VM are run through a transform (Phase 5) that emits a binary blob
the C++ VM consumes. The TS VM never round-trips through that binary.

This means: TS-side micro-optimization for its own sake is **out of
scope**. The TS VM does not need C++-class throughput; it needs
shape parity with the C++ port so feature mapping is straightforward.

---

## No Backward Compatibility

Everything in this work is new code. There are **no external
customers**, **no shipped public API to preserve**, and **no
serialized artifacts in the wild** (no on-disk programs, no saved
fault objects, no DAP traces consumed by third parties). The TS VM,
the bytecode it consumes, the brain JSON it loads, the bridge
protocol, and every downstream consumer all live in this monorepo
and are updated in lock-step.

Implications for every unit in this plan:

- **Prefer clean replacements over compatibility bridges.** If a
  type changes shape, change every call site. Do not introduce
  parallel "old" and "new" forms, deprecation aliases, dual-mode
  factories, conversion shims, or "string-or-enum" unions. Delete
  the old form in the same unit that adds the new one.
- **No re-export aliases for renamed symbols.** Rename and update
  imports.
- **No legacy field tolerance in serialization.** Bump the version
  constant and require the new shape; do not accept both.
- **No stringly-typed escape hatches.** When the spec says
  `tag: ErrorCode`, the runtime must not also accept the old string
  literal "for now."
- **Tests assert the new shape directly.** Do not keep old-shape
  fixtures around as a "compatibility check."

Each unit lands as one coherent change. Whether the working tree is
committed between units is up to the user; this plan does not require
commits as a workflow step.

---

## Multi-Target Core Constraints (Roblox-ts portability)

`packages/core` is a multi-target package (Node TS, browser TS,
Roblox-ts/Luau). Every unit in this plan that touches shared core
code under `packages/core/src/brain/` must obey
`.github/instructions/core.instructions.md`:

- **No native `Array` / `T[]` in shared core.** Use `List<T>` from
  `packages/core/src/platform`. This applies to constant pools,
  struct field storage, host-call arg buffers, fields lists -- every
  collection that crosses a public boundary in this plan.
- **No native `Map` / `Set` in shared core.** Use `Dict` / set
  abstractions from `packages/core/src/platform`.
- **No `Object.freeze` / `Object.isFrozen` / `Object.assign` /
  `Object.keys` / etc. in shared core.** `Object` is JS-only.
  Immutability is expressed via `readonly` types and convention. If
  runtime enforcement is required on Node, hide it behind a
  `platform/` shim that no-ops (or maps to `table.freeze`) on Luau.
- **No `Uint8Array` / `Uint32Array` / typed arrays in shared core.**
  These are JS-only. Binary I/O lives behind `IWriteStream` /
  `IReadStream` in `packages/core/src/platform/stream-types.ts`, or
  in Node-only `.node.ts` files (e.g. the V5.2 MCU binary writer).
- **No `typeof x === "string"` / `instanceof Error`.** Use
  `TypeUtils.isString()` etc. from `platform/types.ts`. Throw and
  catch the platform `Error` from `platform/error.ts`, never the
  global `Error`.
- **No `globalThis` in shared core.** Allowed only in `.node.ts`
  files.
- **No Luau reserved words** as identifiers (`end`, `local`, `then`,
  `repeat`, `until`, etc.).

Where a unit below mentions a JS-only construct (`Object.freeze`,
`Value[]`, `Uint8Array`), the inline note clarifies the portable
form. When in doubt, choose the portable form -- the C++ port mirrors
the shape, not the JS specifics.

---

## Workflow Convention

Phases are numbered V0-V5. Units within a phase are numbered V<N>.<M>.

Each unit follows this loop:

1. Copilot implements the unit.
2. Copilot stops and presents work for review.
3. The user reviews, requests changes or approves.
4. Only after the user declares the unit complete does the post-mortem
   happen.
5. Post-mortem updates Status, Current State, propagates new risks to future phases, and writes any useful repo memory notes (`/memories/repo/vm-embed-V<N>.<M>.md`).

Do NOT amend Current State, propagate risks, or create repo
memory notes during implementation.

### Post-mortem content rules

The post-mortem is a forward-looking artifact for future-phase agents,
not a changelog. Be ruthlessly minimal.

**Current State entry for the unit (target: 5-15 lines).** Include only:

- One-sentence summary of what shipped.
- Any new spec section / contract surface added (one line each).
- "Verification: full gate green (N/N tests)." -- nothing more.

Do NOT include: file lists, import bookkeeping, per-test enumeration,
test-construction details, fuzz-test parameters, before/after diffs,
or restatement of deliverables already in the unit's spec section above.

**Risks block.** Include a risk only if it satisfies all three:

1. It is a behavior change a future phase could trip over.
2. It is not already obvious from the unit's spec or the contract doc.
3. It implies a concrete future action (a test to add, an invariant to
   preserve, a follow-up unit).

State each risk in 2-4 lines: what changed, what could go wrong, what
to do about it. No background, no justification of the original design.

**Repo memory note (`/memories/repo/vm-embed-V<N>.<M>.md`, target:
10-25 lines).** Write only if the unit established invariants or owed
work that a future agent must respect. Content categories:

- Invariants the runtime / compiler must preserve (one line each).
- Owed tests or follow-ups with no current enforcement.
- Non-obvious gotchas that would silently break a future phase.

Do NOT write: implementation history, test rewrites, file paths that
are findable by grep, verification commands, or anything that just
restates the spec. If the note has nothing in the three categories
above, do not create it.

**Anti-patterns to avoid in all post-mortem text:**

- Listing every test that was renamed or added.
- Explaining why the chosen design was picked over alternatives.
- Restating "X was deleted, Y was added" for things already covered
  by the unit's spec block.
- Including LCG seeds, operand ranges, exact line counts, or other
  reproduction-level detail.
- Including verification output beyond pass/fail and test count.

Each unit must:

- Compile, type-check, lint, build, and test green at HEAD.
  Run `npm run typecheck && npm run check && npm test && npm run build`
  from `packages/core` (and any downstream package whose API surface
  changed: `apps/sim`, `apps/vscode-extension`, etc.).

  `npm run build` is mandatory, not optional. `npm run typecheck`
  only exercises the Node tsconfig; `npm run build` runs `rbxtsc`
  against the Roblox-ts/Luau target and is the only step that
  catches Luau-incompatible code (`Object.freeze`, `Uint8Array`,
  `globalThis`, native `Array`/`Map`/`Set` in shared core, Luau
  reserved words, etc.) per
  `.github/instructions/core.instructions.md`. A unit that passes
  typecheck + test but fails build is not done.

- Touch compiler + runtime + tests together when the change
  crosses that boundary. Never split "compiler emits new opcode"
  from "runtime handles new opcode" -- intermediate states do not run.
- Update `docs/specs/core/vm-contract.md` as part of the same unit
  when the change is contract-shaping (Phase 1-5 contract sections).
- Have its own test additions. No "tests will follow."

---

## Current State

**V0.1 -- vm-contract.md skeleton:** complete. `docs/specs/core/vm-contract.md`
exists with section headers and per-section pointers to the unit that
fills them in.

**V1.1 -- `ErrorCode` numeric enum:** complete.

- `packages/core/src/brain/interfaces/vm.ts` exports `enum ErrorCode
{ Timeout=1, Cancelled=2, HostError=3, ScriptError=4, StackOverflow=5,
StackUnderflow=6 }` and `errorCodeName(code): string`. No runtime
  freezing (`Object.freeze` is not Luau-portable); immutability of
  the enum-keyed values is by `readonly` typing and convention.
- `ErrorValue.tag` is `ErrorCode` everywhere -- no string-tag
  comparisons remain.
- The VM allocates a fresh `ErrorValue` for every fault, populating
  `message` / `detail` / `site` from the dispatch site. Routed
  through a private `VM.makeError(code, message, opts?)` helper;
  all 11 fault-construction sites in `runtime/vm.ts` go through it.
- `HandleTable.cancel` produces `{ tag: ErrorCode.Cancelled, ... }`.
- `vm-contract.md` "Error model" section is filled in: enum table,
  fault-construction shape, fault-callback shape.
- `docs/specs/features/vscode-authoring-debugging.md` updated: DAP
  `faultInfo` carries numeric `tag` plus `tagName: string`.
- Tests added under `vm.spec.ts -> describe("ErrorCode")`:
  `errorCodeName` matches the prior string-tag form for every code.
- Verification: `npm run typecheck && npm run check && npm test &&
npm run build` all green from `packages/core` (full multi-target
  build including `rbxtsc`). Downstream `apps/sim` and
  `apps/vscode-extension` typecheck unaffected.

**V1.1 amendment (post-V2.2 design pass):** the originally
shipped `VmConfig.richErrors?: boolean` toggle (default `true`,
`false` swapping in canonical pooled `ErrorValue` instances) was
deleted along with the supporting `pooledError(code)` helper,
`POOLED_ERRORS` table, and the four pooled-related tests. The TS
VM always produces rich errors. The C++ MCU port is free to ship
a pooled construction strategy at the port-side level (see the
contract's "Error allocation" subsection); that does not need a
flag in the shared interface or a second profile in the TS test
matrix. The V1.1 entry above reflects the post-deletion state;
the deleted surface is recorded here so a future agent does not
reintroduce it under the same name.

**Plan-doc amendments shipped during V0.1 + V1.1:**

- "No Backward Compatibility" section: clean replacements only;
  no parallel forms, deprecation aliases, dual-mode factories,
  legacy serialization tolerance, or stringly-typed escape hatches.
- "Multi-Target Core Constraints (Roblox-ts portability)" section:
  no native `Array`/`Map`/`Set`, no `Object.*`, no `Uint8Array`, no
  global `Error`, no `globalThis`, no Luau reserved words in shared
  core. Per-unit deliverables now use `List` / `Dict` / `readonly`
  / Node-only `.node.ts` placement where appropriate.
- Unit gate raised to `npm run typecheck && npm run check && npm test
&& npm run build`. `npm run build` is the only step that catches
  Luau-incompat code (it runs `rbxtsc`).

**Risk discovered in V1.1, propagated forward:**

- The original V1.1 implementation used `Object.freeze` directly in
  shared core. `npm run typecheck && npm test` passed but
  `npm run build` failed at `rbxtsc` with `'Object' only refers to a
type, but is being used as a value here`. Fixed by dropping the
  freeze and relying on `readonly` typing. Every subsequent unit
  must run the full gate (build included) before being declared
  done. This is now codified in the Workflow Convention.

Next: V1.2 (delete `BytecodeVerifier`).

**V1.2 -- Delete `BytecodeVerifier`:** complete.

- `BytecodeVerifier` class and `VM.verifier` field removed from
  `runtime/vm.ts`. The compiler is now the sole guarantor of
  bytecode validity.
- `vm-contract.md` gained a `## Trust model` section: bytecode is
  trusted; malformed bytecode surfaces as a `ScriptError` fault on
  the offending fiber; no platform throw escapes `runFiber`.
- Verification: full gate green (630/630 tests).

**Risks discovered in V1.2, propagated forward:**

- The static sync-bytecode-action check (no reachable `YIELD` /
  `AWAIT` / `*_ASYNC` / async `ACTION_CALL` via the `CALL` chain)
  is gone. Runtime `assertCanSuspend` catches at execution time
  but only on paths actually taken. The compiler is now the sole
  build-time guarantor and has no test enforcing it. When
  sync-action emit logic is next touched, add a compiler-side test
  asserting the offending opcodes never appear in a sync bytecode
  action's reachable function set.
- `entryFuncId` / `activationFuncId` bounds for actions that are
  registered but never invoked are no longer checked at VM
  construction. A future compiler bug shipping a dangling action
  registration would only surface when the action is invoked.

Next: V1.3 (stack overflow pre-checks).

**V1.3 -- Stack overflow pre-checks:** complete.

- Capacity violations on the operand stack, frame stack, handler
  stack, handle table, and scheduler fiber pool now signal via an
  `OverflowError` class (`interfaces/vm.ts`, extends platform
  `Error`) that the VM dispatch loop converts into an
  `ErrorCode.StackOverflow` fault. Operand-stack underflow on
  `pop`/`peek` similarly signals via a parallel `UnderflowError`
  class and converts to `ErrorCode.StackUnderflow`.
- `SchedulerConfig` gained `maxFibers` (default 10000); the unused
  `VmConfig.maxFibers` field was removed. `HandleTable.maxHandles`
  is now public readonly.
- `vm-contract.md` "Limits" section filled in (five caps, owners,
  defaults, triggers); both `StackOverflow` and `StackUnderflow`
  rows in the error table are now active.
- Verification: full gate green (636/636 tests; rbxtsc build
  confirms `extends Error` is portable across targets).

**Risks discovered in V1.3, propagated forward:**

- `OverflowError` (and `UnderflowError`) propagate as thrown
  values out of `HandleTable.createPending`,
  `FiberScheduler.spawn`/`addFiber`, and any direct call to
  `vm.pop`/`vm.peek` -- hosts must use `isOverflowError(e)` /
  `isUnderflowError(e)` (or `instanceof`) to distinguish them
  from a generic platform `Error`. Any future host-side capacity
  or underflow check added to these subsystems must use
  `throwOverflow` / `throwUnderflow` for consistency.
- This is the first `extends Error` precedent in shared
  `packages/core/src` code. Any future structured exception
  introduced in shared core should follow the same pattern
  (subclass platform `Error`, expose a `throwX` and `isXError`
  pair, branch the dispatch-loop catch on the new guard).

Next: V1.4 (operator monomorphization audit).

**V2.0 -- Feature-flag audit spike:** complete (read-only).

- Audit results are inlined in the V2.0 unit below: opcode/flag
  table, language-construct/flag table, multi-fiber dependency
  finding, `apps/sim` usage survey.
- Recommendation: drop runtime feature flags entirely; drop
  the `CompileTarget` descriptor; drop the originally planned
  TS-side `MCU_VMCONFIG` preset (V2.2 reduced to a docs-only
  unit that adds a "Recommended caps for memory-constrained
  hosts" subsection to `vm-contract.md`). Capability is implicit
  in what hosts register and what tiles the language exposes;
  per-deployment caps belong in the host's own build, not in a
  shared TS constant.
- Plan amended: V2.2 reduced to a docs-only contract subsection;
  V2.3 removed entirely; Phase V2 header / Background /
  Side-Deliverable / V0.1 / V5.2 cleaned up to drop
  `CompileTarget` references.
- Verification: docs-only unit; no code changes.
- Verification: docs-only unit; no code changes.

**Risks discovered in V2.0, propagated forward:**

- `try` / `throw` / `yield` opcodes have runtime support and tests
  but no compiler emit site today. Any future unit that introduces
  the language tile must decide whether MCU supports it; the
  decision earns a `CompileTarget`-like descriptor only when there
  is a measured reason to forbid it on a real target. Do not
  preemptively add the descriptor.
- Multi-fiber scheduling is unconditional. Any future MCU-related
  work that proposes a single-fiber preset must first justify how
  multi-rule pages would compile (the V2.0 audit shows every
  useful brain has more than one root rule per page).

Next: V2.1 (slot-indexed opcodes).

**V2.1 -- Slot-indexed `LOAD_VAR_SLOT` / `STORE_VAR_SLOT` opcodes:** complete.

- `Op.LOAD_VAR` / `Op.STORE_VAR` replaced by `Op.LOAD_VAR_SLOT` / `Op.STORE_VAR_SLOT` (single `slotId: u16` operand). The dispatch loop calls `ExecutionContext.getVariableBySlot` / `setVariableBySlot` only; no `Dict.get(name)` runs on the variable-access hot path.
- `ExecutionContext.resolveVariable` / `setResolvedVariable` hooks deleted (dead surface; no producer in `packages/` or `apps/`).
- `Brain` storage rewired to `List<Value | undefined>` indexed by slot, plus `Dict<string, number>` name->slot map rebuilt from `Program.variableNames` at program load via `installVariableTable`. Hot-reload copies values forward by name. Name-keyed `setVariable` for unknown names lazy-extends the value list with a host-only slot not addressable from bytecode.
- `vm-contract.md` "Variable access" subsection added under Opcode reference (slot operand, fault on out-of-range, dispatch invariant, host-only lazy-extend); operator-monomorphization paragraph updated to reference `STORE_VAR_SLOT`.
- `.github/instructions/vm.instructions.md` "Variable Resolution" -> "Variable Access"; opcode table row 10-11 renamed; storage shape and lazy-extend semantics documented.
- Verification: full gate green from `packages/core` (643/643 tests; rbxtsc build clean).

**Risks discovered in V2.1, propagated forward:**

- `Brain.initialize()` is now a three-way mix with no documented contract: (a) recompiles + replaces `vm` / `scheduler` / `executionContext` / page indices wholesale; (b) preserves `variables` for surviving names but silently drops host-allocated lazy slots, names dropped from the new program, and any in-flight value the new program has no name for; (c) does not touch `handles`, `enabled`, `interrupted`, `currentPageIndex` / `desiredPageIndex` / `previousPageIndex`, `lastThinkTime`, or `activeRuleFiberIds` (which now hold stale ids into the discarded scheduler). The intended product behavior is hot-reload (preserve user-visible state across a rule edit), so the right fix is to extend the (b) preservation discipline to all runtime state -- not to drop variable preservation. Owed: a follow-up unit that defines a single `Brain` lifecycle contract -- which fields are program-derived (rebuild on `initialize`), which are user-visible state (preserve where the new program supports it, with a documented drop policy for orphans), and which are tick-loop scratch (clear). The unit should also resolve the host-allocated-slot drop case: either pre-register a name via a new `Brain.registerHostVariable(name, initial)` API so the slot is stable across reloads, or formally forbid lazy-extend so the bug surfaces at `setVariable` time instead of silently at the next reload.
  - Sub-note (host-allocated lazy-slot preservation, considered + deferred during V2.1 review): the tactical patch is ~20 lines in `installVariableTable` -- after building the program-derived prefix `[0, N)`, iterate the previous `varSlotByName` and append a fresh slot at the end for each name not already in the new map (skipping `undefined` values so cleared slots GC). Deferred because (a) it codifies a slot-id-stability asymmetry: program-derived slots get stable ids `[0, N)` and are bytecode-addressable; host-preserved slots take whatever index falls after `N` and shift every reload as `N` changes, but that is fine because no `LOAD_VAR_SLOT` operand can target them by design; (b) it introduces a slow leak if a host calls `setVariable` with unique-per-call names (`__transient_${i}`), so the lifecycle unit must pick a policy -- document "names must be stable", cap the host region, or expose `Brain.pruneHostVariables()`; (c) preserved values can be semantically wrong for the new program (same hazard the program-variable preservation already has, just extended to host names -- no general fix, document it); (d) landing it standalone makes variables the _only_ preserved field while `handles` / page indices / `lastThinkTime` / `activeRuleFiberIds` stay unpreserved, deepening the inconsistency rather than resolving it. Land as part of the lifecycle-contract unit, not as a one-off.
- `Brain.variables: List<Value | undefined>` distinguishes "never written" (`undefined`) from "explicitly nil" (`NIL_VALUE`) so name-keyed `getVariable` can return `undefined` for unset slots while bytecode reads always observe `NIL_VALUE`. Future units that touch the storage list (e.g. typed sub-pools in V3) must preserve this two-state invariant or update every `getVariable === undefined` test simultaneously.
- `Program.variableNames` is now load-time-only metadata for the runtime: it sizes the slot table and seeds `varSlotByName`, then is never read on the dispatch path. The MCU binary transform (V5) is free to strip it.

Next: V2.2 (recommended-caps doc subsection).

**V2.2 -- Recommended caps for memory-constrained hosts (docs only):** complete.

- `vm-contract.md` "Limits" section gained a "Recommended caps for memory-constrained hosts" subsection: per-cap entry (`maxStackSize`, `maxFrameDepth`, `maxHandlers`, `maxHandles`, `maxFibers`) covering what to weigh, the fault code raised, and the fault-gate-vs-fixed-array-sizing-input distinction. `maxHandles: 0` is documented as the "forbid async actions" sentinel.
- The `VmConfig.richErrors` toggle, `pooledError(code)` helper, and `POOLED_ERRORS` table introduced in V1.1 were deleted as part of the V2.2 design pass. The TS VM now always allocates a fresh `ErrorValue`; pooled construction is a port-side option documented in the contract's "Error allocation" subsection.
- Verification: full gate green (639/639 tests; rbxtsc build clean).

**Risks discovered in V2.2, propagated forward:**

- The "Recommended caps" subsection currently has no measured numbers. V5.1 owes the cross-linked per-fiber and per-handle byte costs against a representative MCU build; until then the per-cap weighting is ordering-only. A future agent landing V5.1 must come back and replace the "treat as ordering, not absolutes" sentence with the measured anchor values.
- `ErrorValue` is now always rich on the TS VM. Any future host-facing surface (DAP fault frames, bridge fault payloads, scheduler `onFiberFault`) may freely assume `message` / `detail` / `site` are populated. A C++ port that ships pooled-only is contractually allowed to leave them empty; downstream consumers must not crash on missing fields. The contract's "Error allocation" subsection is the single source of truth here.

Next: V3.1 (typed constant pools).

**V3.1 -- Typed constant sub-pools:** complete.

- `vm-contract.md` Value model gained a "Constant pool layout" subsection; opcode reference rows for `PUSH_CONST_NUM` / `PUSH_CONST_STR` / `PUSH_CONST_VAL` updated.
- `.github/instructions/vm.instructions.md` opcode table row 0-5 renamed.
- Verification: full gate green (`packages/core` 639/639, `packages/ts-compiler` 967/967; rbxtsc build clean).

**Risks discovered in V3.1, propagated forward:**

- Cross-pool index aliasing is not enforced. Any future opcode that takes a constant-pool operand must declare which of `numbers` / `strings` / `values` it indexes, and any new linker- or tree-shaker-like pass must remap each sub-pool with its own offset. A wrong-pool operand will silently dereference garbage.
- `INSTANCE_OF` still reads its typeId from the `values` pool as a `StringValue` (legacy carryover), while `LIST_NEW` / `MAP_NEW` / `STRUCT_NEW` / `STRUCT_COPY_EXCEPT` type-name operands index the `strings` pool. V3.3's struct-field opcodes should use `strings` for any new typeId operand; do not extend the `values`-as-string pattern.

Next: V3.2 (stable `fieldIndex` on `StructTypeDef`).

**V3.2 -- Stable `fieldIndex` on `StructTypeDef`:** complete.

- `StructTypeDef.fields` is now `List<StructFieldDef>` where every entry carries an immutable `readonly fieldIndex: number` equal to its position. Registration input is the new `StructFieldInput` (name + typeId + optional readOnly); `fieldIndex` is assigned by the registry, never by callers. All four registration paths (`addStructType`, `reserveStructType` + `finalizeStructType`, `addStructFields` extension) maintain the invariant; `addStructFields` continues numbering from the existing tail.
- `vm-contract.md` Value model gained a "Struct field indices" subsection documenting the invariant and forward-linking V3.3's indexed opcodes.
- Verification: full gate green (`packages/core` 643/643, `packages/ts-compiler` 967/967; rbxtsc build clean).

**Risks discovered in V3.2, propagated forward:**

- The `fieldIndex === position` invariant is preserved by registration discipline, not by structural enforcement. Any future code path that mutates `StructTypeDef.fields` out-of-band (removal, reordering, splicing) will silently break the indexed opcodes V3.3 is about to introduce. New mutation entry points must go through a registry helper that re-runs index assignment, or must be rejected by review.
- `StructValue.v` is still `Dict<string, Value>` for closed structs; the V3.2 invariant only covers the type-system side. V3.3 owes the corresponding value-side change (`List<Value>` indexed by `fieldIndex`) plus the factory rename. Until V3.3 lands, `fieldIndex` has no runtime effect -- do not assume any opcode reads it yet.
- Workflow gap caught during V3.2: agent-introduced drift in `*.spec.ts` mocks (missing `getVariableBySlot` / `setVariableBySlot` after V2.1, stale `visual` tile option after a separate rename) was invisible to `npm run typecheck` because the Node tsconfig excludes spec files and `tsx` test runs do not type-check. Fixed by chaining `tsc --noEmit -p tsconfig.spec.json` into the `typecheck` script of every package that has one (`packages/core`, `packages/app-host`; the others already had it). Future units must keep this chain in place.

Next: V4.1 (new host-call ABI).

**V4.1 -- New host-call ABI:** complete.

- Host calls now use the positional `ReadonlyList<Value>` ABI:
  sync hosts receive an ephemeral stack subview and async hosts
  receive an owned `List<Value>` snapshot; `ACTION_CALL` remains
  MapValue-shaped until V4.2.
- `vm-contract.md` "Calling convention" gained the host-call stack
  layout, sync/async argument lifetime rules, `STACK_SET_REL`, and
  host-call re-entry notes.
- `HostSyncFn` / `HostAsyncFn` now take `ReadonlyList<Value>`;
  `HOST_CALL` / `HOST_CALL_ASYNC` carry only `fnId`, `argc`, and
  `callSiteId`.
- Compiler-emitted host calls use a stack-only positional buffer:
  dense in-order calls remain direct; explicit sparse or
  out-of-order slot maps emit the NIL + `STACK_SET_REL` buffer
  without reserving hidden frame locals or growing
  `FunctionBytecode.numLocals`.
- Verification: full gate green for the implemented ABI
  (1644/1644 tests; `apps/sim` check/typecheck/build clean), plus
  post-amendment `packages/ts-compiler` check/typecheck/test green
  (972/972 tests).

**V4.2 -- Erase runtime `args` object on action calls:** complete.

- Action calls now share the same positional `ReadonlyList<Value>`
  ABI as host calls; sync host actions receive an ephemeral stack
  view and async host actions receive an owned snapshot.
- Bytecode action args are no longer materialized at runtime:
  `args.<name>` lowers directly to positional locals after injected
  `ctx`.
- `vm-contract.md` "Calling convention" now documents action-call
  operand shape, host-bound lifetimes, bytecode frame layout, and
  the absence of per-slot presence metadata.
- Verification: full gate green (1648/1648 tests).

**Risks discovered in V4.2, propagated forward:**

- Action-call slots no longer distinguish "omitted" from "explicit
  nil"; both are `NIL_VALUE` in the positional buffer. Any future UI
  or compiler surface that needs clear-vs-unset semantics must add
  an explicit presence signal instead of inferring it from args.

Next: V3.3 (`STRUCT_GET_FIELD` / `STRUCT_SET_FIELD` indexed opcodes).

---

## Background

The companion planning doc has the full per-item analysis. The
condensed form, by tier:

- **Tier A (do; contract-shaping):** #2 slot vars, #6 indexed struct
  fields, #7 stack-based host ABI, #8 MCU `VmConfig` preset
  (originally proposed as runtime feature flags / compile-time
  capability descriptor; revised in V2.0 down to a cap preset),
  #12 numeric error codes, #13 MCU binary transform.
- **Tier B (small contract decisions):** #5 typed constant sub-pools,
  #10 confirm operator monomorphization is complete.
- **Tier C (TS-side hygiene, no contract value):** #11 delete
  verifier, #9 stack pre-checks (descoped from full rewrite).
- **Tier D (skip in TS, leave to C++):** #1 accessor facade
  (cosmetic), #4 packed `Instr` in TS (transform handles encoding),
  #3 debug-name optional block (transform strips at write time).

Five phases below cover Tier A, B, and the kept parts of C. Tier D
is intentionally omitted.

---

## Side-Deliverable: VM Contract Spec

`docs/specs/core/vm-contract.md` is created in V0.1 and updated in
lock-step by every contract-shaping unit. It is the source of truth
the C++ port consumes. When the spec and the code disagree, the spec
is wrong -- fix it in the same PR.

Sections:

- **Opcode reference.** One row per opcode: mnemonic, numeric code,
  operand widths, stack effect, side effects, fault conditions.
- **Value model.** Tag enum; semantics of each `t`; what crosses the
  host-call boundary; numeric range guarantees.
- **Calling convention.** Frame layout, arg passing, return value,
  re-entrancy rules.
- **Error model.** `ErrorCode` enum, when each code is raised, what
  the host callback receives.
- **Limits.** Default and configurable caps for fibers, handles,
  stack depth, operand widths.
- **Binary format (appendix).** MCU-targeting binary layout. Added
  in Phase 5.

---

## Phase V0 -- Spec scaffold

### Unit V0.1 -- Create `vm-contract.md` skeleton

**Goal:** Establish the spec doc so subsequent units have a concrete
file to update. Pure docs change; CI is green by definition.

**Deliverables:**

- `docs/specs/core/vm-contract.md` with section headers for Opcode
  reference, Value model, Calling convention, Error model, Limits.
- Top banner: "Status: in progress, source of truth as of <ref>."
- Each section body: one-line "Filled in by Phase V<N>." pointer.

**Tests:** None (docs only).

**Spec updates:** N/A (this unit creates the spec).

**Out of scope:** Filling in any actual content. That happens in
later units.

**Exit criteria:** File exists; structure matches the side-deliverable
section above.

---

## Phase V1 -- Contract hygiene

Foundational changes that shrink TS code, add a numeric error
contract, and harden the runtime against malformed bytecode (since
the verifier is going away).

### Unit V1.1 -- `ErrorCode` numeric enum

**Goal:** Replace the string union on `ErrorValue.tag` with a numeric
enum. The TS VM always allocates a fresh `ErrorValue` per fault.

**Roblox-ts note:** `Object.freeze` / `Object.isFrozen` are JS-only and
are not available on Luau. Pooled instances must therefore be:

- typed `readonly` (the type system enforces non-mutation at compile time);
- treated as canonically immutable by convention (callers must not mutate).

If runtime enforcement is desired on Node, gate it behind a
`platform/freeze.ts` shim that is `Object.freeze` on Node/Web and a
no-op (or `table.freeze`) on Luau. Do not call `Object.freeze` directly
from shared core.

**Deliverables:**

- `ErrorCode` enum in `packages/core/src/brain/interfaces/vm.ts`.
- `ErrorValue.tag` becomes `ErrorCode`.
- Pool of canonical immutable `ErrorValue` per code (typed `readonly`,
  not runtime-frozen in shared code); rich-error path allocates.
- Update every consumer as part of this unit:
  - VM dispatch sites in `runtime/vm.ts`.
  - `onFiberFault` callback signature.
  - DAP spec doc (`docs/specs/core/brain-runtime.md`).
  - bridge-protocol clients.
  - `apps/vscode-extension`.
  - Test snapshots that match on string tags.
- `nameOf(code)` / `tagName(code)` helper at the diagnostics
  boundary so error messages remain readable.

**Tests:**

- Unit tests on the pool: same code returns identity-equal canonical
  instance; rich-error mode returns a fresh distinct instance.
- Snapshot test: representative error message renders identical text
  to the prior string-tag form.
- Existing tests continue to pass against the enum (no string
  comparisons left).

**Spec updates:** Fill in `vm-contract.md` "Error model" section with
the enum table and rich-error semantics.

**Out of scope:** Changing what raises which error. Code semantics
are preserved verbatim.

**Hidden risks:**

- `ErrorValue.tag` is exported all the way out (host callbacks, DAP,
  bridge). Every consumer must migrate in this unit.
- Pooled instances are immutable by convention. The `readonly` types
  catch in-source mutation; there is no runtime guard in shared code,
  so any platform-specific deep-freeze (Node `Object.freeze`, Luau
  `table.freeze`) must live behind a platform shim.

**Exit criteria:** All tests green. No string-tag comparisons remain
in the codebase. `ErrorValue.tag` is `ErrorCode` everywhere.

---

### Unit V1.2 -- Delete `BytecodeVerifier`

**Goal:** Remove the verifier. All bytecode is trusted; the compiler
is the sole guarantor of validity.

**Deliverables:**

- Delete `BytecodeVerifier` class
  (`runtime/vm.ts:263-454` at time of writing).
- Delete the constructor's verify call.
- Audit dispatch-time index reads to ensure out-of-bounds access
  faults as `ScriptError`, not as host-level throws. The current
  `List` / `Dict` shims return `undefined` on miss; the dispatch
  loop must check and fault.
- Rewrite or delete tests that asserted specific verifier errors:
  - Tests that were exercising the verifier itself: delete; replace
    with compiler-side tests that assert valid programs are emitted.
  - Tests that assert the runtime degrades gracefully on bad bytecode:
    rewrite to assert `ScriptError` faults instead of verifier
    exceptions.

**Tests:**

- New: a fuzz test that constructs random `Instr` arrays (not raw
  byte sequences -- the TS runtime never decodes a binary buffer)
  and runs them through the VM, asserting no platform-level throw
  escapes (all failures surface as `ScriptError` faults). "Platform
  throw" means the platform `Error` from
  `packages/core/src/platform/error.ts`, not the global JS `Error`.
- New: per-opcode out-of-bounds-operand tests confirming graceful
  fault.

**Spec updates:** None directly (verifier was internal). Note in
the spec's introduction that bytecode is trusted and the runtime
has no verification layer.

**Out of scope:** Adding a replacement verifier behind a flag. There
is no flag; trust is the only mode.

**Hidden risks:**

- Without the verifier, the runtime is the _only_ defense against
  malformed bytecode. Compiler emit becomes the sole guarantor of
  validity -- compiler tests are the new safety net.
- The TS VM consumes `Instr` objects, never a raw byte buffer; "bad
  bytecode" in this unit means a malformed `Instr` array. The
  binary-format reader lives only on the C++ side (the TS writer in
  V5.2 is host tooling).
- `FunctionBytecode.name` was used by verifier error messages; other
  consumers (stack traces, DAP) still use it -- no removal here.

**Exit criteria:** Verifier code gone; fuzz test passes; all
existing tests rewritten to the new model are green.

---

### Unit V1.3 -- Stack overflow pre-checks

**Goal:** Convert silent stack growth into `StackOverflow` faults at
the missing pre-check sites. _Descoped from the original full
fixed-capacity rewrite_ -- only adds the pre-checks; data structures
unchanged.

**Deliverables:**

- Pre-check before push on the frame stack
  (`runtime/vm.ts:940` at time of writing).
- Pre-check before push on the handler stack
  (`runtime/vm.ts:1309` at time of writing).
- Audit operand stack push sites for any other missing pre-checks.
- All overflow paths produce `ErrorCode.StackOverflow` faults
  (using the enum from V1.1).

**Tests:**

- Hand-craft programs that hit `maxFibers`, `maxHandles`,
  `maxStackSize` and assert a `StackOverflow` fault rather than
  silent growth or unbounded allocation.

**Spec updates:** Fill in `vm-contract.md` "Limits" section with
the overflow contract (which caps exist, what fault code is raised
when exceeded).

**Out of scope:** Replacing `List<Value>` with `Value[] + top` for
the operand / frame / handler stacks. Pure TS hygiene with no
contract value -- the C++ port will use `std::array` regardless.

**Hidden risks:** None significant; localized change.

**Exit criteria:** Capacity violations fault cleanly under tests
that previously triggered silent growth.

---

### Unit V1.4 -- Operator monomorphization audit

**Goal:** Confirm that primitive arithmetic never enters a type
registry on the dispatch hot path. Lock the invariant in.

**Deliverables:**

- Test-only counter or instrumentation that records every
  type-registry lookup during dispatch.
- A test that runs a number-heavy benchmark and asserts the counter
  is zero for primitive arithmetic.
- If anything fails the assertion: fix the offending site.
  Otherwise, this unit is documentation + a regression guard.

**Tests:** The counter test itself.

**Spec updates:** Note in `vm-contract.md` "Calling convention" that
arithmetic on primitive `NumberValue` operands is monomorphic and
does not consult the operator overload table.

**Out of scope:** Restructuring how operator overloads are emitted.
The compiler already resolves to `HOST_CALL_ARGS <fnId>`.

**Hidden risks:** None significant; audit-only.

**Exit criteria:** Counter test green; invariant documented.

---

## Phase V2 -- Slot-indexed variable access + recommended-caps doc

Removes the only string-keyed lookup from the dispatch loop (V2.1)
and documents recommended caps for memory-constrained hosts (V2.2,
docs-only). The V2.0 audit ruled out runtime feature flags, a
compile-time target descriptor, and a TS-side `MCU_VMCONFIG`
preset -- capability stays implicit in what the host registers and
what the language exposes; per-deployment caps belong in the host's
own build. Highest-risk phase in V2 is V2.1 because the opcode
shape changes and brain-level variable storage is rebuilt.

### Unit V2.0 -- Feature-flag audit spike (read-only)

**Goal:** Determine the blast radius of each candidate feature flag
before writing code. Read-only investigation. **Blocks V2.2.**

**Deliverables:**

- A written audit (in this spec or as a memory note) mapping each
  candidate flag (`fibers`, `structuredExceptions`, `asyncHandles`)
  to:
  - Which opcodes it gates.
  - Which language constructs (`do {}`, `when {}`, `try` / `throw`,
    `await`, async host calls, etc.) require it.
  - Which existing brain features in `apps/sim` depend on each.
- Concrete recommendation: which flags are viable; which language
  features become unsupported when a flag is off; what the MCU
  defaults should be.

**Tests:** None (read-only).

**Spec updates:** None yet -- the recommendation drives V2.2's
content.

**Out of scope:** Any code change.

**Exit criteria:** Audit document exists and answers the questions
above with concrete file/line citations.

#### Audit results

Citations are file:line into the repo as of HEAD.

**Opcode -> flag mapping.** From
`packages/core/src/brain/interfaces/vm.ts:405` (the `Op` enum) and
the dispatch loop at `packages/core/src/brain/runtime/vm.ts:411-543`:

| Flag                   | Opcodes gated                                                                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fibers`               | `YIELD` (Op 51); plus the multi-fiber scheduling path in `Brain.activatePage` / `thinkPage` (see below).                                                                                                                                  |
| `structuredExceptions` | `TRY` (60), `END_TRY` (61), `THROW` (62).                                                                                                                                                                                                 |
| `asyncHandles`         | `HOST_CALL_ASYNC` (41), `HOST_CALL_ARGS_ASYNC` (43), `ACTION_CALL_ASYNC` (45), `AWAIT` (50). All four go through `HandleTable.createPending()` (`runtime/vm.ts:899, 980, 997, 1064`); `AWAIT` consumes the handle (`runtime/vm.ts:1083`). |

`WHEN_START` / `WHEN_END` / `DO_START` / `DO_END` are _not_ gated by
any feature flag -- they are core rule-shape opcodes used by every
brain.

**Language-construct -> flag mapping.** Inferred from the emitter
(`packages/core/src/brain/compiler/emitter.ts:170-265`) and the
rule compiler (`packages/core/src/brain/compiler/rule-compiler.ts`):

| Construct                                                   | Emits                                                                | Requires flag          |
| ----------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------- |
| `when {}` boundary                                          | `WHEN_START` / `WHEN_END`                                            | (none)                 |
| `do {}` boundary                                            | `DO_START` / `DO_END`                                                | (none)                 |
| Sync actuator / sensor                                      | `ACTION_CALL`                                                        | (none)                 |
| Async actuator / sensor (`action.isAsync = true`)           | `ACTION_CALL_ASYNC` + `AWAIT` (rule-compiler.ts:411-412, 435-436)    | `asyncHandles`         |
| Sync operator overload                                      | `HOST_CALL_ARGS`                                                     | (none)                 |
| Async operator overload (`overload.fnEntry.isAsync = true`) | `HOST_CALL_ARGS_ASYNC` + `AWAIT` (rule-compiler.ts:205-209, 251-255) | `asyncHandles`         |
| Sync host call                                              | `HOST_CALL`                                                          | (none)                 |
| `try` / `throw`                                             | `TRY` / `END_TRY` / `THROW`                                          | `structuredExceptions` |
| Cooperative yield in user code                              | `YIELD`                                                              | `fibers`               |

Two notable findings:

1. **No emitter call-site for `try` / `throw` / `yield` exists in
   the current compiler.** Grep across
   `packages/core/src/brain/compiler/**` shows zero callers of
   `emitter.try()`, `emitter.endTry()`, `emitter.throw()`, or
   `emitter.yield()`. These opcodes have runtime support and tests
   in `runtime/vm.spec.ts` but no language surface today.
2. **`AWAIT` is always emitter-paired with an async call op.** It
   never appears alone in compiler output. Disabling `asyncHandles`
   makes all four async opcodes unreachable at once.

**Multi-fiber dependency in the runtime architecture.**
`packages/core/src/brain/runtime/brain.ts:438-442` spawns one fiber
per root rule per page activation, and `thinkPage`
(`runtime/brain.ts:493-510`) re-spawns each completed root-rule
fiber on every tick. Pages with N root rules require N concurrent
fibers, independent of any user opcode. **`features.fibers = false`
therefore has two distinct meanings that the planning doc
conflates**:

- **(a) Compile out `Op.YIELD` dispatch.** Cheap and safe; no
  current language construct emits `YIELD`.
- **(b) Cap the scheduler to a single fiber.** This is a
  product-shape change -- a page may have only one root rule, and
  any rule that calls an async action (which suspends the fiber)
  cannot run alongside another rule. For an MCU brain authored
  knowing this, it is workable; for any current `apps/sim` brain
  with multiple `when ... do ...` rules per page, it is not.

**Survey scope -- read carefully.** This monorepo contains exactly
one webapp host with `src/` checked in (`apps/sim`). The survey
below is therefore a **floor**, not a ceiling: it tells us which
features are _currently_ unused by the one in-tree host, **not**
which features any future host will use.
In particular, the embed / MCU VM that motivates this whole phase
is a _separate, out-of-tree host_ (microbit-class device) that
`apps/sim` does not target and never will. Async sensor reads on
an MCU (debounced button, ADC sample, I2C transaction) are exactly
the kind of thing that host _will_ register, so any decision that
leans on "sim does not register async functions, therefore async is
dead" is unsafe for the MCU target. Treat the survey as confirming
that dropping the runtime flag does not break in-tree consumers,
not as evidence that the features themselves are dead in the
broader product.

**`apps/sim` dependency on each flag.** Surveyed via
`apps/sim/src/brain/**` and `apps/sim/src/examples/**`:

- `asyncHandles`: **not used by `apps/sim`.** All seven sim actions
  (`apps/sim/src/brain/actions/{shoot,move,bump,turn,say,eat,see}.ts`)
  declare `isAsync: false`. No `functions.register(name, true, ...)`
  call exists in `apps/sim/src/brain/**`. The compile-time emitter
  of `ACTION_CALL_ASYNC` / `HOST_CALL_*_ASYNC` therefore has no
  in-tree producer; out-of-tree hosts (notably the future MCU host)
  may and likely will register async actions, at which point the
  emitter is live.
- `structuredExceptions`: **not used by anyone today.** No
  `try` / `throw` tile exists in the _core_ language
  (`packages/core/src/brain/compiler/**`), so no host can produce a
  brain that emits the opcodes regardless of what it registers.
  This is a stronger statement than the async one because the
  emit decision lives in core, not the host.
- `fibers (a)`: **not used by anyone today.** Same reasoning:
  no `YIELD` tile in the core compiler.
- `fibers (b)`: **used by `apps/sim`** (every multi-rule page
  relies on one fiber per root rule). Multi-fiber scheduling is
  also the only way the runtime supports multi-rule pages today,
  so any host that ships multi-rule pages -- in-tree or not --
  inherits this dependency.

**Recommendation: drop runtime feature flags entirely.** The
planning doc's `VmConfig.features` design does not survive scrutiny
once both costs and MCU behavior are accounted for:

- **No MCU benefit from runtime branching.** The C++ MCU VM will
  compile out unsupported opcodes via `#ifdef` / build-time
  constants, not by reading `cfg.features.X` at runtime. A runtime
  flag in the TS reference VM is pure host-side overhead (one
  branch per gated opcode per dispatch) that buys the MCU port
  nothing.
- **Capacity is already configurable.** Per-cap controls
  (`maxHandles`, `maxFibers`, `maxStackSize`) shipped in V1.3 and
  convert overflow to faults. A host that wants tight bounds sets
  the bound it cares about; there is no second axis of feature
  flags to test.
- **Test matrix explosion.** Three booleans are 8 combinations.
  Realistic coverage is two (host-on, MCU-off); the rest rot.
  Every flag also adds a per-opcode allocation-profile assertion.
- **Drift risk.** TS VM dispatching behind a runtime flag and C++
  VM dispatching behind `#ifdef` will diverge on flag semantics
  (which fault is raised? when is the check performed?) and the
  divergence is invisible because nobody runs the TS VM in MCU
  mode outside dedicated tests.
- **Capability surfacing belongs in the compiler.** "This target
  supports `try` / async / `yield` / multi-fiber" is a compile-time
  question. The compiler should refuse to emit gated opcodes and
  produce a diagnostic at the offending tile -- a runtime fault is
  the wrong primary signal.

**Replacement design (drives V2.2):**

1. **No TS-side `MCU_VMCONFIG` preset.** An originally planned
   `VmConfig` constant (`maxHandles: 0`, `maxStackSize: 256`) was
   rejected during the V2.2 design pass:
   - The TS VM never runs on an MCU; the C++ port does. A
     constant named `MCU_VMCONFIG` whose only consumer is a Node
     test process mislabels itself.
   - The C++ port does not read it. V5.2 emits a binary blob;
     nothing in the binary carries a `VmConfig`. The C++ build
     sets its own caps via `#ifdef` / build constants, so the TS
     preset cannot even seed the C++ side.
   - On the TS reference VM, `maxHandles` is a fault gate, not
     an allocation budget (`HandleTable.handles` is a lazy
     `Dict`; `maxHandles == 0` saves zero bytes vs. any other
     value). Pre-committing it in TS communicates a footprint
     saving that does not exist on this VM.
   - `maxStackSize: 256` is speculative ahead of V5.1; the C++
     port will pick its stack size against measured MCU RAM.
   - A second profile in the TS test matrix has the same cost
     that killed runtime feature flags above (rot risk, drift
     risk, additional per-opcode profile assertions).
2. **Document recommended caps in the contract instead.** V2.2 is
   reduced to a docs-only unit that adds a "Recommended caps for
   memory-constrained hosts" subsection to `vm-contract.md`'s
   Limits section. The subsection lists each cap, what it bounds,
   what to weigh when choosing a value, and the fault code raised
   on overflow. C++ and any future port read it; the TS test
   suite gains no second profile.
3. **No compile-time `Target` descriptor.** Capability is implicit
   in what the host registers and what the language exposes:
   - Async opcodes are emitted only when a host function declares
     `isAsync: true` or an action declares `isAsync: true`. An MCU
     port that registers no async functions cannot reach the async
     opcodes in the first place.
   - `try` / `throw` / `yield` opcodes have no current emit site
     (no language tile exists). When such a tile is added, the
     decision "does MCU support this?" becomes a real product
     question with concrete code to point at; the descriptor
     can be added then.
4. **No runtime VM changes for capability.** `VM.runFiber`
   dispatch loop is untouched by this work (still has all opcode
   arms). The TS VM stays a faithful reference for _all_ opcodes;
   the C++ port chooses its subset at build time via `#ifdef` /
   dead-code elimination on its switch.

This collapses the originally planned V2.2 (flag plumbing) and
V2.3 (cap lowering) into a single docs-only V2.2: add the
recommended-caps subsection to `vm-contract.md`. Phase V2 below
has no V2.3.

This recommendation supersedes the planning-doc flag list.

---

### Unit V2.1 -- Slot-indexed `LOAD_VAR_SLOT` / `STORE_VAR_SLOT` opcodes

**Goal:** Replace string-keyed variable access with single-operand
slot indexing, end-to-end. Both the per-instruction operand and the
underlying brain-level variable storage become `List<Value>` indexed
by `slotId`. The dispatch hot path performs zero `Dict.get(name)`
calls for variable access.

**Operand shape: `<slotId>` (single operand, no `scopeIdx`).** The
runtime has no scope chain today -- `Brain.variables` is one flat
`Dict<string, Value>`, and the documented contract
([vm.instructions.md "Variable Resolution"](../../../.github/instructions/vm.instructions.md))
states "no built-in scope chain walk." A perpetually-zero `scopeIdx`
operand would commit the wire format and the C++ port to a feature
that does not exist. If a real scope chain ships later, the operand
can be added then.

**No `LOAD_VAR_NAMED` / `STORE_VAR_NAMED` pair, and no
`ExecutionContext.resolveVariable` / `setResolvedVariable` hooks.**
The hooks are reachable but never populated -- no consumer in
`packages/` or `apps/` assigns `ctx.resolveVariable` or
`ctx.setResolvedVariable`, and the compiler has no notion of a
"cross-context" binding to drive a `*_NAMED` emit choice. The hooks'
single-string-argument signature also cannot express the only
plausible cross-context feature on the roadmap (cross-brain reads
like `[$actorRef][gem count]` in `apps/sim`); that feature naturally
extends the `ActorRef` native-struct `fieldGetter` / `fieldSetter`
path or registers a new sensor / actuator -- neither needs a
variable-opcode hook. Per V2.0 precedent (do not ship runtime
infrastructure ahead of a real producer), drop the hooks and the
named opcode pair.

**Storage shape:** `Brain.variables` becomes a `List<Value>` indexed
by the loaded program's `slotId`, plus a `Dict<string, number>`
name->slot map populated from `Program.variableNames` at program
load. The list is sized to `program.variableNames.size()` and
filled with `NIL_VALUE` on load. Slot indices are program-scoped:
loading a different program rebuilds both the list and the name->slot
map, copying values forward by name (see hot-reload below).

**Deliverables:**

- New opcodes `LOAD_VAR_SLOT` / `STORE_VAR_SLOT` taking
  `<slotId>` only. Bounded to `u16` (0..65535) by the MCU binary
  format contract; in-memory it is a plain `number` (Luau has no
  fixed-width integer type and the TS `Instr` representation is
  not packed).
- `Program.variableNames: List<string>` is retained, indexed by
  `slotId`, as the source of truth for program-load -> brain
  storage wiring and for hot-reload remapping. Stripped from MCU
  builds at write time in Phase V5; never read by the runtime
  dispatch loop.
- Compiler assigns slot ids to named variables in the same
  variable-name pool that exists today
  ([rule-compiler.ts](../../../packages/core/src/brain/compiler/rule-compiler.ts)
  and
  [brain-compiler.ts](../../../packages/core/src/brain/compiler/brain-compiler.ts)).
  No scope analysis is added by this unit -- the existing flat
  name pool already corresponds 1:1 to slot ids.
- Compiler emits `LOAD_VAR_SLOT <slotId>` / `STORE_VAR_SLOT <slotId>`
  at every variable access site that today emits `LOAD_VAR` /
  `STORE_VAR`.
- Delete `Op.LOAD_VAR` and `Op.STORE_VAR` and their dispatch arms
  in `runtime/vm.ts`. Renumber if convenient or leave the slots
  reserved -- per "No Backward Compatibility," the wire format is
  not preserved across the transition.
- Delete `ExecutionContext.resolveVariable` and
  `ExecutionContext.setResolvedVariable` interface fields in
  `interfaces/runtime.ts`. Delete the corresponding
  `VM.resolveVariable` and `VM.setResolvedVariable` private
  methods in `runtime/vm.ts`. The dispatch loop calls into the
  `ExecutionContext` slot-keyed entry points directly (see next
  bullet).
- Add `ExecutionContext.getVariableBySlot(slotId: number): Value`
  and `ExecutionContext.setVariableBySlot(slotId: number, value:
Value): void`. These are the only paths the VM dispatch loop
  uses for variable access. The existing
  `getVariable(varId: string)` / `setVariable(varId: string, value)`
  / `clearVariable(varId: string)` entry points are retained for
  host-function code (sensors, actuators) that look up variables
  by name (e.g.
  [apps/sim/src/brain/actions/utils.ts](../../../apps/sim/src/brain/actions/utils.ts),
  [apps/sim/src/brain/brain-context.ts](../../../apps/sim/src/brain/brain-context.ts)).
- Rewrite `Brain` (`runtime/brain.ts`) variable storage:
  `private variables: List<Value>` plus `private varSlotByName:
Dict<string, number>`. Implement `getVariableBySlot` /
  `setVariableBySlot` as direct list reads/writes. Implement the
  name-keyed `getVariable` / `setVariable` / `clearVariable` /
  `clearVariables` methods on `IBrain` and the corresponding
  `ExecutionContext` shims by going through `varSlotByName` first.
  Names not in the map at host-call time are looked up dynamically
  -- the host may name-access a variable the compiler never saw
  (no opcode emit -> no slot). Either lazily extend the list and
  the map (assigning a new slot at first sight) or return
  `undefined` / no-op; choose lazily-extend for behavioral parity
  with the current `Dict<string, Value>` semantics.
- Wire `Program.variableNames` -> `Brain` at program-load time.
  Add a `Brain.installProgram(p)` / `Brain.onProgramLoaded(p)` step
  (or the existing equivalent) that:
  1. Reads the new program's `variableNames` and builds a fresh
     `Dict<string, number>` mapping each name to its slot index.
  2. Allocates a new `List<Value>` of size
     `program.variableNames.size()` filled with `NIL_VALUE`.
  3. Copies forward: for each `(name, oldSlot)` in the previous
     name->slot map that is also in the new map, write
     `oldList.get(oldSlot)` into `newList[newSlot]`. Names dropped
     from the new program are discarded; names new to the program
     start at `NIL_VALUE`.
- Update the tree-shaker remapping pass
  ([program-tree-shaking-phased-impl.md](program-tree-shaking-phased-impl.md))
  in lock-step: it currently rewrites `LOAD_VAR` / `STORE_VAR`
  operands as indices into `Program.variableNames`; it must now
  rewrite `LOAD_VAR_SLOT` / `STORE_VAR_SLOT` operands the same way
  and continue to remap `Program.variableNames` itself.
- Update bridge-protocol / brain-json serialization if it touches
  `LOAD_VAR` / `STORE_VAR` or `Program.variableNames` (audit; the
  shape of `variableNames` is unchanged so most paths should be
  fine).
- Update `vm.instructions.md`: the "Variable Resolution" section
  becomes "Variable Access" and documents the slot-keyed dispatch
  path; the `Brain.variables` field shape changes; the opcode
  table replaces `LOAD_VAR` / `STORE_VAR` with `LOAD_VAR_SLOT` /
  `STORE_VAR_SLOT`.

**Cross-brain variable access (out of scope, recorded for
context).** A sketched feature in `apps/sim` would let one brain read
a variable from another via an `ActorRef` value (e.g.
`[$actorRef]["gem count"]`). That feature does **not** belong on the
variable-opcode path: the opcode would have no slot id available for
the _target_ brain (slots are program-scoped, and the target's
program is unknown to the caller's compiler), and the target brain
may not even have the same variable. When the feature lands, it goes
through `ActorRef`'s native-struct field machinery (extend
`actorRefFieldGetter` /
`actorRefFieldSetter` in
[apps/sim/src/brain/type-system.ts](../../../apps/sim/src/brain/type-system.ts)
to call `target.brain.getVariable(name)` /
`setVariable(name, value)`) or as a dedicated sensor / actuator
host call. Both reuse already-shipped opcodes (`GET_FIELD` /
`SET_FIELD` or `HOST_CALL_ARGS`).

**Tests:**

- Compiler: a rule that uses N distinct variable names emits N
  distinct slot ids and a `Program.variableNames` of length N in
  insertion order; `LOAD_VAR_SLOT <i>` corresponds to
  `variableNames[i]`.
- Runtime: `STORE_VAR_SLOT` followed by `LOAD_VAR_SLOT` round-trips
  a value (port the existing `STORE_VAR / LOAD_VAR round-trip` test
  in `vm.spec.ts`).
- Runtime: `LOAD_VAR_SLOT` on a slot that has never been stored
  returns `NIL_VALUE`.
- Runtime: out-of-bounds slot id (`>= program.variableNames.size()`)
  faults as `ScriptError` (mirrors existing out-of-bounds tests for
  the deleted opcodes).
- Runtime: zero `Dict.get(<varName>)` calls during a number-heavy
  rule that does many variable reads/writes. Use a counter-wrapped
  `Dict` (mirroring the V1.4 operator-monomorphization pattern in
  `vm.spec.ts`) and assert the count is zero after the run.
- Storage: `Brain.getVariable("x")` and `Brain.getVariableBySlot(i)`
  agree when `varSlotByName.get("x") === i`.
- Hot-reload: load program A (variables `["a", "b"]`), set `a=1`,
  `b=2`, swap to program B (variables `["b", "c"]`). Assert
  `getVariable("b") === 2`, `getVariable("c") === NIL_VALUE`,
  `getVariable("a") === undefined` (or `NIL_VALUE`, whichever the
  current name-keyed semantic is).
- Host-call dynamic name path: a host function that calls
  `ctx.setVariable("z", v)` for a name not in `Program.variableNames`
  succeeds (lazy-extend semantics) and a subsequent
  `ctx.getVariable("z")` returns `v`.
- Tree-shaker: still passes; an opcode-emit test confirms it
  rewrites `LOAD_VAR_SLOT` / `STORE_VAR_SLOT` operands.

**Spec updates:** `vm-contract.md` opcode reference gains
`LOAD_VAR_SLOT` and `STORE_VAR_SLOT` entries (operand: `slotId:
u16`, stack effect `[] -> [value]` and `[value] -> []`
respectively, faults `ScriptError` on out-of-bounds slot). The
"Calling convention" section gains a short note that the dispatch
loop performs no `Dict.get(name)` for variable access; name lookup
remains available to host functions via the
`ExecutionContext.getVariable` / `setVariable` /
`clearVariable` API.

**Out of scope:**

- Stripping `Program.variableNames` from release builds. Done at
  MCU-binary-write time in Phase V5.
- Reintroducing a `scopeIdx` operand or a `*_NAMED` opcode pair.
  Either may be added in a future unit when a real product feature
  drives the requirement.
- Cross-brain variable access. See the recorded-for-context note
  above.
- Compile-time scope analysis. The flat per-program variable name
  pool is the slot id source.

**Hidden risks:**

- **Slot-id stability across recompiles.** Slot ids are program-
  scoped, not brain-scoped. The `Brain.installProgram` copy-forward
  step is the _only_ defense against losing in-flight values when a
  program is hot-reloaded. Tested explicitly above.
- **Lazy-extend semantics for unknown names at host-call time.**
  The current `Dict<string, Value>` storage allows a host function
  to write to a name the compiler never saw. The new storage
  preserves that, but the lazy slot allocation lives outside the
  `Program.variableNames` table -- those slots have no name in the
  program (only in `Brain.varSlotByName`) and therefore cannot be
  addressed by `LOAD_VAR_SLOT` from bytecode. That is the intended
  asymmetry: bytecode addresses compiler-known names; host calls
  address arbitrary names. Document this in `vm.instructions.md`.
- **Tree-shaker remapping must change in the same unit.**
- **Bridge / JSON serialization audit** for any code that special-
  cases the `LOAD_VAR` / `STORE_VAR` opcode numbers.
- **`ExecutionContext` interface break.** Removing
  `resolveVariable` / `setResolvedVariable` and adding
  `getVariableBySlot` / `setVariableBySlot` is a public-shape
  change. Audit all `ExecutionContext` implementations and
  consumers (search for `getVariable`, `setVariable`, the removed
  hook names) and migrate in the same unit per "No Backward
  Compatibility."

**Exit criteria:** Dispatch loop performs zero `Dict.get(<varName>)`
calls during variable access (counter test green). All tests green.
Hot-reload test demonstrates name-keyed value preservation across a
program swap.

---

### Unit V2.2 -- Recommended caps for memory-constrained hosts (docs only)

**Goal:** Document the per-cap guidance an embed host needs to
configure `VmConfig` for a memory-constrained deployment. No TS
code change, no exported preset, no second test profile.

**Background:** an earlier draft of V2.2 proposed a TS-exported
`MCU_VMCONFIG: VmConfig` constant. It was rejected during design
(see the "Replacement design" block in V2.0 above). The short
version: the TS VM never runs on an MCU, the C++ port does not
read the TS constant, and on the TS reference VM most of the
candidate values either save zero bytes (e.g. `maxHandles`) or
are host policy choices that do not need a target-specific name.
The right home for "what an embed host should set" is the
contract spec, where every port (C++, future) reads it.

**Deliverables:**

- Add a \"Recommended caps for memory-constrained hosts\"
  subsection to `vm-contract.md`'s \"Limits\" section. For each
  configurable cap (`maxStackSize`, `maxFrameDepth`, `maxHandlers`,
  `maxHandles`, `maxFibers`), list:
  - What the cap bounds (with a one-line refresher; the full
    definition lives in the existing per-cap entry above).
  - What to weigh when choosing a value for a memory-constrained
    host (per-cap allocation cost, per-fault behavior, expected
    per-brain shape).
  - The fault code raised on overflow.
  - Explicitly mark which caps are _fault gates_ on the TS
    reference VM (no allocation cost) vs. which caps a fixed-
    array C++ port may use to size storage at build time.
- The `richErrors` toggle that briefly appeared during V1.1 was
  deleted in the V2.2 design pass; the TS VM always allocates
  fresh `ErrorValue` instances. The C++ MCU port may ship a
  pooled construction strategy on its side; that is a port-level
  decision documented in the contract's "Error allocation"
  subsection and does not need a flag in the shared interface.
- Cross-link to V5.1's measured maxima once that unit lands so
  the recommendations have concrete numbers to anchor against.

**Tests:** None (docs only).

**Spec updates:** the subsection above. No other doc changes.

**Out of scope:**

- Any TS code change. No exported preset, no `runtime/profiles.ts`,
  no test fixture that constructs a VM under non-default caps as
  a profile. (Per-cap tests already exist from V1.3 and stand on
  their own.)
- A `CompileTarget` descriptor or any compile-time capability
  gate. Explicitly rejected in the V2.0 recommendation.
- Tightening default caps for host consumers. V1.3 defaults stay.
- Picking the C++ port's actual MCU caps. Those live in the C++
  build's configuration, not in this spec; the subsection
  describes the _shape_ of the choice, not the values.

**Hidden risks:**

- The subsection is small and tempting to grow into a TS preset
  later. Re-derive the four rejection reasons (TS does not run
  on MCU; C++ does not read TS constants; most caps are fault
  gates not allocation budgets on the TS VM; second profile rots)
  before introducing one.

**Exit criteria:** subsection added to `vm-contract.md`; full
gate green (docs-only).

---

## Phase V3 -- Typed data shapes

Replaces tagged-pool constants and string-keyed struct fields with
indexed access. Sequence: V3.1 (constants) first; V3.2 + V3.3
(structs) follow.

### Unit V3.1 -- Typed constant sub-pools

**Goal:** Split `Program.constants` into typed sub-pools. Strips
per-entry tag bytes and aligns with how the C++ port will store
constants (`std::vector<double>`, `std::vector<std::string>`).

**Deliverables:**

- `Program.constants` -> `numberConstants: List<number>`,
  `stringConstants: List<string>` (using `List` from
  `packages/core/src/platform`, not native `T[]` -- shared core rule),
  plus a residual heterogeneous `List<Value>` for compile-time-known
  structured values.
- New opcodes `PUSH_CONST_NUM <idx>` / `PUSH_CONST_STR <idx>`.
  Each typed sub-pool has its own index space (one opcode per pool;
  cleaner than packing pool selector into operand bits).
- Update tree-shaker remapping in lock-step.
- Update disassembler / debugger tooling.
- Update test fixtures.

**Tests:**

- Compiler emits typed PUSH_CONST opcodes correctly.
- Tree-shaker remapping handles all sub-pools.
- Disassembler renders typed constants distinguishably.

**Spec updates:** `vm-contract.md` opcode reference + new
"Constant pool layout" subsection under Value model.

**Out of scope:** Single-opcode-with-pool-selector encoding
(rejected for clarity).

**Hidden risks:** Constant pool indices remapped by the tree-shaker
become per-pool; remapping pass must distinguish sub-pools.

**Exit criteria:** Constant pool serializes without per-entry tag
bytes. Tree-shaker green.

---

### Unit V3.2 -- Stable `fieldIndex` on `StructTypeDef`

**Goal:** Make struct field order an explicit, stable contract.
_No opcode change in this unit_ -- isolates the type-system change
from the opcode change to keep diffs reviewable.

**Deliverables:**

- `StructTypeDef.fields[i]` gains an explicit `fieldIndex: number`
  field, assigned once at registration and immutable thereafter.
  Enforced via `readonly` typing; not via `Object.freeze` (not Luau
  portable).

  Note: `StructTypeDef.fields` itself, if added by this unit, is a
  `List<...>` per the shared-core rule -- never a native `T[]`.

- Audit all sites that iterate `fields` to ensure iteration order
  matches the index.
- Document `fieldIndex` as a stable id on the type-system spec.

**Tests:**

- Regression: `fields[i].fieldIndex === i` for every registered
  closed struct.
- Iteration order test: fields appear in `fieldIndex` order.

**Spec updates:** `vm-contract.md` Value model section adds the
`fieldIndex` invariant.

**Out of scope:** Indexed opcode emission -- next unit.

**Hidden risks:** Native-backed structs may iterate fields in a
different order today; audit catches them.

**Exit criteria:** Invariant test green; no consumer iterates
`fields` out of `fieldIndex` order.

---

### Unit V3.3 -- `STRUCT_GET_FIELD` / `STRUCT_SET_FIELD` indexed opcodes

**Goal:** Indexed struct field access for closed structs. Native /
open structs keep the name-keyed `GET_FIELD` / `SET_FIELD` opcodes.

**Deliverables:**

- New opcodes `STRUCT_GET_FIELD <idx>` / `STRUCT_SET_FIELD <idx>`.
- `StructValue.v` becomes `List<Value>` for closed structs (indexed
  by `fieldIndex`). `List` from `packages/core/src/platform`, not
  native `Value[]` -- shared-core rule.
- Rename factory to `mkClosedStructValue(typeId, fieldsByIndex:
List<Value>)`. Delete the old `mkStructValue` for closed types.
  `mkNativeStructValue` is unchanged.
- Compiler picks indexed vs name-keyed at emit time based on type
  info; refuses to emit indexed ops for open struct destructuring.
- Update tree-shaker remapping if it inspects struct opcodes.

**Tests:**

- Compiler emits indexed ops for closed structs, name-keyed ops for
  native and open structs.
- Compiler refuses indexed ops for open struct destructuring
  ([destructuring-extensions.md](destructuring-extensions.md)).
- Runtime: indexed access is a `List.get(idx)`; name-keyed access
  still works for native-backed structs.

**Spec updates:** `vm-contract.md` opcode reference for both
families; Value model documents the closed-vs-open struct
distinction.

**Out of scope:** Removing the name-keyed opcode family. Open and
native-backed structs still need it.

**Hidden risks:**

- `StructValue.v` going from `Dict<string, Value>` to `List<Value>`
  is a public-shape change for closed structs. Test fixtures, host
  functions returning structs, and brain extensions migrate in the
  same unit.
- The new `StructValue.v: List<Value>` must be indexed by the V3.2
  `StructTypeDef.fields[i].fieldIndex`. Any `mkClosedStructValue`
  helper must accept fields in `fieldIndex` order (or accept a
  name-keyed input and route through the registry to permute), and
  any reverse path that builds a `StructValue` from a host record
  must look up `fieldIndex` from the registry rather than relying on
  registration-time argument order.
- Struct method dispatch hardcodes `args.v.get("0")` for the
  receiver
  ([struct-method-calls-phased-impl.md](struct-method-calls-phased-impl.md)).
  Rewrite to positional `args.get(0)` -- this lands cleanly _after_
  Phase V4 ships positional args; until then, use a transitional
  shim or sequence V4.1 before V3.3.

**Sequencing note:** V3.3 depends on V4.1's positional args. Choose
either: (a) sequence V4.1 before V3.3, or (b) ship V3.3 with a
transitional shim in struct method dispatch and remove the shim in
V4.1. Recommend (a) -- swap the phase order so V4 lands before V3.3.

**Exit criteria:** Closed struct ops are array reads. Open / native
struct ops still work via name-keyed family.

---

## Phase V4 -- Calling convention

Two units. V4.1 replaces the four-variant host-call ABI with a
positional `Sublist`/snapshot pair. V4.2 collapses bytecode
actions onto the same operand-stack convention and erases the
runtime `args` object for compiler-emitted action bodies. The
seam between the units is real: host functions are opaque TS and
_must_ see a runtime `args` value; bytecode actions are
compiler-emitted code where every `slotId` is known at lowering
time and no runtime container is required. Splitting along that
seam means each unit lands durable structure with no throwaway.

**MCU emitter discipline for all Phase V4 call sites:** the
positional arg buffer is built on the operand stack only. Emitters
may use a direct dense fast path when every slot is supplied in
slot order: the already-evaluated values immediately below the
call opcode are the positional buffer. Sparse, optional, or
out-of-order slot maps use the explicit `NIL_VALUE` +
`STACK_SET_REL` sequence: push the full NIL-filled buffer before
lowering supplied argument expressions, then immediately write
each lowered value into its destination slot. A compiler must not
reserve hidden frame locals, allocate temporary `List` / `MapValue`
containers, or increase `FunctionBytecode.numLocals` solely to
stage call arguments. If an existing IR shape evaluates sparse or
out-of-order args before the call node, the Phase V4 work changes
that lowering/IR shape rather than adding spills. This is part of
the MCU-facing contract: per-call staging may consume transient
operand-stack space, but it must not add persistent per-frame
local slots.

### Unit V4.1 -- New host-call ABI

**Goal:** Delete the per-call `MapValue` + `ValueDict` allocation
on host calls. Replace the four `HOST_CALL*` variants with a
single sync/async pair that hands the host a positional view
over the operand stack.

The `args` shape that hosts read from is unchanged in spirit --
today it is `MapValue` keyed by integer `slotId`
(`args.v.get(0)`), after V4.1 it is `ReadonlyList<Value>` indexed
by the same `slotId` (`args.get(0)`). The win is removing the
Map allocation on the boundary, not introducing a new
arg-numbering scheme.

`ACTION_CALL` / `ACTION_CALL_ASYNC` are not touched in V4.1.
`ActionRuntimeBinding.execSync` / `execAsync` keep their
`MapValue` parameter. Bytecode actions' frame-local-1 MapValue
is unchanged. All of that migrates in V4.2.

**Arg buffer layout (host call sites):**

The compiler emits a fixed-width arg buffer of size
`callDef.argSlots.size()` for every host call site. `slotId` is
the index into `callDef.argSlots` (see
[interfaces/functions.ts](../../../packages/core/src/brain/interfaces/functions.ts))
-- a dense `0..N-1` integer assigned in declaration order over
the flattened call grammar. Slot ids do **not** depend on which
optional args the user supplied.

Dense fast path per host call site:

1. If every slot is supplied and the supplied values are already
   in slot order `0..N-1`, emit those values directly below
   `HOST_CALL fnId argc callSiteId` (or `HOST_CALL_ASYNC`).
2. The `argc` operand remains the full fixed buffer width `N`.
   The dispatcher reads the top `N` operand-stack entries as the
   positional buffer. No `NIL_VALUE` filler or `STACK_SET_REL` is
   emitted on this path.

Sparse/out-of-order emit sequence per host call site:

1. Push `NIL_VALUE` once per slot (N pushes for an N-slot call).
2. For each slot the user supplied (matched by tile id via
   `getSlotId(callDef, ...)`) in source evaluation order, lower
   the user expression and immediately emit `STACK_SET_REL d` to
   overwrite the corresponding slot.
3. Emit `HOST_CALL fnId argc callSiteId` (or
   `HOST_CALL_ASYNC`).

The sparse/out-of-order sequence is mandatory, not illustrative,
when direct dense emission cannot represent the call. The compiler
must not first evaluate all supplied args and spill them into hidden
locals before constructing the buffer. That would make every frame
for the function pay for call-site scratch storage even when the
host call is not executing, which defeats the MCU motivation for
this phase. If a frontend needs to preserve source evaluation order
for sparse or out-of-order slots, it does so by visiting the
supplied arguments in source order and applying the slot-specific
`STACK_SET_REL` after each expression.

`NIL_VALUE` (not "uninitialized") is required by the value
model: every `vstack` entry must be a defined `Value` for the
dispatch loop and the rbx target's Lua-table backing store to
behave consistently. Hosts checking "did the user supply this
slot?" use `isNilValue(args.get(i))`; hosts that check
`args.v.has(i)` or `args.v.get(i) === undefined` today migrate
to `isNilValue` as part of this unit.

**Sync vs async ABI -- different lifetime guarantees:**

Sync and async hosts get the same `ReadonlyList<Value>` shape
but different lifetime contracts:

- **`HostSyncFn.exec(ctx, args: ReadonlyList<Value>): Value`** --
  `args` is a `Sublist` view over `vstack`. The wrapper is
  ephemeral; do not retain it past the call. Sync hosts read
  what they need into locals and return.
- **`HostAsyncFn.exec(ctx, args: ReadonlyList<Value>, handleId): void`**
  -- `args` is an owned snapshot (a freshly-allocated
  `List<Value>` populated by the dispatcher before invocation).
  Free to retain the wrapper _and_ close over individual values
  across the async boundary; resolve/reject the handle whenever
  the async work completes.

The split exists because the natural async pattern is to close
over arguments. A view-shaped `args` would force every async
host to materialize a copy as boilerplate; the dispatcher does
that copy once, more cheaply, and removes the footgun.
Individual `Value` heap objects returned by `args.get(i)` are
always safe to retain in either tier.

**Deliverables:**

- New opcode pair `HOST_CALL` / `HOST_CALL_ASYNC`. Operands:
  `a = fnId`, `b = argc` (arg buffer width), `c = callSiteId`.
  `argc` is redundant with `fnEntry.callDef.argSlots.size()`
  and is kept as an operand to avoid the registry indirection
  on the hot dispatch path.
- New `Op.STACK_SET_REL` opcode. Operand: `a = d`. Pops one
  value off the operand stack, then writes it to
  `vstack[top - d]` where `top` is the index of the topmost
  element _after_ the pop. `STACK_SET_REL 0` therefore
  overwrites the new topmost element with the popped value
  (it does not overwrite the slot the popped value just
  vacated -- that slot sits above the new `top` and is no
  longer part of the live operand stack). Valid `d` range is
  `[0, top]`; `d` greater than the post-pop `top` faults as
  out-of-bounds. For the V4.1 emit sequence (`PUSH NIL_VALUE`
  per slot, then for each user-supplied slot
  `lower expr; STACK_SET_REL d`), `d` counts the distance
  from the post-pop `top` down to the target slot. Reused by
  V4.2 for action call sites; introducing it here keeps it
  available before V4.2 lands.

  **Top convention.** Throughout this spec, `top` is the
  _index of the topmost live element_, not a next-free slot
  pointer. Under this convention, push increments `top`
  before write; pop reads at `top` then decrements. Every
  `vstack[top - k]` reference in the V4 units (for any
  `k >= 0`) addresses a live operand-stack entry.

  **Emit-side `d` formula.** Let `N = callDef.argSlots.size()`
  (the arg buffer width). Let `base` be the operand-stack
  index of the first NIL filler, so the N fillers occupy
  `vstack[base..base+N-1]` and `top = base+N-1` after the
  pushes. For target slot `s` in `0..N-1`, after pushing the
  user expression `top` is `base+N`; after the implicit pop in
  `STACK_SET_REL`, `top` is `base+N-1`; the target absolute
  index is `base+s`. Therefore:

  ```
  d = (N - 1) - s
  ```

  Slot `0` emits `STACK_SET_REL N-1` (deepest fill). Slot
  `N-1` emits `STACK_SET_REL 0` (overwrites the topmost NIL
  filler with the popped expression -- a meaningful
  instruction under the top-element convention, not a no-op).
  The compiler emits the same `lower expr; STACK_SET_REL d`
  pair for every supplied slot regardless of `s`; there is no
  special case for the top-of-buffer slot, and emission order
  across slots is free (the formula is independent of order).

  Reused by V4.2 for action call sites; introducing it here
  keeps it available before V4.2 lands.

- New `HostSyncFn.exec` signature:
  `(ctx, args: ReadonlyList<Value>) => Value`. `ReadonlyList`
  from `packages/core/src/platform` -- never `Value[]`, per
  shared-core rule. Wrapping object unchanged.
- New `HostAsyncFn.exec` signature:
  `(ctx, args: ReadonlyList<Value>, handleId: HandleId) => void`.
  The dispatcher materializes `args` as a fresh `List<Value>`
  before invocation; the host may retain it. Wrapping object
  unchanged.
- Delete the four old host-call opcode variants
  (`HOST_CALL` / `HOST_CALL_ASYNC` / `HOST_CALL_ARGS` /
  `HOST_CALL_ARGS_ASYNC`) and compact the `Op` enum -- renumber
  the new pair into the freed range; do not leave gaps.
  Breaking bytecode serialization is acceptable; pristine
  numbering takes precedence over compatibility.
- Compiler IR consolidation
  ([packages/ts-compiler/src/compiler/ir.ts](../../../packages/ts-compiler/src/compiler/ir.ts),
  [emit.ts](../../../packages/ts-compiler/src/compiler/emit.ts)):
  collapse `IrHostCall` / `IrHostCallArgs` into a single
  `IrHostCall { fnName, argc }`; same for the async pair.
- TS compiler lowering/IR/emit changes required to support the
  stack-only arg-buffer discipline. Host-call emit may keep dense
  in-order calls as a direct positional buffer, but must be able to
  emit the NIL + `STACK_SET_REL` buffer for sparse or out-of-order
  supplied slots without hidden spill locals.
- Migrate every host-fn registration site that consumes
  `args.v.*` in the same unit:
  `packages/core/src/brain/runtime/` (operators, conversions,
  math-builtins, string-builtins, map-builtins,
  element-access-builtins, context-types, type-system) and
  `apps/sim/src/brain/engine-context.ts` plus
  `apps/sim/src/brain/type-system.ts` insofar as either
  registers host functions (not actions).
- Update struct method dispatch
  ([struct-method-calls-phased-impl.md:161](struct-method-calls-phased-impl.md))
  to `args.get(0)` for the receiver.
- One-time mechanical rewrite of migrated host sites: drop the
  no-op `if (arg && isXValue(arg))` idiom in favor of
  `if (!isNilValue(arg) && isXValue(arg))`. Pre-V4.1 the
  leading `arg &&` collapsed `undefined` (slot not present) and
  the absent value; post-V4.1 `arg` is always defined.
- Update unit gate to include `apps/sim` typecheck/build, since
  `HostSyncFn` / `HostAsyncFn` are re-exported through the public
  seam
  ([packages/core/src/mindcraft.ts](../../../packages/core/src/mindcraft.ts)).

**Tests:**

- Allocation-counter microbenchmark: spy on the `MapValue`
  factory and `ValueDict` constructor; assert the call count is
  zero across N synchronous host calls. (Action calls still
  allocate one MapValue each in V4.1; that microbenchmark
  tightens in V4.2.)
- Async-retention test for `HostAsyncFn`: register an async
  host that closes over `args` and the `handleId`, resolves on
  a later tick, reads every arg from the closure, and asserts
  all values match what was passed at call time -- even after
  the operand stack has been reused for unrelated work.
- Compiler emits a direct dense positional buffer for all slots
  supplied in order, and emits the `NIL_VALUE` + `STACK_SET_REL`
  sequence for sparse or out-of-order host call sites. Verify with
  disassembler-style tests (scanning `code` for the expected
  opcode sequence) on representative programs covering: zero
  slots, all slots supplied in order, all slots supplied through
  an explicit slot map, all slots supplied out of order, sparse
  supply (slot 0 and slot 3 of a 4-slot call).
- Compiler host-call emission does not allocate hidden spill
  locals: for the representative programs above, `FunctionBytecode`
  local count equals the source-visible frame-local count required
  by params and user locals, with no growth caused only by call
  argument staging.
- Slot-keyed access (`args.get(getSlotId(callDef, anonSpec))`)
  returns the expected value for both supplied and unsupplied
  slots; `isNilValue(args.get(i))` is `true` for unsupplied
  slots.

**Spec updates:** `vm-contract.md` "Calling convention" section
gains the host-call layout (operand layout, arg buffer width
derivation, `STACK_SET_REL` semantics, sync `Sublist` view
semantics, async owned-snapshot semantics). The action-call
section is filled in by V4.2. Do **not** add a "no re-entry"
contract -- re-entry is governed by the host's own discipline.

**Out of scope:**

- `Op.ACTION_CALL` / `Op.ACTION_CALL_ASYNC` rework. Operand
  shape, dispatcher, `ActionRuntimeBinding` signatures, and the
  bytecode-action frame-local-1 MapValue all stay unchanged.
  All migrate in V4.2.
- Host-bound action sensors/actuators
  (`apps/sim/src/brain/actions/*`,
  `packages/core/src/brain/runtime/sensors`,
  `packages/core/src/brain/runtime/actuators`). They sit behind
  `ActionRuntimeBinding`, not `HostSyncFn`/`HostAsyncFn`, and
  migrate in V4.2 alongside the action ABI.
- Retrofitting existing `MapValue` / `List` consumers outside
  the call ABI to use `subview`. The platform method is public,
  but V4.1 only adds the one consumer (sync host-call
  dispatcher).
- Re-entry policy. The TS VM is not single-entry by contract.

**Hidden risks / notes:**

- `HOST_CALL` operand widths are driven by the maximum
  `callDef.argSlots.size()` across host functions, not by the
  maximum user-supplied arg count. V5.1 (operand-width audit)
  must measure this _after_ V4.2 lands (action call sites pull
  the same way). The per-function `maxStackDepth` tracker must
  account for the `N` `NIL_VALUE` pushes per host call site plus
  the transient stack depth of each supplied argument expression
  lowered while the buffer is already reserved.
- `Sublist` lifetime for sync hosts is enforced by convention.
  The contract is reviewed at host-function registration sites
  (`packages/core/src/brain/runtime/*`, `apps/sim/src/brain/*`,
  and the public seam); user TS code never sees `HostSyncFn`.
- `args.size()` semantics change for variadic-style sync hosts
  (e.g. string-builtins format paths that loop over
  `args.v.size()` today). After V4.1, `args.size()` equals
  `callDef.argSlots.size()` -- the dense buffer width,
  including NIL fillers for unsupplied slots. Variadic loops
  must skip `isNilValue(arg)` entries explicitly.

**Exit criteria:** Four old host-call opcode variants gone; all
sync hosts on the Sublist signature; all async hosts on the
owned-snapshot signature; allocation-counter microbenchmark
green for host calls; async-retention test green; slot-keyed
access tests green; full unit gate (`packages/core` +
`packages/ts-compiler` + `apps/sim`) green.

---

### Unit V4.2 -- Erase runtime `args` object on action calls

**Goal:** Bytecode actions store their args as positional locals:
locals `1..N` when ctx is injected in local 0, otherwise locals
`0..N-1`. The brain compiler resolves `args.distance` directly
to `LoadLocal slot` at lowering time and emits no per-param
prologue. Host-bound actions (actuators, sensors) get the same
`Sublist`/snapshot ABI as host functions. The per-call
`MapValue` allocation on action calls disappears.

After V4.2, `args` is a _compile-time_ concept inside bytecode
action bodies -- never materialized at runtime. The runtime
arg-shape across all four call opcodes is identical: a sequence
of values on the operand stack, indexed `0..argc-1`.

**Arg buffer layout (action call sites):**

Identical to host call sites. Dense in-order action calls may
emit the supplied values directly below `ACTION_CALL actionSlot
argc callSiteId` (or `ACTION_CALL_ASYNC`). Sparse, optional, or
out-of-order action calls emit the explicit buffer: N
`NIL_VALUE` pushes for an N-slot action call, then each supplied
arg value followed immediately by `STACK_SET_REL` for that slot.
The `MAP_NEW` + `MAP_SET` sequence used by the action emit path
today is deleted. V4.2 inherits the Phase V4 MCU emitter
discipline: action-call emit must keep all staging on the operand
stack, lower supplied sparse/out-of-order action args one at a
time in source evaluation order, fill each destination slot
immediately, and use no hidden spill locals or temporary runtime
containers.

**Dispatcher behavior:**

`Op.ACTION_CALL` / `Op.ACTION_CALL_ASYNC` operands are
`a = actionSlot`, `b = argc`, `c = callSiteId`. The dispatcher
pops `argc` values from the operand stack and routes:

- **Host-bound action (`ActionRuntimeBinding.execSync`):** wraps
  the popped region as a `Sublist` over `vstack` and invokes.
  Same lifetime contract as `HostSyncFn`. Sync hosts read what
  they need into locals before returning.
- **Host-bound action (`ActionRuntimeBinding.execAsync`):**
  copies the popped region into a fresh `List<Value>` snapshot
  and invokes with the `handleId`. Same lifetime contract as
  `HostAsyncFn`.
- **Bytecode-bound action:** seeds the callee frame's locals
  directly. If `injectCtxTypeId !== undefined`, local 0 is the
  ctx struct and locals 1..argc are the popped args. Otherwise
  locals 0..argc-1 are the popped args. No `args` local is
  allocated; no MapValue or ListValue is constructed.

`getActionExplicitArgs`, `enterBytecodeActionFrame`, and
`spawnBytecodeActionFiber` in `runtime/vm.ts` migrate to take
`(values: ReadonlyList<Value>, argc: number)` (or equivalent)
and seed positional locals directly. The previous "build a
MapValue and store in local 1" path is deleted.

**Compiler changes (bytecode-action lowering):**

The brain compiler resolves field access on the synthetic
`args` parameter at lowering time:

- For each action signature, the compiler builds a name-to-slot
  map from `callDef.argSlots`.
- A name expression `args.distance` (where `distance` matches a
  slot name) lowers to `LoadLocal (ctxOffset + slotId)`. No
  `LoadLocal 1` (the old args local), no `MapGet`, no `ListGet`.
- A whole-`args` reference (`args` used as a value, not as a
  dotted access) is rejected at type-check time. Today this is
  effectively unused; if any test relies on it, that test
  migrates to per-field references.
- `isNilValue(args.modifier)` is the new check for "did the
  user supply this modifier?" The old `MapHas` lowering for
  modifier slots is deleted.

The per-param prologue at
[lowering.ts](../../../packages/ts-compiler/src/compiler/lowering.ts)
~line 1380 is deleted entirely. Action-frame layout becomes:
local 0 = ctx (when present), locals 1..N = arg slots in
declaration order, locals N+1.. = user-declared locals.
`FunctionBytecode.localCount` accounting is updated.

**Deliverables:**

- `Op.ACTION_CALL` / `Op.ACTION_CALL_ASYNC` operand reshape:
  `a = actionSlot`, `b = argc`, `c = callSiteId`. Dispatcher
  pops `argc` values; routes per the matrix above.
- `ActionRuntimeBinding.execSync` /
  `ActionRuntimeBinding.execAsync` signatures
  ([interfaces/runtime.ts](../../../packages/core/src/brain/interfaces/runtime.ts))
  migrate to `(ctx, args: ReadonlyList<Value>) => ...` (sync)
  and `(ctx, args: ReadonlyList<Value>, handleId) => void`
  (async), mirroring `HostSyncFn` / `HostAsyncFn` exactly.
  Lifetime contracts mirror those of host fns.
- ACTION_CALL emit in
  [packages/ts-compiler/src/compiler/emit.ts](../../../packages/ts-compiler/src/compiler/emit.ts)
  switches from `MAP_NEW` + `MAP_SET` per slot to the
  same stack-only positional-buffer discipline as V4.1: direct
  dense buffers for all slots supplied in order, and NIL +
  `STACK_SET_REL` buffers for sparse or out-of-order supplied
  slots.
- Bytecode-action prologue in
  [lowering.ts](../../../packages/ts-compiler/src/compiler/lowering.ts)
  ~line 1380 is deleted. `args.<name>` resolves at type-check
  time to a positional local index.
- `getActionExplicitArgs`, `enterBytecodeActionFrame`,
  `spawnBytecodeActionFiber` in `runtime/vm.ts` migrate to seed
  positional locals directly; MapValue construction for action
  frames is deleted.
- Migrate every action-bound consumer of `args.v.*`:
  `packages/core/src/brain/runtime/sensors/*`,
  `packages/core/src/brain/runtime/actuators/*`,
  `apps/sim/src/brain/actions/*`, plus any
  `ActionRuntimeBinding` registrations in
  `apps/sim/src/brain/engine-context.ts` and
  `apps/sim/src/brain/type-system.ts`. Same rewrite shape as
  V4.1: `args.v.get(slot)` -> `args.get(slot)`, presence checks
  via `isNilValue`, drop the `arg && ...` no-op idiom.
- Migrate sensor/actuator spec scaffolding
  ([sensors.spec.ts](../../../packages/core/src/brain/runtime/sensors/sensors.spec.ts),
  [actuators.spec.ts](../../../packages/core/src/brain/runtime/actuators/actuators.spec.ts))
  away from `args.v.set(slot, ...)` mutation: replace with a
  `mkArgsList` helper returning `List<Value>` of the right
  width.
- Migrate ts-compiler spec scaffolding (`mkArgsMap` in
  `codegen-basic.spec.ts`, `null.spec.ts`, `arg-spec.spec.ts`,
  `function.spec.ts`, `class.spec.ts`, `struct.spec.ts`,
  `union-typeof.spec.ts`, `await.spec.ts`,
  `implicit-conversions.spec.ts`,
  `struct-field-assignment.spec.ts`) to `mkArgsList`.
- Migrate the `brain.spec.ts` retention test pattern
  (`receivedArgs = args` then late assertion) to snapshot
  individual `args.get(i)` values into locals at call time.
  Retaining the wrapper is unsafe for sync hosts and sync
  host-bound actions.
- Delete the `MAP_NEW` / `MAP_SET` opcode usages from the
  ACTION_CALL emit path; if no other emit path uses them, leave
  them in the `Op` enum (other code -- struct construction,
  user `Map<K,V>` literals -- still uses them) but ensure no
  call-site emit references them.

**Tests:**

- Allocation-counter microbenchmark tightens: zero
  `MapValue` / `ValueDict` allocations across N synchronous
  host calls AND N synchronous action calls (host-bound and
  bytecode-bound).
- Async-retention test for async `ActionRuntimeBinding.execAsync`
  mirroring the V4.1 host-async test.
- Compiler emits a direct dense positional buffer for all slots
  supplied in order, and emits the `NIL_VALUE` + `STACK_SET_REL`
  sequence for sparse or out-of-order action call sites. Verify
  with disassembler-style tests on the same coverage matrix as
  V4.1: zero slots, all slots supplied in order, all slots
  supplied through an explicit slot map, all slots supplied out
  of order, and sparse supply.
- Compiler action-call emission does not allocate hidden spill
  locals and does not increase caller `numLocals` solely for
  argument staging.
- Bytecode-action body test: brain code referencing
  `args.distance` lowers to `LoadLocal slot` (single opcode --
  no `LoadLocal 1; PushConst slotId; MapGet/ListGet` triple);
  end-to-end execution verifies the named locals receive the
  correct values for required, optional, and modifier slots.
- Modifier-presence test: `isNilValue(args.modifier)` returns
  `true` when the user omits the modifier and `false` when the
  user supplies any value (including explicit `nil`). Confirm
  no user surface depended on the old `MapHas`-vs-`MapGet`
  distinction between "wrote `nil`" and "omitted."
- Frame-layout regression test: action with ctx + 3 arg slots
  - 2 user locals occupies `localCount = 6` locals; debugging
    helpers (fault-formatter, any DAP frame inspector) report
    the right shape. Audit any tooling that prints local 1
    assuming it is a MapValue or ListValue.
- `injectCtxTypeId` semantics unchanged: actions with no ctx
  still occupy locals 0..N-1 for args.

**Spec updates:** `vm-contract.md` "Calling convention" section
extended with the action-call layout (operand shape, dispatcher
matrix for host-bound vs bytecode-bound, frame-local layout for
bytecode actions). Document that the four call opcodes share a
single arg-buffer convention.

**Out of scope:**

- Variadic action signatures. Today's `args.v.size()` loops
  exist only in host fn paths (string-builtins format); action
  bodies do not iterate over `args`. If a future surface needs
  variadic action args, it gets a separate design pass.
- Whole-`args` reflection (passing `args` to another function,
  iterating named keys). Not supported in any current brain
  test; rejected at type-check by V4.2.

**Hidden risks / notes:**

- Bytecode-action frame layout changes. Any debug tooling,
  fault-formatter, or DAP frame inspector that prints local 1
  with assumptions about its shape (MapValue today) needs an
  audit -- after V4.2, local 1 is the first arg `Value`
  directly, with no container wrapper.
- `localCount` for action frames now includes the arg slots as
  named locals. Frame-allocation paths that today size frames
  for "ctx + args(MapValue) + user locals" must size for
  "ctx + N arg slots + user locals."
- `injectCtxTypeId` semantics in `FunctionBytecode` are
  unchanged (local 0 still holds the injected context struct
  when set). Args shift to local 1..N when ctx is present, or
  local 0..N-1 when absent.
- Test scaffolding migration is a single `mkArgsMap` ->
  `mkArgsList` sweep across ts-compiler specs. Reuse the
  helper introduced for sensor/actuator tests.
- The compiler must reject `args` used as a whole value
  (not as `args.<name>`). The check belongs in type-check,
  not lowering -- by lowering time, `args.<name>` has already
  resolved to a slot.
- Operand-stack peak depth grows with the _maximum_ action
  call's `argc`, not the maximum user-supplied count. V5.1's
  audit measures both host and action sites after V4.2.

**Exit criteria:** All four call opcodes share the single
positional ABI; `ActionRuntimeBinding` signatures mirror
`HostSyncFn`/`HostAsyncFn`; bytecode-action prologue is gone;
`args.<name>` lowers to a single `LoadLocal`; allocation-counter
microbenchmark green for host _and_ action calls; async-retention
test green for both host-fn-async and action-async; frame-layout
regression green; full unit gate (`packages/core` +
`packages/ts-compiler` + `apps/sim`) green.

---

## Phase V5 -- MCU binary transform

The deliverable that lands code on the MCU. C++ reader does not
exist yet; verify with TS-side disassembler.

### Unit V5.1 -- Operand-width audit (read-only)

**Goal:** Measure the operand widths needed for the MCU binary
format. Output drives V5.2's encoding choices.

**Deliverables:**

- Measurement pass over the largest compiled brains in `apps/sim`.
  Record:
  - Maximum observed jump offset.
  - Maximum function count.
  - Maximum constant pool size per typed sub-pool.
  - Maximum slot count per scope.
  - Maximum struct field count.
- Treat in-tree numbers as a _seed_, not a final answer. The MCU
  brain corpus lives outside this monorepo and may differ in shape
  (e.g. simpler rules but more pages, or larger constant pools for
  device-specific lookup tables). Re-measure against the MCU host's
  brain corpus before locking widths for V5.2; the in-tree numbers
  exist only to give V5.2 a starting point so it does not block on
  the MCU host shipping.
- Recommend operand widths for the binary format with 4x headroom
  on observed maxima.
- Reserve one bit per opcode to signal a wide-operand follow-up
  word for the rare overflow case.

**Tests:** None (measurement only).

**Spec updates:** `vm-contract.md` "Limits" section captures the
measured maxima and chosen widths.

**Out of scope:** Implementing the binary writer.

**Exit criteria:** Document with concrete numbers and width
recommendations.

---

### Unit V5.2 -- MCU binary writer + TS-side disassembler

**Goal:** Implement the MCU-targeting binary writer. Verify with a
TS-side disassembler since the C++ reader does not exist yet.

**Host-tooling note:** The MCU binary writer and disassembler are
_host build tooling_, not part of the shared VM runtime. They run
only on Node (in the compiler / build step) and never inside Luau.
Place them in `.node.ts` files (or under a host-only package such as
`packages/ts-compiler`), which exempts them from the shared-core
ban on `Uint8Array` / Node-only APIs. The shared runtime in
`packages/core/src/brain` must not import them.

**Deliverables:**

- `compileToMcuBinary(p: Program, opts: { stripDebug: boolean }):
Uint8Array` using `IWriteStream` from
  `packages/core/src/platform/stream-types.ts`. Lives in a
  Node-only file.
- Header carries both a _format_ version and an _opcode-set_
  revision.
- `disassembleMcuBinary(buf: Uint8Array): string` returns
  human-readable form for golden-file diff testing. Node-only.
- Default: `stripDebug: true` for MCU builds.

**Tests:**

- Round-trip: representative `Program` -> writer -> disassembler
  produces a stable golden form.
- Debug-strip: `stripDebug: true` produces a smaller blob than
  `stripDebug: false` and disassembles to anonymous slot/func
  references.
- Golden files for a small set of brains in `apps/sim`.

**Spec updates:** `vm-contract.md` "Binary format" appendix:
header layout, chunk tags, version semantics, target-feature gate.

**Out of scope:**

- A `Uint8Array -> Program` deserializer in the TS runtime. The TS
  VM never reads the binary form.
- Bridge wire format changes. Bridge keeps its current
  serialization.
- BrainJson save format changes. Save format is project source,
  not bytecode.

**Hidden risks:** The writer is unverified until the C++ reader
exists. The disassembler + golden files are the interim safety
net.

**Exit criteria:** Round-trip test green; rejection test green;
debug-strip test green. The C++ reader can be developed against
the spec and golden files independently.

---

## Out of Scope (Tier D from the planning doc)

The following are intentionally not part of this implementation
plan. The planning doc has the rationale; the short version:

- **#1 allocation-free `Value` model / accessor facade.** Pure TS
  cosmetic; the C++ port chooses its own value representation
  regardless. Cross-language readability of the dispatch loop is a
  weak benefit.
- **#4 packed `Instr` in TS.** The TS VM does not need a
  `Uint32Array` encoding for performance, and `Uint32Array` is not
  available on Luau anyway. The MCU binary writer (V5.2) produces
  packed encoding for the C++ side. The in-memory `Instr` stays as
  objects.
- **#3 debug-name optional block as a build-mode split.** The MCU
  binary writer strips at write time (V5.2). The TS in-memory
  `Program` keeps names attached unconditionally. Reconsider only
  if a separate driver appears (e.g., bridge payload size).
- **#9 fixed-capacity stack rewrite.** V1.3 covers the missing
  pre-checks (the contract-relevant part). Replacing
  `List<Value>` with `Value[] + top` is pure TS hygiene with no
  contract value.

---

## Parallel Maintenance Practices (post-port)

Not implementation phases; habits to adopt once the C++ impl
exists:

- **Every contract change is a single PR touching:** TS runtime,
  TS compiler, `vm-contract.md`, C++ runtime. No "TS first, C++
  later" -- that's how implementations diverge.
- **A shared opcode-conformance test suite** (a corpus of small
  programs with expected output / fault behavior) runs against
  both VMs in CI. If only one passes, the contract is broken.
- **The C++ VM owns its representation choices** (NaN-boxing,
  intrusive lists, pool allocators, packed instructions). The TS
  VM never copies these.
