/**
 * Pins the diagnostic document the conversation exports as: what its header
 * states, how an ask and each run of the assistant's words are held verbatim under
 * their line counts, what a tool call reports of itself and which durable ids it
 * is read to have named, how a turn's ending reads, that a question states the
 * very answers the transcript offers under it, and that the same record always
 * writes the same document.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ConversationEntry, ConversationRecord, ConversationToolCall } from "@wendoo/assistant-relay";
import {
  CONVERSATION_RECORD_VERSION,
  ConversationTurnFailureCode,
  NarrationJudgment,
  NarrationRole,
  RelayDeclineCode,
  RelayTakeoverCode,
  RelayTurnEndCode,
} from "@wendoo/assistant-relay";
import { ConversationBlockKind, conversationBlocks, transcriptContext } from "./blocks";
import { exportTranscript, transcriptExportFormat } from "./export";

/** The brain every record in this file belongs to, as the host addresses it. */
const brainId = "brain-a";

/** What the host calls that brain on screen. */
const brainName = "Herbivore Brain";

/** A record holding `entries` for {@link brainId}. */
function record(entries: readonly ConversationEntry[]): ConversationRecord {
  return { version: CONVERSATION_RECORD_VERSION, brainId, entries };
}

/** `record` as the document it exports, split into its lines. */
function exported(held: ConversationRecord): string[] {
  return exportTranscript(held, brainName).split("\n");
}

/** The line opening with `mark`, and `undefined` where the document holds none. */
function lineWith(lines: readonly string[], mark: string): string | undefined {
  return lines.find((line) => line.startsWith(mark));
}

/**
 * An accepted `propose_edit` as one lands in a record: the tiles it asked for by
 * id, and the rule the editor reported back on the page it stands on.
 */
const placedTiles: ConversationToolCall = {
  name: "propose_edit",
  input: { op: "placeTiles", ruleId: "rule-1", side: "do", tileIds: ["tile.actuator->move", "tile.sensor->see"] },
  outcome: {
    kind: "ok",
    payload: {
      ok: true,
      rule: { ruleId: "rule-1", when: [], do: [{ tileId: "tile.actuator->move", label: "move" }], children: [] },
      page: { pageId: "page-wandering", pageIndex: 0, name: "Wandering" },
    },
  },
};

/** A `propose_edit` the editor's policy refused, under the diagnostic that refused it. */
const refusedEdit: ConversationToolCall = {
  name: "propose_edit",
  input: { op: "placeTiles", ruleId: "rule-2", side: "when", tileIds: ["tile.actuator->move"] },
  outcome: { kind: "ok", payload: { ok: false, code: 1207, params: { tileId: "tile.actuator->move" } } },
};

/** A rehearsal the target refused to stage. */
const blockedRun: ConversationToolCall = {
  name: "simulate",
  input: { thinks: 40 },
  outcome: { kind: "ok", payload: { ok: false, error: "no_target" } },
};

describe("what the exported document states about the record", () => {
  test("opens on the format it is written in, the brain it is about, and how much it holds", () => {
    const lines = exported(record([{ kind: "user", text: "make me hide" }]));

    assert.equal(lines[0], transcriptExportFormat);
    assert.equal(lines[1], `brain: ${brainName} (${brainId})`);
    assert.equal(lines[2], `record-version: ${CONVERSATION_RECORD_VERSION}`);
    assert.equal(lines[3], "entries: 1");
  });

  test("holds what the person asked for verbatim, under the lines it stands as", () => {
    const lines = exported(record([{ kind: "user", text: "make me hide\n\nand run away" }]));

    assert.equal(lineWith(lines, "--- entry 1 ask"), "--- entry 1 ask lines=3");
    assert.deepEqual(lines.slice(-4, -1), ["| make me hide", "| ", "| and run away"]);
  });

  test("marks a turn with what it did and how it ended", () => {
    const lines = exported(
      record([
        {
          kind: "assistant",
          steps: [{ kind: "narration", text: "I will start with the seeing." }],
          ending: { kind: "end", code: RelayTurnEndCode.Complete },
        },
      ])
    );

    assert.equal(lineWith(lines, "--- entry 1 turn"), "--- entry 1 turn steps=1 ending=end/complete");
  });

  test("reads a turn that broke off under the failure that cut it, and one still running as ending nothing", () => {
    const cut = exported(
      record([
        {
          kind: "assistant",
          steps: [],
          ending: { kind: "failure", code: ConversationTurnFailureCode.Disconnected },
        },
      ])
    );
    const running = exported(record([{ kind: "assistant", steps: [] }]));

    assert.match(lineWith(cut, "--- entry 1 turn") ?? "", /ending=failure\/disconnected$/);
    assert.match(lineWith(running, "--- entry 1 turn") ?? "", /ending=none$/);
  });
});

describe("what the assistant said", () => {
  test("keeps a run's headline and body verbatim, each under the lines it stands as", () => {
    const lines = exported(
      record([
        {
          kind: "assistant",
          steps: [{ kind: "narration", text: "I will teach it to flee.", body: "First the seeing.\nThen the moving." }],
        },
      ])
    );

    assert.equal(lineWith(lines, "headline lines="), "headline lines=1");
    assert.equal(lineWith(lines, "| I will teach it"), "| I will teach it to flee.");
    assert.equal(lineWith(lines, "body lines="), "body lines=2");
    assert.deepEqual(lines.slice(-3, -1), ["| First the seeing.", "| Then the moving."]);
  });

  test("marks what a run was doing and the judgment it carried", () => {
    const lines = exported(
      record([
        {
          kind: "assistant",
          steps: [
            {
              kind: "narration",
              text: "It ran, and it kept running.",
              role: NarrationRole.Verdict,
              judgment: NarrationJudgment.Succeeded,
            },
          ],
        },
      ])
    );

    assert.equal(lineWith(lines, "- step 1"), "- step 1 narration role=verdict judgment=succeeded");
  });

  test("states the answers a question offers, as the very ones the transcript offers under it", () => {
    const question = {
      kind: "narration",
      text: "Want me to make the running-away cleverer?",
      body: "- Call out when I flee\n- Hide instead when it is close",
      role: NarrationRole.Ask,
    } as const;
    const held = record([{ kind: "assistant", steps: [question] }]);
    const lines = exported(held);

    const [block] = conversationBlocks([question], transcriptContext(held));
    assert.ok(block?.kind === ConversationBlockKind.Narration, "the transcript draws the question");
    assert.equal(lineWith(lines, "answers="), `answers=${block.answers?.length}`);
    assert.deepEqual(
      lines.slice(-3, -1),
      (block.answers ?? []).map((answer) => `| ${answer}`)
    );
  });

  test("counts no answers for a question that offers none", () => {
    const lines = exported(
      record([
        {
          kind: "assistant",
          steps: [{ kind: "narration", text: "Which one should it chase?", role: NarrationRole.Ask }],
        },
      ])
    );

    assert.equal(lineWith(lines, "answers="), "answers=0");
  });
});

describe("what a tool call reports of itself", () => {
  test("names the call, how it was answered, and the ids it named, input before payload", () => {
    const lines = exported(record([{ kind: "assistant", steps: [{ kind: "toolCall", call: placedTiles }] }]));

    assert.equal(lineWith(lines, "- step 1"), "- step 1 call propose_edit outcome=ok payload-ok=true");
    assert.equal(lineWith(lines, "ids: "), "ids: rule-1, tile.actuator->move, tile.sensor->see, page-wandering");
  });

  test("carries the code a refusal came back under", () => {
    const lines = exported(record([{ kind: "assistant", steps: [{ kind: "toolCall", call: refusedEdit }] }]));

    assert.equal(
      lineWith(lines, "- step 1"),
      "- step 1 call propose_edit outcome=ok payload-ok=false payload-code=1207"
    );
  });

  test("carries the word a blocked rehearsal came back under", () => {
    const lines = exported(record([{ kind: "assistant", steps: [{ kind: "toolCall", call: blockedRun }] }]));

    assert.equal(
      lineWith(lines, "- step 1"),
      "- step 1 call simulate outcome=ok payload-ok=false payload-error=no_target"
    );
  });

  test("marks a call the bridge could not serve", () => {
    const lines = exported(
      record([
        {
          kind: "assistant",
          steps: [
            {
              kind: "toolCall",
              call: {
                name: "compile",
                input: {},
                outcome: { kind: "ok", payload: { message: "gone" }, isError: true },
              },
            },
          ],
        },
      ])
    );

    assert.equal(lineWith(lines, "- step 1"), "- step 1 call compile outcome=ok error=true");
  });

  test("reads a call the person's own mediation answered under the code that stood in for it", () => {
    const declined = exported(
      record([
        {
          kind: "assistant",
          steps: [
            {
              kind: "toolCall",
              call: { name: "simulate", input: {}, outcome: { kind: "declined", code: RelayDeclineCode.UserStopped } },
            },
          ],
        },
      ])
    );
    const takeover = exported(
      record([
        {
          kind: "assistant",
          steps: [
            {
              kind: "toolCall",
              call: {
                name: "propose_edit",
                input: { ruleId: "rule-1" },
                outcome: { kind: "takeover", code: RelayTakeoverCode.DocumentEdited },
              },
            },
          ],
        },
      ])
    );

    assert.equal(lineWith(declined, "- step 1"), "- step 1 call simulate outcome=declined code=user_stopped");
    assert.equal(lineWith(takeover, "- step 1"), "- step 1 call propose_edit outcome=takeover code=document_edited");
    assert.equal(lineWith(takeover, "ids: "), "ids: rule-1");
  });

  test("names an id once however often the payload repeats it", () => {
    const lines = exported(
      record([
        {
          kind: "assistant",
          steps: [
            {
              kind: "toolCall",
              call: {
                name: "read_project",
                input: {},
                outcome: {
                  kind: "ok",
                  payload: {
                    pages: [
                      { pageId: "page-wandering", rules: [{ ruleId: "rule-1" }, { ruleId: "rule-2" }] },
                      { pageId: "page-wandering", rules: [{ ruleId: "rule-1" }] },
                    ],
                  },
                },
              },
            },
          ],
        },
      ])
    );

    assert.equal(lineWith(lines, "ids: "), "ids: page-wandering, rule-1, rule-2");
  });
});

describe("the document the whole conversation writes", () => {
  /** A record exercising every kind of entry, step, outcome and ending the record holds. */
  const whole = record([
    { kind: "user", text: "make yourself run away" },
    {
      kind: "assistant",
      steps: [
        { kind: "narration", text: "I will start with the seeing.", role: NarrationRole.Plan },
        { kind: "toolCall", call: placedTiles },
        { kind: "toolCall", call: refusedEdit },
        { kind: "toolCall", call: blockedRun },
        {
          kind: "narration",
          text: "It did not run.",
          body: "The target would not stage it.",
          role: NarrationRole.Verdict,
          judgment: NarrationJudgment.Failed,
        },
        { kind: "narration", text: "Try it another way?\nSlow it down\nLeave it", role: NarrationRole.Ask },
      ],
      ending: { kind: "end", code: RelayTurnEndCode.Complete },
    },
  ]);

  test("writes the same document for the same record", () => {
    assert.equal(exportTranscript(whole, brainName), exportTranscript(whole, brainName));
  });

  test("stands every entry in the order it happened, each opened by its own mark", () => {
    const marks = exported(whole).filter((line) => line.startsWith("--- entry "));

    assert.deepEqual(marks, ["--- entry 1 ask lines=1", "--- entry 2 turn steps=6 ending=end/complete"]);
  });

  test("numbers every step of a turn, in the order the turn took them", () => {
    const steps = exported(whole)
      .filter((line) => line.startsWith("- step "))
      .map((line) => line.split(" ").slice(1, 4).join(" "));

    assert.deepEqual(steps, [
      "step 1 narration",
      "step 2 call",
      "step 3 call",
      "step 4 call",
      "step 5 narration",
      "step 6 narration",
    ]);
  });

  test("leaves nothing the record carries out of the document", () => {
    const document = exportTranscript(whole, brainName);

    for (const held of [
      "make yourself run away",
      "I will start with the seeing.",
      "propose_edit",
      "payload-code=1207",
      "payload-error=no_target",
      "tile.sensor->see",
      "page-wandering",
      "The target would not stage it.",
      "judgment=failed",
      "role=ask",
      "Slow it down",
    ]) {
      assert.ok(document.includes(held), `the document carries ${held}`);
    }
  });
});
