# @mindcraft-lang/assistant-relay

Protocol types and schemas for the assistant relay session.

The hosted Assistant runs as a split loop: a service holds the model
conversation and is the tool client, and the target app serves the assistant
bridge's tools against the live document. This package defines the wire between
them -- the session handshake, the turn events the service sends downstream, and
the tool-call and control messages the client sends upstream -- plus an
in-memory loopback pairing of the two ends under `@mindcraft-lang/assistant-relay/testing`.

## Install

```sh
npm install @mindcraft-lang/assistant-relay
```

## License

MIT
