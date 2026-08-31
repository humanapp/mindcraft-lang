---
title: Rule trigger modes (WHEN / OTHERWISE / THEN)
status: Accepted
# Active status:   Draft -> Review -> Accepted -> Committed -> In-Progress -> Shipped
# Terminal status: Rejected | Withdrawn | Superseded (set superseded-by)
created: 2026-08-31
updated: 2026-08-31
---

# Spec: rule trigger modes (WHEN / OTHERWISE / THEN)

A core, target-agnostic tile-language feature: every rule carries a trigger
mode that determines what arms its evaluation -- unconditional (`when`), the
complement of the rules above it (`otherwise`), or the completion of the rule
above it (`then`). This spec supersedes the tile surface of the `otherwise`
spec; the firing record that spec defines is the substrate this spec builds
on.

## What a trigger mode is

Every rule has a trigger mode: `when` (the default), `otherwise`, or `then`.
The mode is a structural property of the rule, not a tile. It determines what
arms the rule's evaluation; the rule's WHEN tile list remains an ordinary
sensor expression -- possibly empty -- that gates firing once armed.

- **`when`**: the rule evaluates every think it is scheduled. An empty
  expression means always.
- **`otherwise`**: the rule fires on a think when no earlier rule in its
  otherwise-chain fired that think, and its expression holds. An empty
  expression is plain `else`; a non-empty one is `else if`.
- **`then`**: the rule runs after the preceding sibling **completes as a
  cluster** -- the sibling's own DO, plus every descendant rule that firing
  spawned, child `then` rules included, all finished. While the sibling's
  cluster is in flight the `then` rule waits; when the cluster settles, the
  `then` evaluates its expression and fires if it holds (an empty expression
  always holds). If the sibling never fires, the `then` does not run.

```
WHEN button-a          DO scroll "hi"
THEN                   DO beep              // after the scroll finishes
THEN                   DO scroll "bye"      // after the beep finishes
OTHERWISE when tilted  DO show frown        // thinks the second then did not fire,
                                            // including while it waits
```

## A mode, not a tile

An inter-rule signal can live inside the WHEN expression -- the deprecated
`otherwise` tile did -- but the mode surface is where these signals belong:

- A flat run of `otherwise` tiles alternates instead of laddering (rule 3's
  subject is rule 2, and "rule 2 did not fire" includes "rule 1 fired").
  Ladder semantics need a chain-aware firing record, which as a tile would be
  a special case on a sensor designed to have none. As a mode, the chain is
  visible in the document structure and the semantics attach to it directly.
- The tile form must legislate compositions with no good meaning (`NOT
  otherwise`, `otherwise OR x`, several `otherwise` in one WHEN, `then` mid
  expression). A mode makes them unrepresentable.
- "The sibling completed" is a relation between rules, not a reading from the
  world; a rule header is its natural home.
- Sentence composition improves: the mode is the connective word, and the
  expression renders through the ordinary WHEN path.

The `otherwise` tile is deprecated in favor of the mode (see Document model
and migration).

## Adjacency

- The **first rule at a level** must be `when`. `otherwise` and `then` need a
  preceding sibling; without one they are rejected with an error-severity
  diagnostic, the structural analogue of `NoPrecedingSiblingRule`.
- An **otherwise-chain** is a maximal run of consecutive `otherwise` rules
  plus the non-`otherwise` rule immediately above the run (the chain head).
  The head may be a `when` or a `then` rule. An `otherwise` after a `then`
  fires on the thinks the `then` did not fire -- including the thinks the
  `then` is still waiting on its subject -- a "while waiting" branch.
- A **`then` rule's subject** is the immediately preceding sibling, whatever
  its mode. `then` after `then` sequences; `then` after `otherwise` runs after
  the else-branch's cluster completes. A `then` whose subject skipped (see
  Firing) skips too, so a sequence abandons cleanly from the point it broke.
- Child rules follow the same rules at their own level: a rule of any mode
  may have children, and modes scope per level exactly as sibling structure
  does.

## OTHERWISE semantics: the chain record

Each rule carries the three-state firing record -- `Evaluating` / `DidFire` /
`DidNotFire` -- written at the WHEN boundary opcodes, as the `otherwise` spec
defines. Mode determines what the gate writes: `when` and `then` gates write
the rule's own outcome; **an `otherwise` rule's gate writes a chain-aware
value**.

For an `otherwise` rule R with subject S (the rule directly above):

- R fired -> `DidFire`.
- R did not fire and S's record is `DidNotFire` -> `DidNotFire` (the chain is
  still open; R merely did not extend it).
- R did not fire and S's record is `DidFire` or `Evaluating` -> propagate S's
  record unchanged (the chain is satisfied, or undecided).

Read left to right, `DidNotFire` on an `otherwise` rule means "no rule in the
chain up to and including this one fired this think", which is exactly the
ladder invariant:

```
WHEN a           DO x
OTHERWISE b      DO y     // fires iff !a-fired and b
OTHERWISE c      DO z     // fires iff !a-fired and !b and c
OTHERWISE        DO w     // fires iff none of the above fired
```

The parked-subject, budget-split, and empty-WHEN cases follow the record
semantics of the `otherwise` spec: a parked chain member retains `DidFire`
and keeps the rest of the chain quiet while its action is in flight;
`Evaluating` propagates and keeps the chain quiet.

A flat run of `otherwise` rules is a ladder. (The deprecated tile's flat runs
alternate instead; see Document model and migration.) Nesting remains
available for any structure a ladder does not express.

## THEN semantics: the await model

### Completion: the cluster settles

A rule's firing **completes** when its whole cluster settles: the rule fired,
its own DO finished (including awaited actuators), and every descendant fiber
that firing spawned -- child rules, their children, and any child `then`
rules still waiting for their own subjects -- has finished.

The cluster property needs no dedicated bookkeeping: it is the scheduler's
subtree-liveness notion, and a waiting `then` child is a live fiber in its
parent's subtree, so the parent cannot settle until that `then` resolves,
recursively.

### The trigger: an asynchronous read

A `then` rule's trigger compiles to the ordinary asynchronous host-call
shape -- an async host action followed by `AWAIT` -- placed before the
rule's WHEN expression. When the trigger runs, it examines the subject and
answers one of three ways:

1. **The subject's cluster is in flight** (any fiber in the subject's subtree
   is live -- running its DO, parked on an actuator, quiesced with live
   descendants, or itself a `then` still waiting): the trigger returns a
   pending handle and the rule **waits** on it, as any awaited actuator
   waits. Before waiting it writes its own firing record as `DidNotFire`
   ("has not fired yet"), which is what lets an `otherwise` sibling run
   during the wait.
2. **The subject completed this think** (its firing record reads `DidFire`
   and its subtree has no live fiber; the record is fresh because siblings
   evaluate in document order): the handle resolves immediately, `AWAIT`
   falls straight through without suspending, and evaluation continues in the
   same slice.
3. **The subject is settled without a firing** (record `DidNotFire`, or a
   fault left it terminal): the trigger resolves false and the rule completes
   this think without firing -- the skip path.

When a waiting `then`'s handle resolves, the fiber resumes and the trigger's
answer is the subject's final outcome: **true** when the cluster settled
after a firing, **false** when the subject's evaluation ended without firing
or its cluster faulted or was cancelled. A true answer proceeds to the WHEN
expression; a false answer takes the skip path.

The waiting `then` is woken exactly once per subject firing, so a bare `then`
runs its DO once per completion by construction -- no consumption state, no
stamps, nothing to clear.

### Firing

| Subject at this rule's evaluation | `then` |
| --- | --- |
| Completed this think (fired, cluster settled) | evaluates its expression now; fires if it holds |
| Cluster in flight | waits; wakes when the cluster settles (or skips if the subject ends unfired) |
| Settled without firing, or faulted | skips this think |

**The expression is evaluated at the wake think and filters rather than
waits**: `THEN when <sensor>` runs after the completion if the sensor holds
at that moment ("then, if it is still dark, ..."), and skips the completion
otherwise. The waiting form ("then, once shaken, ...") is a different
feature (see Deferred); authors express it by nesting a `when` rule under
the `then`.

A `then` parked on its **own** awaited action does not observe its subject,
like any parked rule: completions that land while its DO is in flight are not
queued, matching the per-think philosophy of the rest of the language.

### Evaluation order and visibility

- A subject whose cluster settles without waiting does so inside its own turn
  of the round -- the drain cascade runs before the next sibling's slice --
  so the `then` continues the same think (trigger case 2).
- A subject that parked settles on the think its last fiber finishes; the
  waiting `then` is woken through the ordinary handle-resume path and runs
  the **following** think -- the same one-round resume every awaited actuator
  has. Its expression is evaluated at that wake think.
- A `then` whose evaluation is budget-split behaves as any split rule; the
  trigger's answer was computed when the trigger ran and is carried on the
  stack.

### The records a THEN rule writes

Ordinary rules apply, plus the pre-wait write from trigger case 1:

- Gate writes are unchanged: `DidFire` on thinks it fires, `DidNotFire` on
  thinks it evaluates without firing (including the skip path).
- While waiting, its record reads `DidNotFire`, so an `otherwise` after it
  fires during the wait and goes quiet the think the `then` fires.
- Its own completions settle like any rule's, which is what lets `then`
  chains sequence: the next `then` waits on it as a live fiber (case 1),
  wakes on its settle, and skips if it skipped.

### Faults and cancellation

- A fault anywhere in the subject's cluster resolves the waiting `then` as a
  skip: the sequence abandons rather than firing on partial work, and the
  skip cascades down a `then` chain through the ordinary skip path.
- Page exit cancels waiting `then` fibers exactly as it cancels any child
  fiber; their pending trigger handles cancel with them, and re-entry starts
  clean.

## Enforcement

- The compiler rejects, with error-severity diagnostics: `otherwise` or
  `then` mode on the first rule at its level.
- Mode validity is structural and is re-derived on any sibling reorder, the
  same positional-typecheck invalidation the preceding-sibling capability
  uses.
- The expression after any mode is the ordinary WHEN grammar with no new
  composition rules; everything WHEN-legal stays legal.
- The mode switch UI offers only modes the compiler accepts at that position,
  and the suggestion-compiler consistency oracle covers the modes in both
  directions.

## Document model and migration

- `RuleJson` carries one optional field: `trigger?: "when" | "otherwise" |
  "then"`; absent means `when`, so documents that predate the field parse
  unchanged.
- The field is a product contract shared by both consumer apps
  (`apps/microbit-sim` in wendoo-mcu, and `apps/ecosim` in this repo).
- **Tile deprecation.** The `otherwise` tile is not offered by the picker.
  On document load, two shapes migrate to the mode:
  - WHEN side exactly `[otherwise]` -> `trigger: "otherwise"`, empty WHEN.
  - WHEN side `[otherwise, AND, ...rest]` -> `trigger: "otherwise"`, WHEN
    `rest`.
  - Any other placement (mid-expression, OR forms, multiple occurrences)
    keeps its tiles, compiles and runs with tile semantics, and carries a
    **deprecation warning** naming the rewrite. The tile's runtime sensor
    stays registered for these documents; tile-bearing rules are `when`-mode
    rules, so their gates keep the ordinary record write and the tile
    semantics hold exactly -- including the tile's alternating flat runs.
- A migrated rule inside a flat run changes meaning (alternation -> ladder);
  this is the intended semantics of the mode, not a migration defect, and
  the deprecation warning names the nesting rewrite for authors who relied
  on alternation.

## Sentence composition

- The mode contributes the connective; the expression renders through the
  ordinary WHEN path. The `otherwise` mode's sentence connective is
  "Otherwise", and the expression clause after either connective keeps the
  ordinary "when" ("Otherwise, when I see food, eat." -- never "if"):
  - "Otherwise, wander."
  - "Otherwise, when I see food, eat."
  - "Then, beep."
  - "Then, when shaken, scroll 'bye'."
- The connective words localize as sentence template strings under the
  sentence contexts, not as tile words.
- The `adverb` sentence frame serves only documents carrying the deprecated
  tile.

## UI

- The WHEN affordance on the rule header is switchable among the modes legal
  at that rule's position: **tap-to-cycle** -- each activation advances
  WHEN -> ELSE -> THEN, with a subtle press affordance on the capsule.
- Accessibility contract for the cycle control: the capsule is a true button
  in the editor's keyboard model (focusable; Enter/Space cycles; arrow keys
  step in either direction); its accessible name carries the current mode
  ("Trigger mode: When") and each change is announced through a polite live
  region; the first rule's capsule is exposed disabled with an explanatory
  name ("A first rule is always When"); mode identity is carried by the
  label word, never color alone (tints are supplementary); a mode change is
  an ordinary undoable document edit. Cycle transitions respect reduced
  motion.
- **Capsule display labels**: WHEN, ELSE, THEN -- all short enough for the
  editor's stacked-upright-letters capsule treatment. The `otherwise` mode
  deliberately splits its display label (ELSE, the term MakeCode and Scratch
  present) from its sentence connective ("Otherwise"); the DO capsule has no
  sentence word at all, so the split has precedent. The internal mode key is
  `"otherwise"`. Labels localize like tile words, and ELSE-equivalents are
  short function words in most locales, preserving the stacked treatment
  cross-locale.
- The assistant panel's compact rule bands use the same display labels
  (WHEN / ELSE / THEN) as their band-opening capsule chips, and a trigger
  band renders its mode capsule even when the expression is empty -- a bare
  `then`'s mode is the whole message.
- Both apps register the visual treatment; icon/docs coverage invariants
  apply to the mode surface as they do to tiles.

## Assistant surface

The product's LLM assistant learns the language from a tiles-only catalog
digest plus prose and tool surfaces; trigger modes are structural, not
tiles, so they never appear in digest lines and are carried by the other
surfaces. In `packages/assistant-bridge` (a shared package -- both consumer
apps sweep):

- The grammar legend teaches the trigger modes and the ladder: sibling
  sequencing through `then`, branching through `otherwise`, nested
  elaboration of one firing through child rules.
- The `propose_edit` rule ops (`addRule`, `addChildRule`) carry a `trigger`
  field, and an op switches an existing rule's mode, mirroring the editor
  affordance.
- `read_project` renders each rule's mode alongside its sides.
- The deprecated `otherwise` tile's digest line carries the `deprecated`
  flag rather than going hidden, so `read_project` output for unmigrated
  documents stays explicable to the model.
- The mode diagnostics have entries wherever rejection codes are explained
  to the model.

The backend teaching kernel teaches the same grammar the editor accepts.

## Runtime and conformance

- The `then` trigger is a host action, not an opcode: it compiles to the
  async `HOST_ACTION_CALL` + `AWAIT` pair, and the handle table, resume
  path, fiber states, and cancellation carry it with no bytecode-format
  change. There is no completion record: the resolved handle carries the
  answer for a waiting `then`, and the same-think case reads the firing
  record plus subtree liveness.
- The runtime state behind the trigger is one watcher slot per rule -- the
  pending trigger handle of the `then` watching it, if any; at most one,
  since only the immediately-following sibling can watch a rule. The
  scheduler resolves watchers at fiber terminal transitions (done, fault,
  cancelled): it walks the finished rule and its ancestors and resolves the
  watcher of each rule whose subtree emptied, with that rule's firing
  outcome. Subtree liveness for an arbitrary rule derives from the fiber
  table and the rule-ancestor table the program carries.
- The one mode-aware VM behavior is the **`otherwise` chain gate write**,
  carried by two gate-variant opcodes -- chain forms of `WHEN_END` and
  `WHEN_END_PRESENT`. Each computes its fired outcome exactly as its base
  gate does, then writes the chain value; the subject lookup is the resolver
  the `otherwise` sensor uses. Opcode, host-action, and diagnostic ids are
  assigned at implementation, append-only.
- The watcher slots, like the firing record, are runtime-internal: not
  serialized, not traced.
- The VM contract documents the gate variants, the trigger host action, and
  the settle-walk watcher resolution; TypeScript and C++ VMs implement all
  of them identically, and mode fixtures byte-match across both VMs.
- Golden coverage names, at minimum: a three-rule ladder where the head
  fires / the middle fires / none fire; a ladder with a parked head; a ladder
  headed by a `then` rule, exercised during the wait and after the fire; a
  migrated bare else pair; bare `then` after a childless sibling and after a
  sibling whose child parks on an awaited actuator across thinks; `then when
  <sensor>` holding and not holding at the wake think; a root-level and a
  child-level `then` chain of three; a chain whose middle subject skips; a
  fired sibling with an empty DO; a sibling that never fires; a faulted
  descendant abandoning the sequence; page exit during a wait and re-entry.

## Scope

Core language, target-agnostic, and a shared-surface feature for both
product apps: document contract + brain compiler + runtime + language
service + editor affordance + assistant bridge.

## Deferred

- **Referencing a named rule.** The modes are preceding-sibling special
  cases of general "did rule R fire" / "did rule R complete" relations. The
  general forms need rule identity, naming, and dangling-reference handling
  in the document model, and have no consumer; the sibling forms cover the
  branching and sequencing patterns.
- **A latching `then` expression** ("then, once shaken, ...") that waits for
  its expression after the completion. Nesting a `when` rule under the
  `then` expresses it; a dedicated form waits for authoring demand.
- **A repeating form** (fire every think after completion until the subject
  re-fires).
- **`otherwise` delivering its subject's WHEN value.** The subject did not
  fire, so its value is falsy or absent by construction, and no consumer is
  known.
