import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace } from "@mindcraft-lang/assistant-bridge";
import { FAKE_TARGET_IDENTITY } from "@mindcraft-lang/assistant-bridge/testing";
import type { RelayToolManifest } from "@mindcraft-lang/assistant-relay";
import { renderToStaticMarkup } from "react-dom/server";
import type { AssistantContextValue } from "./AssistantProvider";
import { AssistantProvider, useAssistant } from "./AssistantProvider";
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
  throw new Error("the provider specs serve no tool call");
}

/** The session the last render bound, and the markup that render produced. */
interface Rendered {
  readonly value: AssistantContextValue;
  readonly markup: string;
  connects(): number;
}

/** Render a probe under a provider and hand back what it was bound to. */
function render(): Rendered {
  let connects = 0;
  const connect = (): Promise<AssistantChannel> => {
    connects++;
    return Promise.reject(new Error("no route to the service"));
  };

  let bound: AssistantContextValue | undefined;
  function Probe() {
    bound = useAssistant();
    return <span data-assistant-status={bound.status} />;
  }

  const markup = renderToStaticMarkup(
    <AssistantProvider connect={connect} manifest={manifest} workspace={unreachedWorkspace}>
      <Probe />
    </AssistantProvider>
  );

  if (!bound) throw new Error("the probe did not render");
  return { value: bound, markup, connects: () => connects };
}

describe("the assistant provider", () => {
  test("stands a session its tree reads the status of", () => {
    const rendered = render();

    assert.match(rendered.markup, /data-assistant-status="idle"/);
    assert.equal(rendered.value.record, undefined);
  });

  test("opens no session while it is only standing", () => {
    assert.equal(render().connects(), 0);
  });

  test("drives the session it stands", () => {
    const rendered = render();

    rendered.value.setActiveBrain("brain-a");
    rendered.value.send("make it hide");

    assert.equal(rendered.connects(), 1);
  });

  test("opens a brain's session with nothing sent", () => {
    const rendered = render();

    rendered.value.openSession("brain-a");

    assert.equal(rendered.connects(), 1);
    assert.equal(rendered.value.record, undefined);
  });

  test("refuses to be read outside a provider", () => {
    function Loose() {
      useAssistant();
      return null;
    }

    assert.throws(() => renderToStaticMarkup(<Loose />));
  });
});
