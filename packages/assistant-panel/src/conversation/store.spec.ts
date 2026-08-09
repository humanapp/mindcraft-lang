import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ConversationToolCall } from "@mindcraft-lang/assistant-relay";
import { CONVERSATION_RECORD_VERSION, ConversationTurnFailureCode } from "@mindcraft-lang/assistant-relay";
import { activeRecord, emptyConversationStore, recordFor, withActiveBrain, withUpdate } from "./store";

/** One served call, for the shape of a recorded tool call. */
const call: ConversationToolCall = {
  name: "read_catalog",
  input: {},
  outcome: { kind: "ok", payload: { tiles: [] } },
};

describe("the conversation store", () => {
  test("holds no conversation and names no active brain to begin with", () => {
    const store = emptyConversationStore();

    assert.equal(store.records.size, 0);
    assert.equal(activeRecord(store), undefined);
  });

  test("answers for a brain with no conversation with an empty record", () => {
    assert.deepEqual(recordFor(emptyConversationStore(), "brain-a"), {
      version: CONVERSATION_RECORD_VERSION,
      brainId: "brain-a",
      entries: [],
    });
  });

  test("swaps which record is exposed when the active brain moves", () => {
    let store = withUpdate(emptyConversationStore(), "brain-a", { kind: "user", text: "for a" });
    store = withUpdate(store, "brain-b", { kind: "user", text: "for b" });

    assert.deepEqual(activeRecord(withActiveBrain(store, "brain-a"))?.entries, [{ kind: "user", text: "for a" }]);
    assert.deepEqual(activeRecord(withActiveBrain(store, "brain-b"))?.entries, [{ kind: "user", text: "for b" }]);
  });

  test("opens a turn on the first thing that lands after a user message", () => {
    let store = withUpdate(emptyConversationStore(), "brain-a", { kind: "user", text: "make it hide" });
    store = withUpdate(store, "brain-a", { kind: "narration", text: "looking" });

    assert.deepEqual(recordFor(store, "brain-a").entries, [
      { kind: "user", text: "make it hide" },
      { kind: "assistant", narration: "looking", toolCalls: [] },
    ]);
  });

  test("joins narration deltas into the running turn in stream order", () => {
    let store = withUpdate(emptyConversationStore(), "brain-a", { kind: "narration", text: "look" });
    store = withUpdate(store, "brain-a", { kind: "narration", text: "ing at it" });

    assert.deepEqual(recordFor(store, "brain-a").entries, [
      { kind: "assistant", narration: "looking at it", toolCalls: [] },
    ]);
  });

  test("appends served calls to the running turn in call order", () => {
    const second: ConversationToolCall = { ...call, name: "compile" };
    let store = withUpdate(emptyConversationStore(), "brain-a", { kind: "toolCall", call });
    store = withUpdate(store, "brain-a", { kind: "toolCall", call: second });

    assert.deepEqual(recordFor(store, "brain-a").entries, [
      { kind: "assistant", narration: "", toolCalls: [call, second] },
    ]);
  });

  test("closes the running turn with the ending it is given", () => {
    let store = withUpdate(emptyConversationStore(), "brain-a", { kind: "narration", text: "done" });
    store = withUpdate(store, "brain-a", { kind: "ending", ending: { kind: "end", code: "complete" } });

    assert.deepEqual(recordFor(store, "brain-a").entries, [
      { kind: "assistant", narration: "done", toolCalls: [], ending: { kind: "end", code: "complete" } },
    ]);
  });

  test("opens a turn to carry a failure that arrived before anything else did", () => {
    const store = withUpdate(emptyConversationStore(), "brain-a", {
      kind: "ending",
      ending: { kind: "failure", code: ConversationTurnFailureCode.NotConnected },
    });

    assert.deepEqual(recordFor(store, "brain-a").entries, [
      {
        kind: "assistant",
        narration: "",
        toolCalls: [],
        ending: { kind: "failure", code: ConversationTurnFailureCode.NotConnected },
      },
    ]);
  });

  test("opens a new turn after the last one has closed", () => {
    let store = withUpdate(emptyConversationStore(), "brain-a", { kind: "narration", text: "first" });
    store = withUpdate(store, "brain-a", { kind: "ending", ending: { kind: "end", code: "complete" } });
    store = withUpdate(store, "brain-a", { kind: "narration", text: "second" });

    assert.deepEqual(recordFor(store, "brain-a").entries, [
      { kind: "assistant", narration: "first", toolCalls: [], ending: { kind: "end", code: "complete" } },
      { kind: "assistant", narration: "second", toolCalls: [] },
    ]);
  });

  test("leaves every other brain's conversation untouched", () => {
    let store = withUpdate(emptyConversationStore(), "brain-a", { kind: "narration", text: "for a" });
    const before = recordFor(store, "brain-a");
    store = withUpdate(store, "brain-b", { kind: "narration", text: "for b" });

    assert.deepEqual(recordFor(store, "brain-a"), before);
    assert.deepEqual(recordFor(store, "brain-b").entries, [{ kind: "assistant", narration: "for b", toolCalls: [] }]);
  });

  test("leaves the store it was given unchanged", () => {
    const store = emptyConversationStore();

    withUpdate(store, "brain-a", { kind: "narration", text: "for a" });
    withActiveBrain(store, "brain-a");

    assert.equal(store.records.size, 0);
    assert.equal(store.activeBrainId, undefined);
  });
});
