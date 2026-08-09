/**
 * Pins what the conversation surface stands: a disabled intent box, and a
 * mount that costs the session nothing.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace } from "@mindcraft-lang/assistant-bridge";
import { FAKE_TARGET_IDENTITY } from "@mindcraft-lang/assistant-bridge/testing";
import type { RelayToolManifest } from "@mindcraft-lang/assistant-relay";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantProvider } from "./AssistantProvider";
import { AssistantSurface } from "./AssistantSurface";
import type { AssistantChannel } from "./session/channel";

/** What the client declares it serves. */
const manifest: RelayToolManifest = {
  target: FAKE_TARGET_IDENTITY,
  tools: ["read_catalog"],
  morphology: false,
  catalogDigest: "0f3a19c2",
};

/** A workspace accessor no test reaches. */
function unreachedWorkspace(): AuthoringWorkspace {
  throw new Error("the surface specs serve no tool call");
}

describe("the conversation surface", () => {
  test("stands an intent box that takes nothing", () => {
    const markup = renderToStaticMarkup(<AssistantSurface />);

    assert.match(markup, /<textarea[^>]*\bdisabled\b/);
    assert.match(markup, /<button[^>]*\bdisabled\b/);
  });

  test("opens no session by standing under a provider", () => {
    let connects = 0;
    const connect = (): Promise<AssistantChannel> => {
      connects++;
      return Promise.reject(new Error("no route to the service"));
    };

    renderToStaticMarkup(
      <AssistantProvider connect={connect} manifest={manifest} workspace={unreachedWorkspace}>
        <AssistantSurface />
      </AssistantProvider>
    );

    assert.equal(connects, 0);
  });
});
