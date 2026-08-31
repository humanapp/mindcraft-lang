---
title: otherwise (the else signal)
status: Superseded
superseded-by: docs/specs/rule-triggers.md
# Active status:   Draft -> Review -> Accepted -> Committed -> In-Progress -> Shipped
# Terminal status: Rejected | Withdrawn | Superseded (set superseded-by)
created: 2026-08-02
updated: 2026-08-31
---

# Spec: otherwise (the else signal)

A core, target-agnostic tile-language feature: a WHEN-side signal source that fires when the
preceding sibling rule did not fire.

## What `otherwise` is

`otherwise` is a **zero-argument boolean sensor** whose signal comes from another rule's firing
outcome rather than from a device or the world:

```
WHEN see carnivore   DO run
WHEN otherwise       DO wander
```

The second rule fires on exactly the thinks the first one did not. It is the tile language's
`else`.

Category properties:

- **An ordinary boolean sensor.** It produces `true` or `false` each evaluation; nothing else in
  the language treats it specially.
- **Inline, WHEN-side only.** It composes into WHEN-side expressions
  (`WHEN otherwise AND see-food`) and stands alone as a complete WHEN (`WHEN otherwise`); it is
  invalid anywhere in a rule's `do` side.
- **Subject: the preceding sibling.** It reports on the rule immediately before it at the same
  level under the same parent (see Scoping).
- **Behavioral, not referential.** Nothing is bound or serialized; at runtime the sensor reads
  the neighboring rule's firing record from brain state (see The firing record).
- **Stateless in itself.** It holds no per-call-site state.
- **Synchronous.** It evaluates within the think and never parks.

## A sensor, not a rule kind

The rule hierarchy is the execution hierarchy: a child rule evaluates because its parent fired.
An else attached to a *parent* inverts that - the parent must not fire and yet still reach into
its children - which pushes a special case into the scheduler and into every consumer of the rule
tree.

Binding `otherwise` to a **sibling** leaves the execution model intact. Siblings are already
evaluated in the same round, in order; the `otherwise` rule evaluates normally and reads a record
its subject has already produced. The hierarchy, the fiber model, and the child-rule cascade are
unchanged.

## Scoping

- The subject is the **immediately preceding sibling** rule: same nesting level, same parent, the
  rule directly above it in the brain's rule order.
- The subject is found **at runtime** from the rule structure the runtime already holds. There is
  no compile-time binding, no serialized reference, and nothing content-dependent: the sensor
  never inspects what the subject contains, only what it did.
- A subject with an **empty WHEN** fires every think it evaluates - an empty WHEN means always -
  so an `otherwise` after one never fires. This falls out of the ordinary mechanics: an empty
  WHEN emits no boundary opcodes, so the rule never writes its record, and the record's initial
  value reads as fired (see The firing record).
- `otherwise` in the **first** rule at its level has no subject and is invalid (see Enforcement).
- Nothing else is addressable: no reference to an arbitrary rule, and no chain spanning more than
  two rules (see `else if` by nesting).

## Firing

`otherwise` fires on a think when its subject **evaluated its WHEN that think and did not fire**:

| Subject this think | `otherwise` |
| ------------------ | ----------- |
| Evaluated, fired | does not fire |
| Evaluated, did not fire | fires |
| Did not evaluate | does not fire |

The third row carries the design, and the parked subject is its central case. A rule parked on an
awaited actuator **fired**: its WHEN condition held, and its DO is taking time to complete. That
is not an `otherwise` condition - `otherwise` responds to the WHEN side not holding, never to the
DO side's progress - so the `otherwise` branch stays quiet for as long as the subject's work is in
flight. Mechanically this needs nothing extra: a parked rule does not re-evaluate its WHEN, so its
record still holds the `DidFire` its last evaluation wrote, and `otherwise` stays quiet. When the
work completes and the subject next evaluates its WHEN, the complement resumes.

### A per-think complement, not mutual exclusion

The two branches are complementary **per think**, not locked against each other for the duration
of their actions. If the `otherwise` branch starts a long awaited action and the subject's
condition becomes true several thinks later, the subject fires while the `otherwise` branch's
action is still in flight, and both branches are active. This follows from actions being temporal
and matches every other pair of rules in the language; `otherwise` does not suppress it.

## The firing record

Each rule carries one small record: a three-state value.

- **`Evaluating`** - the rule has begun its WHEN check and not yet completed it.
- **`DidFire`** - the rule's most recent completed WHEN evaluation fired.
- **`DidNotFire`** - the rule's most recent completed WHEN evaluation did not fire.

The runtime writes it at the WHEN boundary opcodes the compiler already emits: `WHEN_START`
writes `Evaluating`, and the two gates - the truthiness gate and the presence gate - write the
outcome, `DidFire` or `DidNotFire`. Both gates already compute the outcome; the record stores
it, never re-derives it from the value.

`otherwise` reads its subject's record: `DidNotFire` fires; `DidFire` and `Evaluating` do not.

**The initial value is `DidFire`.** A rule with an empty WHEN emits no WHEN boundary opcodes at
all, so it never writes its record; the initial value makes it read as always-fired - an empty
WHEN means always - with no special emission and no bytecode change. For every other rule the
initial value is unobservable: siblings evaluate top-down, so a subject begins or completes its
WHEN check before the `otherwise` after it reads.

Freshness needs no timestamps. On a think where both rules evaluate, the subject writes before
the `otherwise` reads, by evaluation order. On a think where the subject does not run, the
record already holds the right answer: a rule parked or quiesced mid-DO last completed a fire
(`DidFire`, quiet), and a rule stopped mid-WHEN-check - a budget split or a fault - reads
`Evaluating` (quiet). A brain re-initialization rebuilds the store at its initial value.

### The WHEN value cannot substitute for the record

The captured WHEN **value** is deliberately the pre-gate value, and two different gates consume
it:

- the ordinary gate fires on **truthiness**;
- a presence-gated sensor fires on **presence**, so a present-but-falsy value - a received `0`, an
  empty string, `false` - fires the rule.

Deriving "did not fire" by testing the truthiness of the subject's WHEN value therefore reports
the wrong answer for every presence-gated sensor delivering a falsy value, silently and
data-dependently. The gate outcome is recorded because it cannot be reconstructed from the value.

## Evaluation order

`otherwise` requires its subject to have evaluated first within the think. Rule evaluation already
provides this, with one bounded exception.

- **Child siblings.** Child siblings evaluate top-down in document order, exactly as root
  siblings do: a parent spawns its children in document order into the same-think drain, which
  runs them depth-first in that order, and a root rule does not re-fire while any descendant is
  in flight. Child siblings therefore always evaluate together, in order, in the same think.
  This top-down order is a requirement of this spec, not an observation.
- **Root siblings.** Root rules are spawned in document order from the page's root-rule list at
  the top of each think and the round runs its queue first-in-first-out, so root rules respawned
  in the same think evaluate their WHEN in document order.
- **The exception.** A fiber receives one instruction-budget slice per round. A WHEN expensive
  enough to exhaust its slice yields, and its gate lands in the following think, after its
  `otherwise` sibling has already evaluated. The record covers this: the subject's record holds
  `Evaluating`, so `otherwise` does not fire. The same slice rule can split the `otherwise`
  rule's own evaluation across thinks; its read then lands one think late and sees the subject's
  most recent completed outcome - the complement runs one think behind, and never on an answer
  that was not computed.

The `Evaluating` state is what makes the budget case explicit rather than incidental, just as
the retained `DidFire` makes the parked case so.

## The WHEN result of an `otherwise` rule

`otherwise` is an ordinary boolean sensor, and the ordinary rules apply. A rule whose WHEN is
`otherwise` captures the boolean as its WHEN result - `true` on every firing think - and a
consumer of that result sees a boolean, exactly as it would below any other boolean sensor. In a
larger WHEN expression, the expression's final value is the rule's result, as always.

## `else if` by nesting

`otherwise` pairs; ladders come from the hierarchy that already exists:

```
WHEN a           DO x
WHEN otherwise                    // fires when a did not
    WHEN b       DO y             // else if b
    WHEN otherwise  DO z          // else
```

The inner `otherwise` takes its own level's preceding sibling as its subject and evaluates only
because its parent fired, which composes to if / else-if / else with no chain concept.

A flat run of `otherwise` rules is legal and expresses something different. Each rule's subject is
the one directly above it, so the run **alternates**: the third rule fires whenever the second
evaluated and did not fire - which, while every rule's actions complete within the think, is every
think the first one fired. A rule parked on an awaited action drops out of the alternation until
it evaluates again (see Firing). Extending the run continues the alternation. That is a usable
pattern in its own right; it simply is not a ladder, and an if / else-if / else ladder nests.

## Enforcement

The category rules are compile-time validations, and the picker agrees with the compiler:

- The compiler rejects, with error-severity diagnostics: `otherwise` anywhere outside a WHEN, and
  `otherwise` in the first rule at its level, which has no subject.
- `otherwise` adds no composition rule of its own. It is an inline boolean sensor, and how it
  combines with other WHEN-side tiles is governed by the ordinary WHEN grammar. Several
  `otherwise` tiles in one WHEN all read the same subject and carry the same value.
- The picker offers `otherwise` only where the compiler accepts it, and the suggestion-compiler
  consistency oracle covers it in both directions.
- **Document edits need no special handling.** There is no stored reference, so nothing dangles:
  removing rules above an `otherwise` re-derives its subject on the next compile, and an
  `otherwise` left first at its level is caught by the diagnostic above.

## Sentence composition

- `otherwise` is **one word segment** carrying its tile's span, and it is the whole WHEN clause of
  its rule: "When I see a carnivore, run. Otherwise, wander."
- It renders through the ordinary sensor path with no negated-frame handling, since it negates a
  rule's outcome rather than a clause's content.
- In a larger WHEN expression it reads through the ordinary expression rendering, like any other
  inline boolean sensor.
- The word localizes under the tile-label context like every tile word.

## Runtime and conformance

- The change is **runtime and compiler only**: a firing record written at the WHEN boundary
  opcodes the compiler already emits (`WHEN_START` and the two gates), and a sensor that derives
  its subject from the rule order the runtime already holds and reads the record. Nothing new is
  serialized: no new opcode, no bytecode-format change, no document change, so existing goldens
  are unaffected.
- The wodal module is the oracle and the C++ VM mirrors it; both write and read the record
  identically, and new `otherwise` fixtures byte-match across both VMs.
- Golden coverage names, at minimum: an `otherwise` pair over a subject that fires and one that
  does not, including a presence-gated subject delivering a falsy value; an `otherwise` whose
  subject is parked on an awaited actuator across several thinks; a nested else-if ladder; a flat
  alternating run; an `otherwise` after an empty-WHEN rule; an `otherwise` composed into a larger
  WHEN expression; and a page re-entry.
- Tile and function ids are assigned at implementation, append-only.

## Scope

Core language, target-agnostic, and a shared-surface feature for both product apps: brain compiler
+ runtime record + language service + editor tile category.

## Deferred

- **Referencing a named rule.** `otherwise` is the preceding-sibling special case of a general
  "did rule R fire" sensor. The general form needs rule identity, naming, and dangling-reference
  handling in the document model, and has no consumer; the sibling form covers the else pattern.
- **A subject other than the immediately preceding sibling** - for example the nearest preceding
  sibling that is not itself an `otherwise` - which would let flat ladders compose. Nesting
  already expresses this, so the added scoping rule waits for a real authoring complaint.
- **`otherwise` delivering its subject's WHEN value.** The subject did not fire, so its value is
  falsy or absent by construction, and no consumer is known.
