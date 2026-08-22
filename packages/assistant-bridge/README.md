# @wendoo/assistant-bridge

The open integration contract an Assistant harness drives a Wendoo target
through: the tool surface, its validation and diagnostics, the catalog digest,
the trace summarizer, and the target adapter interface. No prompts, no model
orchestration, no keys -- a harness supplies those.

## Entry points

- `@wendoo/assistant-bridge` -- the tool contract (definitions,
  executors, name/JSON dispatch, the proposal rejection policy), catalog
  serialization, the trace summarizer, and the `TargetAdapter` interface with
  its contract version and conformance check.
- `@wendoo/assistant-bridge/kit` -- the rehearsal adapter kit: the
  shared implementation of everything target-invariant in a rehearsal adapter,
  plus the conformance suite a target runs against its own adapter. Node only.
- `@wendoo/assistant-bridge/testing` -- a fake target adapter over the
  kit, for exercising the tools and the suite without a target. Node only.

## Implementing a target

A target supplies its modules, its tile documentation, its subjects, and a
world driver -- create a world from a scenario, step it, say whether the
participant under study is still there, tear it down -- and hands them to
`createRehearsalAdapter`. The kit owns the seeded environment, brain
substitution, gate and dispatch observation, the run loop, and run packaging.

The adapter's artifact reports the package it was built from and the contract
version it was built against; a loader cross-checks both, so a stale artifact
fails to load instead of misbehaving. Inject the package name at build time
from the target's own `package.json`.

The kit's API is provisional. It is settled against two world shapes and is
expected to move as a third arrives.
