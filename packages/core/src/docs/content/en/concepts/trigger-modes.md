# What Starts a Rule

The capsule at the head of a rule's WHEN side is a switch, and the word on it says
what starts the rule: **WHEN**, **ELSE**, or **THEN**. Click the capsule to step to
the next word. WHEN is the ordinary setting -- the rule gets a turn every time the
brain reaches it. ELSE gives a rule a turn only on the frames the rule above it did
not fire. THEN holds a rule back until the rule above it has finished everything it
started.

Whichever word the capsule shows, the tiles on the WHEN side do their usual job.
The capsule decides whether the rule gets a turn at all; the tiles decide whether it
fires once it has one. A rule with no WHEN tiles fires whenever it gets a turn.

## The First Rule Is Always WHEN

ELSE and THEN both talk about the rule directly above at the same level, so a rule
with nothing above it cannot use them. The first rule in a list keeps WHEN and its
capsule does not switch. Indenting starts a new level, and the first rule at that
level is a WHEN too.

## ELSE: This Rule, or Else That One

Give a rule ELSE and it takes the frames the rule above it did not fire on.

| Trigger | WHEN side | DO side |
| ------- | -------------- | ------- |
| WHEN    | I see food     | eat     |
| ELSE    | (empty)        | wander  |

An ELSE rule with an empty WHEN side is the plain "the rest of the time" branch.
Put tiles on it and it becomes "or else, if ...":

| Trigger | WHEN side        | DO side  |
| ------- | ---------------- | -------- |
| WHEN    | I see food       | eat      |
| ELSE    | I see a predator | run away |
| ELSE    | (empty)          | wander   |

A run of ELSE rules under one WHEN reads top to bottom like a ladder. Each rung gets
its turn only when no rung above it has fired this frame, so at most one rule of the
group fires -- counting the WHEN rule at the top -- and it is the first one whose
condition holds. A last ELSE with an empty WHEN side catches everything the rungs
above it left.

For choices a ladder does not express, indent instead. A rule's children are a fresh
level with their own WHEN, ELSE and THEN.

### While the Rule Above Is Busy

An action can take time -- scrolling a message, playing a sound, moving somewhere.
A rule that started one has already fired, and it counts as fired until that work
finishes, so the ELSE rules below it stay quiet instead of cutting in halfway
through. When the rule above checks its condition again, the group goes back to
taking turns.

## THEN: One Thing After Another

A rule side holds one action, so doing two things in a row means two rules. Give the
second one THEN and it waits for the first.

| Trigger | WHEN side        | DO side       |
| ------- | ---------------- | ------------- |
| WHEN    | button A pressed | scroll "hi"   |
| THEN    | (empty)          | beep          |
| THEN    | (empty)          | scroll "bye"  |

Press the button and the message scrolls. When the scroll has finished, the beep
sounds. When the beep has finished, "bye" scrolls.

"Finished" means more than the DO side. A rule is finished when everything that one
firing started has finished: its own action, the child rules it spawned, their
children, and any THEN rules still waiting inside them. Only then does the THEN below
it get its turn.

If the rule above never fires, the THEN below it never gets a turn, and nothing is
saved up for later.

## Where a Chain Breaks

A THEN rule points at the rule directly above it, so a run of THEN rules is a single
line of steps. If a step does not run, every step below it is skipped too -- the rest
of the line goes with it.

That matters most when a THEN rule carries a condition of its own:

| Trigger | WHEN side        | DO side       |
| ------- | ---------------- | ------------- |
| WHEN    | button A pressed | scroll "hi"   |
| THEN    | shaken           | beep          |
| THEN    | (empty)          | scroll "bye"  |

No shake means no beep **and** no "bye". A step cannot reach past the one above it to
attach itself to the first rule. If you want "bye" either way, take the condition off,
reorder the steps, or move the conditional step off the line and indent it under the
rule it belongs to.

## A THEN Condition Filters, It Does Not Wait

This is the part that surprises people. The tiles on a THEN rule's WHEN side are read
once, at the moment the rule above finishes. If they do not hold right then, the THEN
skips that completion.

Read "THEN when shaken, beep" as "when the scroll finishes, if it is being shaken
right at that moment, beep" -- not as "when the scroll finishes, wait until it is
shaken".

Nothing on the capsule makes a THEN wait for its own condition. To wait, use a
variable as a flag: have the THEN set the flag, and write a separate WHEN rule that
watches for the thing you are waiting for while the flag is set. Have that rule clear
the flag when it fires, so the wait ends.

## ELSE After a THEN: The While-Waiting Branch

An ELSE rule under a THEN takes the frames the THEN did not fire on, and a THEN that
is still waiting has not fired. That makes it a "while waiting" branch.

| Trigger | WHEN side        | DO side       |
| ------- | ---------------- | ------------- |
| WHEN    | button A pressed | scroll "hi"   |
| THEN    | (empty)          | beep          |
| ELSE    | tilted           | show a frown  |

The frown shows on any frame where the beep did not happen and the board is tilted,
including all the frames the scroll is still running. On the frame the beep finally
happens, the ELSE stays quiet.

## How Long a Chain Can Be

Each waiting THEN keeps a little of the device's memory busy for as long as it waits,
so a very long line of steps can run a small device out of room. When that happens the
brain stops with an error rather than quietly hanging, so a chain that is too long for
its device shows up as a fault and not as a step that never arrives. Everyday chains
are nowhere near the limit; how much room there is depends on the device.
