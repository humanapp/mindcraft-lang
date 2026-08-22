/**
 * Pins what the bound surface stands: the entity the host named, an intent box
 * that takes the keyboard from nobody it was not handed to, and a mount that
 * costs the session nothing.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { AuthoringWorkspace } from "@wendoo/assistant-bridge";
import { FAKE_TARGET_IDENTITY } from "@wendoo/assistant-bridge/testing";
import type { RelayToolManifest } from "@wendoo/assistant-relay";
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

/** The entity the host says the open mind belongs to. */
const entityName = "Herbivore Brain";

/** A workspace accessor no test reaches. */
function unreachedWorkspace(): AuthoringWorkspace {
  throw new Error("the surface specs serve no tool call");
}

/** Render the surface under a provider, counting the sessions the provider asks for. */
function renderBound(): { markup: string; connects: number } {
  let connects = 0;
  const connect = (): Promise<AssistantChannel> => {
    connects++;
    return Promise.reject(new Error("no route to the service"));
  };

  const markup = renderToStaticMarkup(
    <AssistantProvider connect={connect} manifest={manifest} workspace={unreachedWorkspace}>
      <AssistantSurface name={entityName} />
    </AssistantProvider>
  );
  return { markup, connects };
}

describe("the bound conversation surface", () => {
  test("presents the entity the host named", () => {
    assert.match(renderBound().markup, new RegExp(`data-assistant-entity="true"[^>]*>${entityName}<`));
  });

  test("stands an intent box that takes the keyboard from nobody", () => {
    const { markup } = renderBound();

    assert.match(markup, /<textarea[^>]*data-assistant-intent/);
    assert.doesNotMatch(markup, /autofocus/i);
  });

  test("hands the opens the person asked for down to the view holding the intent box", () => {
    const source = readFileSync(fileURLToPath(new URL("./AssistantSurface.tsx", import.meta.url)), "utf8");

    assert.match(source, /opensByPerson=\{opensByPerson\}/);
  });

  test("opens no session by standing under a provider", () => {
    assert.equal(renderBound().connects, 0);
  });
});
