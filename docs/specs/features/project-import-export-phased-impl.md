# Project Import/Export -- Phased Implementation

**Spec:** `docs/specs/features/project-import-export.md`
**Date:** 2026-04-19

## Workflow Convention

Read this doc and the associated spec in full before beginning each phase. After implementing a phase, STOP and present the work for review. Also note any uncovered risks and any deviations from the spec.

---

## Phase 1: Common Layer (packages/app-host)

**Goal:** Implement export and import logic for the common layer (host,
name, description, files, brains). The app layer is handled by a callback
so the host app can plug in its own serialization/deserialization.

PHASE COMPLETE

---

## Phase 2: Sim Integration (apps/sim)

**Goal:** Wire export and import into the sim app's UI via the hamburger
menu. The sim provides its app-specific serializer/deserializer.

PHASE COMPLETE

---

## Phase 3: Store-First Import Refactor

**Goal:** Refactor `importProject` so that imported projects are written to
the store first, then opened through the normal project-load path. This
eliminates the second code path where import creates a live project,
manipulates its workspace, and flushes back to storage. Import must be
atomic (all validation completes before any store write) and storage-only
(no side effects on active game state, UI, or global localStorage).

PHASE COMPLETE

---

## Phase 4: Per-Project Population Counts

**Goal:** Replace the global `localStorage` population count singleton with
per-project storage in IDB. After this phase, switching projects
saves and restores population counts automatically, export reads from the
project store, and the global `population-desired-counts` localStorage key
is eliminated.

PHASE COMPLETE

---

## Phase 5: Brain Save on Submit (Reliable Async Commit)

**Goal:** Make brain saves on OK-submission reliable, ensuring the async
IDB write cannot be silently lost. The brain editor is modal and
provisional -- it operates on a working copy, and changes are only
committed when the user clicks OK. Closing the dialog without clicking OK
discards changes. This is intentional UX and must be preserved.

### Core Principle: Any Changes Made to the Active Project Are Auto-Saved

Any change made to the active project must be saved to the store
automatically -- no explicit "save" action should ever be required. Brains
follow the same principle, with one nuance: the brain editor is modal and
provisional, so edits operate on a working copy until the user clicks OK.
OK is not a "save" action in the user's mental model; it is "accept these
changes." The actual save to the store happens automatically as a
consequence of accepting. Cancel/Escape discards the working copy without
saving. This is correct because:

- The brain editor is a modal workflow with an explicit accept/discard
  boundary. Saving mid-edit would persist incomplete logic.
- Population counts are transient scalar values with no intermediate
  invalid state, so they auto-save on every change (debounced).
- For brains, "auto-save" means: the save happens automatically on OK,
  is awaited, and errors are surfaced -- never fire-and-forget.

### Motivation

Currently, `handleBrainSubmit` calls `void store.saveBrainForArchetype()`
-- an unhandled async call. If the IDB write fails, there is no error
reported and no retry. Additionally, if the user clicks OK and then
immediately closes the tab before the microtask queue drains, the save
never executes. The save must be awaited (or at minimum, errors must be
surfaced).

### Step 1: Await the brain save in `handleBrainSubmit`

In `App.tsx`, change `handleBrainSubmit` to await the store save before
closing the dialog:

```ts
const handleBrainSubmit = async (brainDef: BrainDef) => {
  if (editingArchetype) {
    scene?.updateBrainDef(editingArchetype, brainDef);
    await store.saveBrainForArchetype(editingArchetype, brainDef);
  }
  setEditingArchetype(null);
  setIsBrainEditorOpen(false);
};
```

The dialog should show a loading/disabled state while the save is in
flight. If the save fails, surface an error rather than silently discarding
the write.

### Step 2: Verify error handling in `saveBrainForArchetype`

Confirm that `SimEnvironmentStore.saveBrainForArchetype` does not swallow
errors. If it catches internally, it must re-throw or invoke an error
callback so the submit handler can surface it to the user.

### Verification

```bash
cd apps/sim
npm run typecheck && npm run check
```

Manual testing:
1. Edit a brain, click OK. Reload the page. Verify the brain change
   persisted.
2. Edit a brain, close the dialog with Cancel/Escape. Verify the change
   was discarded (no save occurred).
3. Verify population counts and brains save independently (changing
   counts does not re-serialize brains; changing brains does not reset
   counts).

