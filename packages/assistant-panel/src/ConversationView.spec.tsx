/**
 * Pins the structure the conversation surface renders for each state a session
 * can be in: what it shows while it rests, how a turn's narration and status
 * lines land, which control the intent box stands beside, and what a lost
 * session offers.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ConversationEntry, ConversationRecord } from "@mindcraft-lang/assistant-relay";
import { CONVERSATION_RECORD_VERSION } from "@mindcraft-lang/assistant-relay";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationViewProps } from "./ConversationView";
import { ConversationView } from "./ConversationView";
import { ToolActivityKind } from "./conversation/activity";
import { AssistantStatus } from "./session/machine";

/** The brain every record in this file belongs to. */
const brainId = "brain-a";

/** A record holding `entries` for {@link brainId}. */
function record(entries: readonly ConversationEntry[]): ConversationRecord {
  return { version: CONVERSATION_RECORD_VERSION, brainId, entries };
}

/** Render the view over `overrides`, with a resting session everywhere else. */
function render(overrides: Partial<ConversationViewProps> = {}): string {
  const props: ConversationViewProps = {
    name: "Herbivore Brain",
    status: AssistantStatus.Ready,
    record: undefined,
    intent: "",
    onIntentChange: () => {},
    onSend: () => {},
    onStop: () => {},
    onRetry: undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<ConversationView {...props} />);
}

/** Matches an activity line standing at `kind`. */
function activityLine(kind: string): RegExp {
  return new RegExp(`data-assistant-activity="${kind}"`);
}

/** Every match of `pattern` in `markup`. */
function countOf(markup: string, pattern: RegExp): number {
  return markup.match(new RegExp(pattern, "g"))?.length ?? 0;
}

/** The send control's own tag, which carries whether it takes a click. */
function sendControl(markup: string): string {
  const tag = /<button[^>]*data-assistant-send[^>]*>/.exec(markup)?.[0];
  assert.ok(tag, "the view stands a send control");
  return tag;
}

describe("a conversation with nothing in it", () => {
  test("invites the person to say what the entity should do", () => {
    const markup = render();

    assert.match(markup, /data-assistant-resting/);
    assert.doesNotMatch(markup, /data-assistant-entry/);
  });

  test("stands a send control that takes nothing while the box is empty", () => {
    assert.match(sendControl(render()), /\sdisabled=""/);
    assert.doesNotMatch(sendControl(render({ intent: "make me hide" })), /\sdisabled=""/);
  });
});

describe("a conversation with turns in it", () => {
  test("renders what the person said and what the entity narrated", () => {
    const markup = render({
      record: record([
        { kind: "user", text: "I want you to run away" },
        { kind: "assistant", narration: "I will watch for them first.", toolCalls: [] },
      ]),
    });

    assert.match(markup, /data-assistant-entry="user"/);
    assert.match(markup, /data-assistant-entry="assistant"/);
    assert.match(markup, /data-assistant-narration/);
    assert.doesNotMatch(markup, /data-assistant-resting/);
  });

  test("renders one status line per tool call, reading a refused edit as exploration", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          narration: "Starting with the seeing part.",
          toolCalls: [
            { name: "read_catalog", input: {}, outcome: { kind: "ok", payload: { tiles: [], total: 0 } } },
            {
              name: "propose_edit",
              input: { op: "placeTiles" },
              outcome: { kind: "ok", payload: { ok: false, code: 12 } },
            },
            {
              name: "propose_edit",
              input: { op: "placeTiles" },
              outcome: { kind: "ok", payload: { ok: true, historyDepth: 1 } },
            },
          ],
        },
      ]),
    });

    assert.equal(countOf(markup, /data-assistant-activity=/), 3);
    assert.match(markup, activityLine(ToolActivityKind.Read));
    assert.match(markup, activityLine(ToolActivityKind.Explored));
    assert.match(markup, activityLine(ToolActivityKind.Changed));
  });

  test("says how a turn that did not finish ended, and says nothing about one that did", () => {
    const finished = record([
      { kind: "assistant", narration: "Done.", toolCalls: [], ending: { kind: "end", code: "complete" } },
    ]);
    const cut = record([
      { kind: "assistant", narration: "", toolCalls: [], ending: { kind: "failure", code: "disconnected" } },
    ]);

    assert.doesNotMatch(render({ record: finished }), /data-assistant-ending/);
    assert.match(render({ record: cut }), /data-assistant-ending/);
  });
});

describe("a session that is not simply ready", () => {
  test("shows a running turn a stop and no send", () => {
    const markup = render({ status: AssistantStatus.TurnActive, intent: "wait" });

    assert.match(markup, /<button[^>]*data-assistant-stop/);
    assert.doesNotMatch(markup, /data-assistant-send/);
  });

  test("says the session is waking while it opens, and offers nothing to retry", () => {
    const markup = render({ status: AssistantStatus.Connecting });

    assert.match(markup, /data-assistant-connection="connecting"/);
    assert.doesNotMatch(markup, /data-assistant-retry/);
  });

  test("offers a retry once the session has failed", () => {
    const markup = render({ status: AssistantStatus.Failed, onRetry: () => {} });

    assert.match(markup, /data-assistant-connection="failed"/);
    assert.match(markup, /<button[^>]*data-assistant-retry/);
  });

  test("offers no retry for a failure the host gave no way back from", () => {
    assert.doesNotMatch(render({ status: AssistantStatus.Failed }), /data-assistant-retry/);
  });
});
