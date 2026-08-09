# @mindcraft-lang/assistant-panel

The Assistant's conversation machinery for **Mindcraft** web applications. This
package owns the relay session, the conversation a brain accumulates, and the
client-side serving of the tool calls a turn asks for. The app that imports it
owns where the conversation is shown.

## What's Included

- **Provider** (`AssistantProvider`, `useAssistant`) -- stands one assistant
  session over the tree it wraps and exposes the active brain's conversation,
  the session status, `send`, `stop` and `setActiveBrain`
- **Session machine** (`AssistantStatus`, `AssistantChannel`,
  `AssistantConnect`) -- lazy connect on the first send, one turn at a time,
  tool calls served through `@mindcraft-lang/assistant-bridge`
- **Per-brain conversations** -- one `ConversationRecord` per brain, the record
  format `@mindcraft-lang/assistant-relay` defines; a turn keeps filling the
  brain it was sent for whatever the host makes active afterwards

An app that does not import this package has no assistant in its tree at all.

## Usage

This is a **source-only package** -- there is no build step. Consuming apps
resolve the source directly via Vite aliases and tsconfig path mappings.

### Vite config

```js
resolve: {
  alias: {
    "@mindcraft-lang/assistant-panel": path.resolve(__dirname, "../../packages/assistant-panel/src"),
  },
},
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "paths": {
      "@mindcraft-lang/assistant-panel": ["../../packages/assistant-panel/src/index.ts"],
      "@mindcraft-lang/assistant-panel/*": ["../../packages/assistant-panel/src/*"]
    }
  }
}
```

## Integration

Wrap the app mount in `AssistantProvider`, supplying the channel factory, the
tool manifest the handshake declares, and the workspace a brain's tool calls run
against. Nothing connects until the first `send`.

```tsx
import { AssistantProvider, useAssistant } from "@mindcraft-lang/assistant-panel";

<AssistantProvider connect={openSession} manifest={manifest} workspace={workspaceFor}>
  <App />
</AssistantProvider>;
```

```tsx
const { status, record, send, stop, setActiveBrain } = useAssistant();
```

## Package Layout

```
src/
  index.ts                          Barrel export
  AssistantProvider.tsx             AssistantProvider, useAssistant, AssistantContextValue
  conversation/
    store.ts                        Per-brain records, active brain, and the update reducers
  session/
    channel.ts                      AssistantChannel, AssistantConnect
    machine.ts                      AssistantMachine, AssistantStatus
```

## Dependencies

- **@mindcraft-lang/assistant-relay** -- the relay wire and the conversation record format
- **@mindcraft-lang/assistant-bridge** -- the tools a turn's calls are served with
- **React 19** (peer dependency)

## Development

```bash
npm run check:only   # Biome lint + format check
npm run check        # Auto-fix
npm run typecheck    # TypeScript
npm test             # Specs
```
