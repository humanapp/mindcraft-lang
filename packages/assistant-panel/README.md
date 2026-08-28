# @wendoo/assistant-panel

The Assistant's conversation machinery for **Wendoo** web applications. This
package owns the relay session, the conversation a brain accumulates, and the
client-side serving of the tool calls a turn asks for. The app that imports it
owns where the conversation is shown.

## What's Included

- **Provider** (`AssistantProvider`, `useAssistant`) -- stands the assistant
  over the tree it wraps and exposes the active brain's conversation, its
  session status, `send`, `stop`, `setActiveBrain` and `openSession`
- **Session machine** (`AssistantStatus`, `AssistantChannel`,
  `AssistantConnect`) -- one session per brain, opened when the brain's panel
  opens or on its first send, one turn at a time per brain, tool calls served
  through `@wendoo/assistant-bridge`
- **WebSocket channel** (`createWebSocketConnect`) -- relay sessions over
  browser WebSockets to the service address the app configures
- **Per-brain conversations** -- one `ConversationRecord` per brain, the record
  format `@wendoo/assistant-relay` defines; a turn keeps filling the
  brain it was sent for whatever the host makes active afterwards
- **Conversation surface** (`AssistantSurface`) -- the entity whose brain is
  open, the conversation it has had with the person, and the box the next thing
  to do is typed into; the app names the entity and mounts the surface wherever
  it shows the conversation

An app that does not import this package has no assistant in its tree at all.

## Usage

This is a **source-only package** -- there is no build step. Consuming apps
resolve the source directly via Vite aliases and tsconfig path mappings.

### Vite config

```js
resolve: {
  alias: {
    "@wendoo/assistant-panel": path.resolve(__dirname, "../../packages/assistant-panel/src"),
  },
},
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "paths": {
      "@wendoo/assistant-panel": ["../../packages/assistant-panel/src/index.ts"],
      "@wendoo/assistant-panel/*": ["../../packages/assistant-panel/src/*"]
    }
  }
}
```

## Integration

Wrap the app mount in `AssistantProvider`, supplying the channel factory, the
tool manifest the handshake declares, and the workspace a brain's tool calls run
against. Nothing connects until a brain's session is opened or its first `send`.

```tsx
import { AssistantProvider, AssistantSurface, createWebSocketConnect } from "@wendoo/assistant-panel";

<AssistantProvider
  connect={createWebSocketConnect(serviceUrl)}
  manifest={manifest}
  workspace={workspaceFor}
>
  <App />
</AssistantProvider>;
```

Mount the surface anywhere under the provider, naming the entity whose brain is
open:

```tsx
<AssistantSurface name={editedBrain.name()} />
```

```tsx
const { status, record, send, stop, setActiveBrain, openSession } = useAssistant();
```

## Package Layout

```
src/
  index.ts                          Barrel export
  assistant-context.ts              AssistantContextValue, useAssistant
  AssistantProvider.tsx             AssistantProvider
  AssistantSurface.tsx              AssistantSurface: the surface bound to the standing session
  ConversationView.tsx              What the surface draws, from the state it is handed
  app/
    edited-brain-workspaces.ts      The workspaces a host serves a turn's tool calls through
    person-activity.ts              What the person has been doing to a brain's rules
    service-url.ts                  The session address a host's setting resolves to
    tool-manifest.ts                The tools the handshake declares, and the tiles installed
  conversation/
    activity.ts                     What one recorded tool call reads as beneath the narration
    blocks.ts                       One turn laid out as the blocks the transcript draws
    brain-places.tsx                Where the rules and pages the entity names stand
    call-identity.ts                The identity two calls share when they ask the same thing
    edit-story.ts                   One row per editor command, in the order they ran
    run.ts                          One rehearsal as the evidence its card is drawn from
    standing.ts                     What a conversation has left standing, record-wide
    store.ts                        Per-brain records, active brain, and the update reducers
    TileChip.tsx                    A tile, rule or page drawn as the chip that names it
    tile-visuals.tsx                How the document's tiles look, against the brain a host stands
    tool-payloads.ts                What a recorded tool call carries, narrowed
  session/
    channel.ts                      AssistantChannel, AssistantConnect
    machine.ts                      AssistantMachine
    presence.ts                     Whether the page is in view, for a quiet reopen
    sessions.ts                     AssistantStatus and each brain's session status
    websocket-channel.ts            createWebSocketConnect
  testing/
    index.ts                        Barrel of the test utilities consumers may drive
    scripted-service.ts             A service that plays scripted turns over a relay loopback
```

## Dependencies

- **@wendoo/assistant-relay** -- the relay wire and the conversation record format
- **@wendoo/assistant-bridge** -- the tools a turn's calls are served with
- **React 19** (peer dependency)

## Development

```bash
npm run check:only   # Biome lint + format check
npm run check        # Auto-fix
npm run typecheck    # TypeScript
npm test             # Specs
```
