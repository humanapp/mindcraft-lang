# Call Page / Return Page -- Language Spec

## What this document is

Design spec for two new core actuator tiles: **call page** and **return page**. These tiles add procedure-call semantics to the page system, allowing one page to invoke another and resume execution on the calling page when the called page returns.

This document is for review before implementation begins. No code should be written until the design is approved.

---

## Status

**Rejected** in favor of `DO [switch page] [previous page]` construction.

---

## Motivation

The existing page control flow tiles are:

| Tile           | Behavior                                              |
| -------------- | ----------------------------------------------------- |
| `switch page`  | One-way jump. Deactivates current page, activates target page. No return. |
| `restart page` | Deactivates current page, re-activates the same page. Resets all rule fibers. |

These are sufficient for flat state machines (Idle -> Hunting -> Eating -> Idle), but they cannot express hierarchical behavior -- "go do this sub-behavior, then come back." Without call/return, users must manually encode return-to logic using variables and conditional switch-page rules, which is error-prone and hard to read.

**Call page** and **return page** let users treat pages as reusable procedures:

```
Page: "Main"
  WHEN always DO call page "Attack Sequence"
  -- execution resumes here after Attack Sequence returns --

Page: "Attack Sequence"
  WHEN see enemy nearby DO shoot
  WHEN enemy defeated DO return page
```

---

## Proposed Tiles

### `call page` (actuator)

**Placement:** Do side only.

**Arguments:** Same as `switch page` -- accepts either a 1-based page number (Number) or a page name/ID (String) via `choice(AnonNumber, AnonString)`.

**Behavior:**

1. Pushes the current page index onto a **page call stack**.
2. Switches to the target page (deactivates current page, activates target page, cancels active fibers -- same mechanics as `switch page`).

If the target page is invalid (out of range, no match for name/ID), the call stack is not modified and the brain is disabled (same as `switch page` with an invalid target).

### `return page` (actuator)

**Placement:** Do side only.

**Arguments:** None (same pattern as `restart page`).

**Behavior:**

- If the page call stack is **non-empty**: pops the top entry and switches to that page (procedure return).
- If the page call stack is **empty**: behaves like `restart page` (deactivates and re-activates the current page). This is a safe fallback -- a page that uses `return page` works both as a called sub-page and as a standalone page.

---

## Page Call Stack

A new `List<number>` field on the `Brain` runtime instance. Tracks the chain of caller page indices, most recent on top.

### Stack interactions with existing tiles

| Action during a called page | Stack effect | Rationale |
| --- | --- | --- |
| `return page` | Pop top entry. Switch to popped page. | Normal return. |
| `switch page` | **Clear entire stack.** Switch to target. | The user has explicitly redirected control flow. The call chain is abandoned. |
| `restart page` | **Clear entire stack.** Restart current page. | The user has explicitly reset. Preserving a stale return address would be surprising. |
| `call page` (nested) | Push current page onto stack. Switch to target. | Nested calls work naturally. Stack depth grows by one. |

### Stack depth limit

No enforced limit. The stack uses the platform `List<number>` which stores plain numbers with negligible memory cost. A runaway recursive call-page loop would behave the same as any other infinite loop in the brain -- the scheduler's per-tick fiber budget prevents it from blocking the frame, and the stack grows by one entry per tick (one page switch per think cycle at most).

If a hard limit is desired in the future, a reasonable default would be 32 or 64 with the call silently becoming a `switch page` (clear stack + jump) when exceeded.

TODO: Revisit this.

### Lifecycle

- **`startup()`**: Clear the stack.
- **`shutdown()`**: Clear the stack.
- **`initialize()`**: No change (stack is runtime state, not compiled).

---

## Implementation Outline

### 1. Enum IDs (`interfaces/tiles.ts`)

Add to `CoreActuatorId`:

```typescript
CallPage = "call-page",
ReturnPage = "return-page",
```

### 2. IBrain interface (`interfaces/runtime.ts`)

Add four methods:

```typescript
requestPageCall(pageIndex: number): void;
requestPageCallByPageId(pageId: string): void;
requestPageCallByName(name: string): void;
requestPageReturn(): void;
```

### 3. Brain runtime (`runtime/brain.ts`)

Add field:

```typescript
private readonly pageCallStack: List<number> = new List<number>();
```

Refactor `requestPageChange` to extract shared page-switch logic into a private method. The public `requestPageChange` clears the stack then delegates. The new `requestPageCall` pushes to the stack then delegates. This avoids the call-page path accidentally clearing the stack via `requestPageChange`.

```
private changeToPage(pageIndex: number): void
    // Validate index, set desiredPageIndex, cancel fibers.
    // Does NOT touch the call stack.

requestPageChange(pageIndex: number): void
    // Clear call stack. Delegate to changeToPage.

requestPageCall(pageIndex: number): void
    // Validate index. Push currentPageIndex onto stack.
    // Delegate to changeToPage.

requestPageCallByPageId(pageId: string): void
    // Resolve pageId -> index (same as requestPageChangeByPageId).
    // Call requestPageCall(index).

requestPageCallByName(name: string): void
    // Resolve name -> index (same as requestPageChangeByName).
    // Call requestPageCall(index).

requestPageReturn(): void
    // If stack non-empty: pop, delegate to changeToPage.
    // If stack empty: delegate to requestPageRestart.

requestPageRestart(): void
    // Clear call stack. (Existing restart logic unchanged.)
```

Clear `pageCallStack` in `startup()` and `shutdown()`.

### 4. Actuator runtime functions

**`runtime/actuators/call-page.ts`** -- Near-identical to `switch-page.ts`. Same call spec (`choice(AnonNumber, AnonString)`). Runtime function calls `ctx.brain.requestPageCall(pageIndex)` for numbers and `ctx.brain.requestPageCallByPageId(str)` for strings.

**`runtime/actuators/return-page.ts`** -- Near-identical to `restart-page.ts`. Empty call spec (no arguments). Runtime function calls `ctx.brain.requestPageReturn()`.

### 5. Registration

**`runtime/actuators/index.ts`**: Import and register both new actuators.

**`tiles/actuators.ts`**: Import and register both new tile definitions.

### 6. Tests (`runtime/actuators/actuators.spec.ts`)

**call-page tests:**

- Calls `requestPageCall` with 0-based index for number arg (input 3 -> called with 2).
- Calls `requestPageCallByPageId` for string arg.
- Returns `VOID_VALUE` with no args and does not call brain.

**return-page tests:**

- Calls `requestPageReturn`.

**Integration-level tests** (in `brain.spec.ts` or a new file) covering stack behavior:

- Call page A -> B -> return -> resumes A.
- Nested call A -> B -> C -> return -> resumes B -> return -> resumes A.
- Call A -> B -> switch page C -> return -> behaves as restart (stack was cleared by switch).
- Call A -> B -> restart page -> return -> behaves as restart (stack was cleared by restart).
- Return page with empty stack -> restarts current page.

---

## Interaction with other systems

### Tile suggestions

No changes needed. Both tiles are actuators with `TilePlacement.DoSide` (the default for actuators). They will appear in the tile picker on the Do side like `switch page` and `restart page`. `call page` has the same call spec as `switch page` (page tiles and number/string literals will be suggested as arguments). `return page` has no arguments.

### Compiler

No changes needed. `call page` and `return page` are host functions invoked through the existing actuator calling convention. The compiler already handles arbitrary actuators via the function registry.

### Page tiles (pagetiles.ts)

No changes needed. Existing `BrainTilePageDef` instances produce String values (the stable pageId). These are already usable as arguments to `switch page` and will work identically as arguments to `call page`.

### Documentation

After implementation, add tile docs:

- `packages/core/src/docs/content/en/tiles/cf-call-page.md`
- `packages/core/src/docs/content/en/tiles/cf-return-page.md`
- Add entries to `packages/core/src/docs/manifest.ts` (`coreTileDocs` array).
- Rebuild docs: `cd packages/core && npm run build:docs`.
- Update `packages/core/src/docs/content/en/concepts/pages.md` to describe call/return semantics.

---

## Open Questions

1. **Should `return page` accept an optional value argument?** This spec says no -- call page does not return a value. A future extension could add a `call page` variant that stores a return value in a designated variable, but that adds significant complexity (which variable? what type?) for unclear benefit. Recommend deferring.

2. **Should `call page` to the current page be a no-op or push+restart?** The spec does not special-case this. Calling the current page would push the current page onto the stack and then restart it (since `changeToPage` sets `desiredPageIndex` which triggers deactivate+activate in `think()`). This seems reasonable -- it is equivalent to a recursive call that can be unwound with `return page`.

3. **Should the stack be visible for debugging?** A future brain debugger could display the call stack. The stack is a plain `List<number>` on the Brain instance. No public accessor is proposed in this spec -- it can be added when a debugger needs it.

4. **Event emissions.** Should `page_activated` / `page_deactivated` events carry metadata about whether the transition was a call, return, or switch? This would let the UI show different visual feedback. The spec does not propose this -- the existing events fire the same way regardless. Can be added later if needed.

---

## Build Log

_To be filled during implementation._
