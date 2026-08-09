import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ConversationRecord } from "./conversation.js";
import { CONVERSATION_RECORD_VERSION, ConversationTurnFailureCode, conversationRecordSchema } from "./conversation.js";
import { RelayTurnEndCode } from "./messages.js";
import { RelayDeclineCode, RelayTakeoverCode } from "./tool-calls.js";

/** A record holding one entry of every shape the format defines. */
const record: ConversationRecord = {
  version: CONVERSATION_RECORD_VERSION,
  brainId: "brain-1",
  entries: [
    { kind: "user", text: "make it hide in the dark" },
    {
      kind: "assistant",
      narration: "reading what is hereplacing the sensor",
      toolCalls: [
        { name: "read_project", input: {}, outcome: { kind: "ok", payload: { pages: [] } } },
        {
          name: "propose_edit",
          input: { op: "placeTiles", ruleId: "0/0", side: "when", tileIds: ["tile.sensor->sensor.fake.signal"] },
          outcome: { kind: "ok", payload: { accepted: true } },
        },
        { name: "compile", input: {}, outcome: { kind: "ok", payload: { error: "unknown_tool" }, isError: true } },
        { name: "simulate", input: { thinks: 30 }, outcome: { kind: "declined", code: RelayDeclineCode.UserStopped } },
        {
          name: "suggest_tiles",
          input: { mode: "insert" },
          outcome: { kind: "takeover", code: RelayTakeoverCode.DocumentEdited },
        },
      ],
      ending: { kind: "end", code: RelayTurnEndCode.Complete },
    },
    { kind: "user", text: "stop" },
    { kind: "assistant", narration: "", toolCalls: [], ending: { kind: "end", code: RelayTurnEndCode.Stopped } },
    { kind: "user", text: "try again" },
    {
      kind: "assistant",
      narration: "looking again",
      toolCalls: [],
      ending: { kind: "failure", code: ConversationTurnFailureCode.Disconnected },
    },
    { kind: "user", text: "and again" },
    { kind: "assistant", narration: "still going", toolCalls: [] },
  ],
};

/** `value` as it comes back off the wire. */
function overTheWire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("the conversation record", () => {
  test("carries every entry shape across the wire unchanged", () => {
    assert.deepEqual(conversationRecordSchema.parse(overTheWire(record)), record);
  });

  test("carries every failure code across the wire unchanged", () => {
    for (const code of Object.values(ConversationTurnFailureCode)) {
      const failed: ConversationRecord = {
        version: CONVERSATION_RECORD_VERSION,
        brainId: "brain-1",
        entries: [{ kind: "assistant", narration: "", toolCalls: [], ending: { kind: "failure", code } }],
      };
      assert.deepEqual(conversationRecordSchema.parse(overTheWire(failed)), failed, code);
    }
  });

  test("refuses a record written at a version it does not know", () => {
    assert.equal(
      conversationRecordSchema.safeParse({ ...record, version: CONVERSATION_RECORD_VERSION + 1 }).success,
      false
    );
  });

  test("refuses an entry carrying a field the format does not define", () => {
    const forged = {
      ...record,
      entries: [{ kind: "assistant", narration: "", toolCalls: [], tokens: 412 }],
    };

    assert.equal(conversationRecordSchema.safeParse(forged).success, false);
  });

  test("refuses a turn ending that is neither an end code nor a failure code", () => {
    const forged = {
      ...record,
      entries: [{ kind: "assistant", narration: "", toolCalls: [], ending: { kind: "end", code: "disconnected" } }],
    };

    assert.equal(conversationRecordSchema.safeParse(forged).success, false);
  });
});
