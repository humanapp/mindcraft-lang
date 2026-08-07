import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RelayDownstreamMessage } from "./messages.js";
import type { RelayConnect, RelayToolManifest } from "./session.js";
import { ASSISTANT_RELAY_PROTOCOL_VERSION, RelayRefusalCode } from "./session.js";
import type { RelayLoopback } from "./testing/index.js";
import { createRelayLoopback } from "./testing/index.js";

const manifest: RelayToolManifest = {
  target: "example-org/trg-fake",
  tools: ["compile", "propose_edit", "read_catalog", "read_project", "simulate", "suggest_tiles"],
  morphology: false,
  catalogDigest: "9f2c41ab",
};

/** Answer one connect the way the service does. */
function answerConnect(loopback: RelayLoopback, connect: RelayConnect): void {
  if (connect.protocolVersion !== ASSISTANT_RELAY_PROTOCOL_VERSION) {
    loopback.service.send({
      type: "session:refused",
      code: RelayRefusalCode.ProtocolVersionMismatch,
      protocolVersion: ASSISTANT_RELAY_PROTOCOL_VERSION,
    });
    return;
  }
  loopback.service.send({ type: "session:accepted", sessionId: "01JQ8G0000000000000000" });
}

/** Connect at `protocolVersion` and return what the service answered. */
async function connectAt(protocolVersion: number): Promise<RelayDownstreamMessage> {
  const loopback = createRelayLoopback();
  loopback.toolServer.send({ type: "session:connect", protocolVersion, manifest });

  const connect = await loopback.service.next();
  assert.equal(connect.type, "session:connect");
  answerConnect(loopback, connect);

  return await loopback.toolServer.next();
}

describe("the relay handshake", () => {
  test("opens the session when the client speaks the version the service does", async () => {
    const answer = await connectAt(ASSISTANT_RELAY_PROTOCOL_VERSION);

    assert.equal(answer.type, "session:accepted");
    assert.equal(answer.sessionId, "01JQ8G0000000000000000");
  });

  test("carries the manifest across as the client stated it", async () => {
    const loopback = createRelayLoopback();
    loopback.toolServer.send({
      type: "session:connect",
      protocolVersion: ASSISTANT_RELAY_PROTOCOL_VERSION,
      manifest,
    });

    const connect = await loopback.service.next();

    assert.equal(connect.type, "session:connect");
    assert.deepEqual(connect.manifest, manifest);
  });

  test("refuses a client holding another version and names the version it speaks", async () => {
    const answer = await connectAt(ASSISTANT_RELAY_PROTOCOL_VERSION + 1);

    assert.equal(answer.type, "session:refused");
    assert.equal(answer.code, RelayRefusalCode.ProtocolVersionMismatch);
    assert.equal(answer.protocolVersion, ASSISTANT_RELAY_PROTOCOL_VERSION);
  });
});
