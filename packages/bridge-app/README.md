# @mindcraft-lang/bridge-app

App-side client for the Mindcraft bridge.

Wraps `@mindcraft-lang/bridge-client` with app-role-specific behavior: automatic join code
management and the `"app"` WebSocket path. Apps that connect to the bridge should depend on
this package rather than using `bridge-client` directly.

## Usage

```typescript
import { createAppBridge } from "@mindcraft-lang/bridge-app";
import { createCompilationFeature } from "@mindcraft-lang/bridge-app/compilation";

const bridge = createAppBridge({
  app: { id: "my-app", name: "My App", projectId: "p1", projectName: "Project" },
  bridgeUrl: "ws://localhost:6464",
  workspace: myWorkspaceAdapter,
  features: [createCompilationFeature({ compiler })],
});

bridge.start();
```

The bridge facade supports:

- `start()` / `stop()` -- lifecycle management
- `requestSync()` -- request a full workspace sync from the VS Code extension
- `snapshot()` -- current connection status and join code
- `onStateChange(...)` / `onRemoteChange(...)` -- event subscriptions

Optional features (like compilation) attach through the `features` array and receive
a `AppBridgeFeatureContext` with workspace access, sync hooks, and diagnostic/status
publication helpers.

## Install

```sh
npm install @mindcraft-lang/bridge-app
```

## License

MIT
