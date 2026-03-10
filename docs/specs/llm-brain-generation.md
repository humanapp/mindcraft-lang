# LLM-Powered Brain Code Generation

## Overview

Enable users to describe behavior in natural language and have an LLM generate valid
brain code (tile sequences) for the Mindcraft system. The LLM receives a system prompt
describing the tile language grammar and semantics, outputs BrainJson (the existing
serialization format), which gets deserialized into a BrainDef via `fromJson()` and
loaded into the editor.

## End-to-End Flow

### Single-turn (generation)

```
User prompt ("make the animal chase herbivores and eat them")
  -> Client UI (chat panel in brain editor)
    -> Server API route (system prompt + user prompt)
      -> LLM API call (GPT-4o-mini / Haiku)
        -> LLM returns full BrainJson
      -> Validate via brainJsonFromPlain() -> BrainDef.fromJson()
      -> On failure: retry with error feedback (1-2x max)
    -> Return valid BrainDef to client
  -> Apply via ReplaceBrainCommand (undoable)
  -> User reviews & accepts/edits
```

### Multi-turn (iterative editing)

```
User follow-up ("also make it run away from carnivores")
  -> Client UI (appends to conversation history)
    -> Server API route (system prompt + history + current brain state)
      -> LLM API call
        -> LLM returns edit payload (changed pages only + new catalog entries)
      -> Validate changed pages
    -> Client merges changed pages into current brain by pageId
    -> Apply merged result via ReplaceBrainCommand (undoable per-turn)
  -> User reviews & accepts/edits
  -> (repeat)
```

## Model Selection

**Recommended: GPT-4o-mini or Claude 3.5 Haiku**

The task is structured JSON generation with a constrained output space (valid tile ID
sequences in a known schema), not open-ended reasoning. Small models excel at this:

- Fast (sub-second for typical brain outputs)
- Cheap (~$0.001 per generation at ~3000-5000 token system prompts)
- Excellent at JSON generation with schemas
- OpenAI's structured output mode (`response_format: json_schema`) can guarantee valid
  JSON matching the BrainJson schema, eliminating parse failures entirely

If quality is insufficient, stepping up to GPT-4o or Claude Sonnet is a one-line config
change. The architecture should make model swapping trivial.

## Output Format

The LLM outputs BrainJson -- the existing JSON serialization format. This reuses
production-grade deserialization (`BrainDef.fromJson()`, `brainJsonFromPlain()`),
is test-proven for round-trip fidelity, and requires no new format.

BrainJson structure:

```json
{
  "version": 1,
  "name": "Generated Brain",
  "catalog": [
    {
      "version": 2,
      "kind": "literal",
      "tileId": "tile.lit->number:42",
      "valueType": "type.number",
      "value": 42,
      "valueLabel": "42",
      "displayFormat": "default"
    },
    {
      "version": 1,
      "kind": "variable",
      "tileId": "tile.var->uuid-abc",
      "varName": "myVar",
      "varType": "type.number",
      "uniqueId": "uuid-abc"
    }
  ],
  "pages": [
    {
      "version": 2,
      "pageId": "page-uuid",
      "name": "Main Page",
      "rules": [
        {
          "version": 1,
          "when": ["tile.sensor->sensor.see", "tile.modifier->modifier.actor_kind.herbivore"],
          "do": ["tile.actuator->actuator.move", "tile.modifier->modifier.movement.toward"],
          "children": []
        }
      ]
    }
  ]
}
```

Only persistent tiles (literals, variables, pages) go in the catalog. Operators, sensors,
actuators, modifiers, and parameters are referenced by global tile ID in rule arrays.

### Edit Payload (multi-turn)

On subsequent turns, the LLM outputs only changed pages and new catalog entries instead
of reproducing the entire brain. This avoids token bloat and eliminates accidental
deletion of untouched rules.

```json
{
  "mode": "edit",
  "changedPages": [
    {
      "version": 2,
      "pageId": "existing-page-id",
      "name": "Main Page",
      "rules": [...]
    }
  ],
  "addedCatalog": [
    {"version": 1, "kind": "variable", "tileId": "tile.var->new-uuid", "varName": "speed", "varType": "type.number", "uniqueId": "new-uuid"}
  ],
  "removedPageIds": []
}
```

The client merges this into the current brain: match changed pages by `pageId` and
replace, append new catalog entries (deduplicate by `tileId`), remove any pages listed
in `removedPageIds`. The merged result is validated, then applied via
`ReplaceBrainCommand`.

The LLM must preserve existing `uniqueId`, `pageId`, and `tileId` values for entities
it did not create. When adding new variables, it generates new `uniqueId` values that
do not collide with existing ones.

## Implementation

### Phase 1: System Prompt Engineering

**Step 1 -- Build system prompt template**

The system prompt (~3000-5000 tokens) contains:

| Section           | Content                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Role              | "You generate brain code for Mindcraft, a visual programming system"                                                            |
| Language overview | Pages, rules, WHEN/DO sides, nesting, execution model                                                                           |
| Output schema     | BrainJson with catalog (literals/variables) + pages (rules with tile ID arrays)                                                 |
| Tile reference    | All operators, sensors, actuators, modifiers, parameters, literals, variables -- with IDs, placement, types, and argument rules |
| Call spec rules   | Which modifiers/params are valid per sensor/actuator, ordering, repetition limits, mutual exclusion                             |
| Expression rules  | Operator precedence, type coercion, parenthesization                                                                            |
| Few-shot examples | 5-10 NL -> BrainJson pairs                                                                                                      |

**Step 2 -- Create tile catalog export function** _(parallel with step 1)_

Build a function in `packages/core/` that programmatically generates the tile reference
section of the system prompt from the live TileCatalog + FunctionRegistry. This ensures
the prompt stays in sync as tiles are added or changed.

- Export tile IDs, placement flags, call specs, output types
- Accept multiple catalogs (core + app-specific), matching the existing
  `suggestTiles(context, catalogs: ReadonlyList<ITileCatalog>)` pattern
- Output as structured prose (LLMs read prose better than raw JSON for instructions)

**Step 3 -- Curate few-shot examples** _(depends on step 1)_

Source from existing docs content (`apps/sim/src/docs/content/en/tiles/`) and test
fixtures. Each example:

- Natural language description
- Complete BrainJson output
- Brief annotation of why specific tiles were chosen

Example patterns to cover:

- Chase and eat (see + move toward + eat)
- Flee from predators (see + move away-from)
- Wander randomly (move wander)
- Conditional logic (if energy < 50, move slowly)
- Page switching (on-page-entered + switch-page)
- Shooting at targets (see + shoot)
- Saying things (say with text)
- Timer/timeout conditions
- Nested rules (parent WHEN gates children)
- Variable assignment and comparison

### Phase 2: LLM Integration

**Step 4 -- Build LLM service module** _(depends on steps 1-3)_

- System prompt assembly from step 1-2 outputs + current brain context
- User prompt formatting
- LLM API call (OpenAI or Anthropic SDK)
- Response parsing: extract JSON from LLM output
- Validation: `brainJsonFromPlain()` -> `BrainDef.fromJson()` with error handling
- Self-correction retry: on validation failure, send error back to LLM (1-2 retries max)

**Step 5 -- Add context injection** _(parallel with step 4)_

Include the user's current brain state so the LLM can make additive edits:

- Current brain serialized as BrainJson
- Available variables and their types
- Page names and structure
- Which rule/page the user is focused on (if editing a specific part)

**Step 6 -- Conversation state management** _(parallel with step 4)_

- Message history: array of `{role, content}` pairs, stored client-side
- Session ID to associate messages with a conversation
- Brain snapshots: after each accepted turn, snapshot the brain state as the ground
  truth for the next turn's context injection (not the LLM's output, since the user
  may hand-edit between turns)
- History truncation: summarize or drop early turns when context grows long; the
  current brain state is always injected fresh, so losing history of how you got
  there is acceptable

**Step 7 -- Server API route** _(depends on step 4)_

Server-side API route in the sim app for:

- API key management (user provides key, stored client-side, proxied through server)
- Rate limiting
- Request/response logging

### Phase 3: UI Integration

**Step 8 -- Chat panel UI** _(depends on step 7)_

Persistent chat panel (sidebar or bottom panel, not a modal) in the brain editor:

- Message history display (conversation thread)
- Text input with submit button + loading state
- Preview of generated/changed rules before accepting
- Indicators showing which pages/rules were added or modified in each turn

**Step 9 -- Accept/reject/edit workflow** _(depends on step 8)_

- Show generated rules in a preview pane
- Allow user to accept all, accept per-rule, or dismiss
- On accept, deserialize and merge into current BrainDef
- Undo per-turn: revert to the brain state before a specific LLM turn
- User can hand-edit the brain between LLM turns; the next turn picks up the
  actual current state
- Session lifecycle: clear conversation / start new session

### Applying Edits via the Command System

All LLM output is applied through the existing `BrainCommand` infrastructure:

- **Generation (turn 1)**: Wrap the validated BrainJson in a `ReplaceBrainCommand`.
  This snapshots the before-state automatically, giving undo for free.
- **Iterative edits (subsequent turns)**: Merge changed pages into the current brain
  client-side, then apply the merged result via `ReplaceBrainCommand`. Each turn is
  a single undoable operation.
- The user can undo the last LLM edit, hand-tweak the brain, and try a different
  prompt -- the command history stays coherent.

## System Prompt Detail

### Tile Reference (auto-generated from catalogs)

**Operators** (15):

- Arithmetic: `tile.op->add`, `tile.op->sub`, `tile.op->mul`, `tile.op->div`, `tile.op->neg`
- Comparison: `tile.op->eq`, `tile.op->ne`, `tile.op->lt`, `tile.op->le`, `tile.op->gt`, `tile.op->ge`
- Logical: `tile.op->and`, `tile.op->or`, `tile.op->not`
- Assignment: `tile.op->assign`
- Placement: comparisons are WhenSide only, assign is DoSide only, rest are EitherSide

**Core Sensors** (4):

- `tile.sensor->random` -- inline, returns number (0-1), EitherSide
- `tile.sensor->current-page` -- inline, returns string, EitherSide
- `tile.sensor->on-page-entered` -- returns boolean, WhenSide only, fires once per page entry
- `tile.sensor->sensor.timeout` -- returns boolean, WhenSide only, optional duration (number) parameter

**Core Actuators** (3):

- `tile.actuator->switch-page` -- DoSide, takes number (1-based index) or string (page name/ID)
- `tile.actuator->restart-page` -- DoSide, no args (deprecated)
- `tile.actuator->yield` -- DoSide, no args

**Sim Sensors** (2):

- `tile.sensor->sensor.see` -- WhenSide, boolean. Optional modifiers: archetype filter (carnivore|herbivore|plant), distance filter (nearby|faraway, repeatable 0-3x). Sets targetActor capability for DO side.
- `tile.sensor->sensor.bump` -- WhenSide, boolean. Optional modifiers: archetype filter (carnivore|herbivore|plant). Sets targetActor capability.

**Sim Actuators** (5):

- `tile.actuator->actuator.move` -- DoSide. Required: direction modifier (forward|toward|away-from|avoid|wander). Toward/away-from/avoid accept optional ActorRef parameter. Optional: speed modifier (quickly|slowly, 0-3x), priority parameter (number).
- `tile.actuator->actuator.turn` -- DoSide. Required: direction modifier (toward|away-from|around|left|right|north|south|east|west). Toward/away-from accept optional ActorRef. Optional: speed, priority.
- `tile.actuator->actuator.eat` -- DoSide. Optional ActorRef parameter.
- `tile.actuator->actuator.say` -- DoSide. Optional string parameter, optional duration parameter.
- `tile.actuator->actuator.shoot` -- DoSide. Optional ActorRef parameter, optional rate parameter (number, shots/sec).

**Modifiers** (22):

- Movement direction: `modifier.movement.forward`, `modifier.movement.toward`, `modifier.movement.awayfrom`, `modifier.movement.avoid`, `modifier.movement.wander`
- Turn direction: `modifier.turn.around`, `modifier.turn.left`, `modifier.turn.right`
- Compass: `modifier.direction.north`, `modifier.direction.south`, `modifier.direction.east`, `modifier.direction.west`
- Distance: `modifier.distance.nearby` (repeatable 0-3x), `modifier.distance.faraway` (repeatable 0-3x)
- Actor kind: `modifier.actor_kind.carnivore`, `modifier.actor_kind.herbivore`, `modifier.actor_kind.plant`
- Speed: `modifier.quickly` (repeatable 0-3x), `modifier.slowly` (repeatable 0-3x)
- Time: `modifier.time.ms`, `modifier.time.secs`

**Parameters** (8):

- Core: `tile.parameter->anon.number`, `tile.parameter->anon.string`, `tile.parameter->anon.boolean`
- Sim: `anon.actorRef`, `parameter.duration`, `parameter.priority`, `parameter.rate`, `parameter.delay.ms`

**Literals**:

- Number: `tile.lit->number:<value>` (e.g., `tile.lit->number:42`)
- String: `tile.lit->string:<value>`
- Boolean: `tile.lit->boolean:true`, `tile.lit->boolean:false`
- ActorRef: `[me]` (current actor), `[it]` (target actor, requires targetActor capability)

**Variables**: `tile.var-><uniqueId>` -- typed (number, boolean, string, ActorRef, Vector2, plus list/map variants). Must be declared in catalog.

### Call Spec Argument Rules

Each sensor/actuator accepts arguments according to its call spec grammar:

- **bag**: unordered set -- modifiers/parameters can appear in any order
- **choice**: exactly one of N options (mutually exclusive)
- **optional**: zero or one occurrence
- **repeat**: multiple allowed with min/max bounds (e.g., quickly max 3x)
- **seq**: all items in specified order
- **conditional**: branch based on whether a named spec matched

The LLM must produce tile sequences that satisfy these grammars. Invalid combinations
(e.g., both `toward` and `wander` on the same `move`) will fail validation.

### Expression Rules

- WHEN side is parsed as a single expression; non-zero/non-false = true
- DO side is parsed as a sequence of expressions (statements)
- Operator precedence: or(1) < and(2) < eq/ne(4) < lt/le/gt/ge(5) < add/sub(10) < mul/div(20) < neg/not(30)
- Parenthesization via `tile.cf->open-paren` and `tile.cf->close-paren`
- Implicit type coercion: number <-> boolean, number <-> string

## Relevant Files

- `packages/core/src/brain/model/brain-json.ts` -- BrainJson types, `brainJsonFromPlain()` validator
- `packages/core/src/brain/model/braindef.ts` -- `BrainDef.toJson()` / `fromJson()`
- `packages/core/src/brain/model/brain-json.spec.ts` -- JSON round-trip tests
- `packages/core/src/brain/interfaces/tiles.ts` -- Tile type definitions, IDs, placement flags
- `packages/core/src/brain/interfaces/call-spec.ts` -- Call spec grammar types and builders
- `packages/core/src/brain/interfaces/operators.ts` -- Operator IDs and precedence
- `packages/core/src/brain/tiles/catalog.ts` -- TileCatalog registration
- `packages/core/src/brain/tiles/sensors.ts` -- Core sensor tile defs
- `packages/core/src/brain/tiles/actuators.ts` -- Core actuator tile defs
- `packages/core/src/brain/tiles/operators.ts` -- Operator tile defs
- `apps/sim/src/brain/tiles/index.ts` -- Sim-specific tile registration orchestration
- `apps/sim/src/brain/fns/sensors/see.ts` -- See sensor implementation
- `apps/sim/src/brain/fns/sensors/bump.ts` -- Bump sensor implementation
- `apps/sim/src/brain/fns/actuators/move.ts` -- Move actuator implementation
- `apps/sim/src/brain/fns/actuators/turn.ts` -- Turn actuator implementation
- `apps/sim/src/brain/fns/actuators/eat.ts` -- Eat actuator implementation
- `apps/sim/src/brain/fns/actuators/say.ts` -- Say actuator implementation
- `apps/sim/src/brain/fns/actuators/shoot.ts` -- Shoot actuator implementation
- `apps/sim/src/docs/content/en/` -- Existing tile docs (few-shot material)
- `packages/docs/src/DocsRegistry.ts` -- Documentation registry pattern
- `packages/ui/src/brain-editor/commands/` -- BrainCommand system (undo/redo)
- `packages/ui/src/brain-editor/commands/BrainCommands.ts` -- `ReplaceBrainCommand` for applying LLM output

## Verification

1. Test system prompt + 20 diverse NL inputs against chosen LLM; measure % that
   deserialize successfully via `BrainDef.fromJson()` without modification
2. Round-trip: generate -> serialize -> deserialize -> compile -> verify zero
   parse/compile errors
3. Load generated brains in sim, verify actors behave as described
4. Test edge cases: ambiguous prompts, impossible requests, references to nonexistent tiles
5. Measure token usage per generation to validate cost estimates
6. Multi-turn: run 5-turn editing sessions that progressively build up a complex brain;
   verify no rules are silently dropped, existing variable/page IDs are preserved, and
   each turn's undo correctly reverts to the prior state
7. Merge correctness: verify page-scoped edits merge cleanly when the user has
   hand-edited the brain between LLM turns

## Decisions

- **Output format**: BrainJson for generation; page-scoped edit payload for multi-turn
  (hybrid approach -- see "Edit payload" above)
- **Model class**: GPT-4o-mini or Haiku (structured output task, not reasoning).
  Architecture supports model escalation for long sessions if needed.
- **Integration point**: Server-side API route (key management, rate limiting)
- **Multi-turn**: Supported via conversation history + page-scoped edits. Not editor
  commands -- the LLM outputs declarative structures, and the command system
  (`ReplaceBrainCommand`) is used to apply them with undo/redo.
- **In scope**: Full brain generation from prompt, iterative multi-turn editing of
  existing brains, system prompt engineering, programmatic tile catalog export
- **Out of scope**: Fine-tuning a custom model, real-time tile streaming, voice input

## Open Considerations

1. **App-composable prompts**: The prompt builder should be composable -- core tiles are
   universal, sim-specific tiles vary by app. Each app plugs in its own tile descriptions,
   matching the existing `suggestTiles(context, catalogs)` multi-catalog pattern. This
   means the LLM integration is reusable across different Mindcraft apps.

2. **Token budget growth**: If the tile catalog grows significantly, the system prompt
   may exceed efficient sizes. A two-phase approach could help: first classify which
   tiles are relevant to the user's request, then generate with a filtered prompt.

3. **Structured output mode vs. free-form JSON**: OpenAI's `response_format: json_schema`
   guarantees syntactically valid JSON matching a schema. This eliminates parse failures
   but constrains the schema to what json_schema supports. Anthropic lacks an equivalent
   but handles JSON well with explicit instructions. Recommend starting with OpenAI
   structured output and adding Anthropic as a fallback.

## Open Questions (resolve before implementation)

### Must-have (blocks implementation)

1. **Server infrastructure**: The sim app is a Vite SPA with no backend. What hosts the
   API route? Options: Vite dev server middleware + serverless for production, a separate
   service, or skip the server entirely and do client-side LLM calls for v1 (accepting
   API-key-in-browser tradeoff).

2. **Module placement**: Where does each piece of code live?
   - Tile catalog export function: `packages/core/src/brain/llm/`? Needs to be
     app-agnostic since it accepts multiple catalogs.
   - LLM service module (API call, validation, retry): `apps/sim/src/services/`?
     App-specific since it depends on server infrastructure.
   - Conversation state manager: `packages/ui/`? Or sim app?
   - Chat panel component: `packages/ui/src/brain-editor/` alongside existing editor
     components? Or sim app?

3. **Edit payload TypeScript types**: The edit payload JSON shape is shown but has no
   TypeScript interface. Define a discriminated union alongside BrainJson
   (`{ mode: "generate", ...BrainJson } | { mode: "edit", changedPages, addedCatalog,
removedPageIds }`)? Or a separate type with a separate validator? How does
   `brainJsonFromPlain()` relate to edit payload validation?

4. **Mode discrimination**: How does the system decide whether to request full BrainJson
   vs. edit payload? Always full on first message and edit on subsequent ones? A system
   prompt instruction? A separate `mode` field in the API request selecting different
   prompt variants?

5. **LLM message format**: What is the concrete messages array sent to the LLM?
   - Shape: `[system, ...history, user]`?
   - Where does the current brain state go? System message? Injected into the latest
     user message? A separate message?
   - Are the LLM's previous JSON outputs included in history verbatim (costs tokens)
     or summarized?
   - How are assistant messages stored -- raw JSON response, a summary, or both?

### Should-have (blocks quality)

6. **Few-shot examples**: The spec lists 10 patterns but includes zero complete examples.
   Need at least 3 fully worked NL -> BrainJson pairs before prompt engineering can
   begin. Source from existing tile docs and test fixtures.

7. **Merge edge cases**: The merge logic needs defined behavior for:
   - LLM returns a `pageId` that doesn't exist in the current brain (create? error?)
   - `addedCatalog` contains a `tileId` colliding with an existing entry but with
     different properties (e.g., same variable ID, different type)
   - User deleted a page between turns and the LLM returns edits for that page
   - Orphaned catalog entries no longer referenced by any rule after merge

8. **Tile catalog export output format**: Step 2 says "structured prose" but doesn't
   define the format. Markdown tables? Numbered lists? The string template matters for
   prompt quality. Should match what's in the System Prompt Detail section or be a
   defined alternative.

### Nice-to-have (can defer to iteration)

9. **Per-rule acceptance**: Steps 8-9 mention "accept per-rule" but this requires
   rule-level merge logic (can't apply a changed page wholesale if one rule is rejected).
   Consider starting with accept-all / reject-all for v1.

10. **API key UX**: Where does the user enter their key? Settings dialog? First-use
    prompt? Storage mechanism (localStorage)? How is the key passed to the server?
    What happens on invalid/rate-limited keys? Is there a "use our key" (hosted) mode
    vs. BYOK? A simple localStorage + settings dialog suffices for v1.

11. **Error UX**: What does the user see when retries are exhausted? Is there a
    distinction between "bad JSON" (retryable) and "semantically invalid brain code"
    (needs user-facing error)? A generic "generation failed, try again" suffices
    initially.

12. **Catalog export timing**: Is the tile catalog export function called at build time
    (static string baked into server), at runtime (always current, needs catalog access),
    or once at app startup (cached)? Runtime is most flexible but requires the sim app
    context for access to both core and sim-specific catalogs.
