# @mindcraft-lang/bridge-app

App-side client for the Mindcraft bridge.

Wraps `@mindcraft-lang/bridge-client` with app-role-specific behavior: automatic join code
management and the `"app"` WebSocket path. Apps that connect to the bridge should depend on
this package rather than using `bridge-client` directly.

## Install

```sh
npm install @mindcraft-lang/bridge-app
```

## License

MIT
