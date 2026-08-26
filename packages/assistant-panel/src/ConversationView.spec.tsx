/**
 * Pins the structure the conversation surface renders for each state a session
 * can be in: which card each thing a turn did is drawn as and in what order,
 * how edits gather into a receipt per page, how repeated refusals collapse into
 * one snag, what a rehearsal's timeline is cut into and what marks it, how a
 * dirty build reads, where a turn's look-ups go, which turns stand folded to
 * their header, where the account of what a conversation kept stands, what
 * marks a turn that did not simply finish, when the entity's presence stands at
 * the live edge, which control the intent box stands beside, what a lost
 * session offers, which lines read markup in what they carry, and which opens
 * of the panel land the keyboard in the intent box.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  ConversationEntry,
  ConversationRecord,
  ConversationToolCall,
  ConversationTurnEnding,
  ConversationTurnStep,
} from "@wendoo/assistant-relay";
import { CONVERSATION_RECORD_VERSION, ConversationTurnFailureCode, RelayTurnEndCode } from "@wendoo/assistant-relay";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationViewProps } from "./ConversationView";
import { ConversationView, intentKeyAction, landKeyboardInIntent } from "./ConversationView";
import { AssistantStatus } from "./session/machine";

/** The brain every record in this file belongs to. */
const brainId = "brain-a";

/** A record holding `entries` for {@link brainId}. */
function record(entries: readonly ConversationEntry[]): ConversationRecord {
  return { version: CONVERSATION_RECORD_VERSION, brainId, entries };
}

/** One tile as every payload naming it reports it. */
interface NamedTile {
  readonly tileId: string;
  readonly label: string;
}

/** One page as an accepted edit reports the page it landed on. */
interface NamedPage {
  readonly pageId: string;
  readonly pageIndex: number;
  readonly name: string;
}

/** The two pages the edits in this file land on. */
const wandering: NamedPage = { pageId: "page-wandering", pageIndex: 0, name: "Wandering" };
const scared: NamedPage = { pageId: "page-scared", pageIndex: 1, name: "Scared" };

/** Tiles the edits in this file place, each under the word it reads by. */
const seeTile: NamedTile = { tileId: "tile.sensor->see", label: "see" };
const moveTile: NamedTile = { tileId: "tile.actuator->move", label: "move" };

/** An edit placing `tiles` on the `do` side of `ruleId`, landing on `page` when one is given. */
function placedOn(page: NamedPage | undefined, ruleId: string, tiles: readonly NamedTile[]): ConversationToolCall {
  return {
    name: "propose_edit",
    input: { op: "placeTiles", ruleId, side: "do", tileIds: tiles.map((tile) => tile.tileId) },
    outcome: {
      kind: "ok",
      payload: {
        ok: true,
        historyDepth: 1,
        ...(page ? { onPage: page } : {}),
        rule: { ruleId, when: [], do: tiles, children: [] },
      },
    },
  };
}

/** An edit nesting a new rule `ruleId` under `parentRuleId`, landing on `page`. */
function nestedUnder(page: NamedPage, parentRuleId: string, ruleId: string): ConversationToolCall {
  return {
    name: "propose_edit",
    input: { op: "addChildRule", parentRuleId },
    outcome: {
      kind: "ok",
      payload: { ok: true, historyDepth: 1, onPage: page, rule: { ruleId, when: [], do: [], children: [] } },
    },
  };
}

/** An edit the editor refused, under the diagnostic that refused it and the tile it named. */
function refusedFor(tileId: string): ConversationToolCall {
  return {
    name: "propose_edit",
    input: { op: "placeTiles", ruleId: "rule-1", side: "when", tileIds: [tileId] },
    outcome: { kind: "ok", payload: { ok: false, code: 12, params: { ruleId: "rule-1", tileId } } },
  };
}

/** A refused edit, which stands as a snag however often it repeats. */
const refusedEdit = refusedFor(seeTile.tileId);

/** An applied edit, which stands as a receipt on the page it landed on. */
const appliedEdit = placedOn(wandering, "rule-1", [moveTile]);

/** A clean build, which verifies the receipts standing when it ran. */
const cleanBuild: ConversationToolCall = {
  name: "compile",
  input: {},
  outcome: { kind: "ok", payload: { ok: true, diagnostics: [] } },
};

/** One stretch of a rehearsal, as an account reports it. */
function span(from: number, thinks: number, think: Record<string, unknown>): Record<string, unknown> {
  return { from, thinks, think: { fired: [], when: [], dispatched: [], ...think } };
}

/** The scenario every rehearsal in this file is asked for, unless one asks for its own. */
const scenario = { scenario: { seed: 1, subject: "herbivore" }, thinks: 20 };

/** A rehearsal that ran and came back reporting `summary`, over the scenario `input` asked for. */
function rehearsed(summary: Record<string, unknown>, input: unknown = scenario): ConversationToolCall {
  return {
    name: "simulate",
    input,
    outcome: {
      kind: "ok",
      payload: {
        ok: true,
        summary: {
          runId: "run-1",
          thinks: 20,
          rules: [],
          dispatchTotals: [],
          spans: [span(0, 20, { fired: ["rule-1"], when: ["rule-1=true"] })],
          spansTruncated: false,
          identity: ["0 00000001"],
          world: { initialPopulation: 1, finalPopulation: 1, brainsExecuted: 1 },
          ...summary,
        },
      },
    },
  };
}

/** A rehearsal the target refused to stage, under the code that stopped it. */
function rehearsalRefused(error: string): ConversationToolCall {
  return {
    name: "simulate",
    input: { scenario: { seed: 1, subject: "ghost" }, thinks: 10 },
    outcome: { kind: "ok", payload: { ok: false, error, named: "ghost", subjects: ["herbivore"] } },
  };
}

/** A build that came back dirty, reporting `diagnostics`. */
function dirtyBuild(diagnostics: readonly Record<string, unknown>[]): ConversationToolCall {
  return { name: "compile", input: {}, outcome: { kind: "ok", payload: { ok: false, diagnostics } } };
}

/** The one thing a dirty build in this file reports, unless it reports its own. */
const droppedTile = { code: 1016, severity: "error", ruleId: "rule-1", params: {} };

/** A catalog read, which reads as looking at something. */
const catalogRead: ConversationToolCall = {
  name: "read_catalog",
  input: {},
  outcome: { kind: "ok", payload: { tiles: [], total: 0 } },
};

/** A catalog read naming what each of `tiles` reads by. */
function catalogNaming(tiles: readonly NamedTile[]): ConversationToolCall {
  return {
    name: "read_catalog",
    input: { filter: "all" },
    outcome: { kind: "ok", payload: { tiles, total: tiles.length } },
  };
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
    onAskAgain: undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<ConversationView {...props} />);
}

/** A record where the person asked for something and the entity's turn ended on `ending`. */
function asked(ending: ConversationTurnEnding): ConversationRecord {
  return record([
    { kind: "user", text: "make me hide" },
    { kind: "assistant", steps: [], ending },
  ]);
}

/** Every match of `pattern` in `markup`. */
function countOf(markup: string, pattern: RegExp): number {
  return markup.match(new RegExp(pattern, "g"))?.length ?? 0;
}

/** The attributes marking each line the transcript laid out, in the order they were rendered. */
function laidOutLines(markup: string): string[] {
  const marks = markup.match(/data-assistant-(?:narration|ending|presence)(?!-)(?:="[^"]*")?/g) ?? [];
  return marks.map((mark) => mark.replace(/^data-assistant-/, "").replace(/="true"$/, ""));
}

/** The kind of every card the transcript drew, in the order they were rendered. */
function cardKinds(markup: string): string[] {
  return [...markup.matchAll(/data-assistant-card="([^"]*)"/g)].map((match) => match[1] ?? "");
}

/** Every value `attribute` was rendered with, in the order they were rendered. */
function valuesOf(markup: string, attribute: string): string[] {
  return [...markup.matchAll(new RegExp(`${attribute}="([^"]*)"`, "g"))].map((match) => match[1] ?? "");
}

/** `value` as it stands in the markup, where a tile id's own characters are escaped. */
function escaped(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The kind of every bubble the transcript drew, in the order they were rendered. */
function bubbleKinds(markup: string): string[] {
  return [...markup.matchAll(/data-assistant-bubble="([^"]*)"/g)].map((match) => match[1] ?? "");
}

/** The kind of bubble the line marked `mark` is drawn inside, or `undefined` where no bubble holds it. */
function bubbleAround(markup: string, mark: string): string | undefined {
  return new RegExp(`data-assistant-bubble="([^"]*)"[^>]*>\\s*<[^>]*\\b${mark}\\b`).exec(markup)?.[1];
}

/** What the ending line marked `code` reads as, for comparing one ending against another. */
function endingNote(markup: string, code: string): string {
  const note = new RegExp(`data-assistant-ending="${code}"[^>]*>([^<]*)<`).exec(markup)?.[1];
  assert.ok(note !== undefined, `the view marks the ending ${code}`);
  return note;
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
        { kind: "assistant", steps: [{ kind: "narration", text: "I will watch for them first." }] },
      ]),
    });

    assert.match(markup, /data-assistant-entry="user"/);
    assert.match(markup, /data-assistant-entry="assistant"/);
    assert.match(markup, /data-assistant-narration/);
    assert.doesNotMatch(markup, /data-assistant-resting/);
  });

  test("stands what the person asked in its own kind of container, apart from what the entity said", () => {
    const markup = render({
      record: record([
        { kind: "user", text: "I want you to run away" },
        { kind: "assistant", steps: [{ kind: "narration", text: "I will watch for them first." }] },
      ]),
    });

    assert.deepEqual(bubbleKinds(markup), ["ask", "entity"]);
    assert.equal(bubbleAround(markup, "data-assistant-narration"), "entity");
  });

  test("draws each run of narration in a container of its own", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "narration", text: "Starting with the seeing part." },
            { kind: "toolCall", call: catalogRead },
            { kind: "narration", text: "That one does not belong there." },
          ],
        },
      ]),
    });

    assert.deepEqual(laidOutLines(markup), ["narration", "narration"]);
    assert.deepEqual(bubbleKinds(markup), ["entity", "entity"]);
  });

  test("stands the work a turn did where it did it, among the narration around it", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "narration", text: "Starting with the seeing part." },
            { kind: "toolCall", call: appliedEdit },
            { kind: "narration", text: "That one does not belong there." },
          ],
        },
      ]),
    });

    assert.deepEqual(cardKinds(markup), ["narration", "receipt", "narration"]);
  });
});

describe("the edits a turn landed", () => {
  test("gathers the edits on each page into a receipt of its own, named by that page", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: placedOn(wandering, "rule-1", [moveTile]) },
            { kind: "toolCall", call: placedOn(scared, "rule-2", [seeTile]) },
            { kind: "toolCall", call: placedOn(wandering, "rule-3", [seeTile]) },
          ],
        },
      ]),
    });

    assert.deepEqual(cardKinds(markup), ["receipt", "receipt"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-receipt-page"), [wandering.pageId, scared.pageId]);
    assert.deepEqual(valuesOf(markup, "data-assistant-receipt-edits"), ["2", "1"]);
  });

  test("shows each rule it left standing as its tiles, a rule nested under another standing in from it", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: placedOn(wandering, "rule-1", [moveTile]) },
            { kind: "toolCall", call: nestedUnder(wandering, "rule-1", "rule-2") },
            { kind: "toolCall", call: placedOn(wandering, "rule-2", [seeTile]) },
          ],
        },
      ]),
    });

    assert.deepEqual(valuesOf(markup, "data-assistant-rule"), ["rule-1", "rule-2"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-rule-depth"), ["0", "1"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-tile"), [escaped(moveTile.tileId), escaped(seeTile.tileId)]);
    assert.equal(countOf(markup, /data-assistant-side="do"/), 2);
  });

  test("opens to one row per editor command, under the op the command named", () => {
    const markup = render({
      record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call: appliedEdit }] }]),
    });

    assert.match(markup, /<details[^>]*data-assistant-fold="edits"/);
    assert.deepEqual(valuesOf(markup, "data-assistant-step"), ["placeTiles"]);
  });

  test("gathers an edit that named no page all the same, with no page to name", () => {
    const markup = render({
      record: record([
        { kind: "assistant", steps: [{ kind: "toolCall", call: placedOn(undefined, "rule-1", [moveTile]) }] },
      ]),
    });

    assert.deepEqual(cardKinds(markup), ["receipt"]);
    assert.doesNotMatch(markup, /data-assistant-receipt-page/);
  });

  test("sorts the commands of one batch by the page each of them landed on", () => {
    const batch: ConversationToolCall = {
      name: "propose_edit",
      input: {
        op: "batch",
        commands: [
          { op: "placeTiles", ruleId: "rule-1", side: "do", tileIds: [moveTile.tileId] },
          { op: "addRule", pageIndex: 1 },
        ],
      },
      outcome: {
        kind: "ok",
        payload: {
          ok: true,
          historyDepth: 1,
          results: [
            { onPage: wandering, rule: { ruleId: "rule-1", when: [], do: [moveTile], children: [] } },
            { onPage: scared, rule: { ruleId: "rule-9", when: [], do: [], children: [] } },
          ],
        },
      },
    };

    const markup = render({ record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call: batch }] }]) });

    assert.deepEqual(valuesOf(markup, "data-assistant-receipt-page"), [wandering.pageId, scared.pageId]);
    assert.deepEqual(valuesOf(markup, "data-assistant-receipt-edits"), ["1", "1"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-step"), ["placeTiles", "addRule"]);
  });

  test("stops showing a rule the turn took back out, and still tells that it went", () => {
    const removed: ConversationToolCall = {
      name: "propose_edit",
      input: { op: "deleteRule", ruleId: "rule-1" },
      outcome: {
        kind: "ok",
        payload: {
          ok: true,
          historyDepth: 2,
          onPage: wandering,
          removed: "rule",
          rule: { ruleId: "rule-1", when: [], do: [moveTile], children: [] },
        },
      },
    };

    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: placedOn(wandering, "rule-1", [moveTile]) },
            { kind: "toolCall", call: removed },
          ],
        },
      ]),
    });

    assert.deepEqual(valuesOf(markup, "data-assistant-rule"), []);
    assert.deepEqual(valuesOf(markup, "data-assistant-receipt-edits"), ["2"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-step"), ["placeTiles", "deleteRule"]);
  });

  test("a clean build marks every receipt the turn had opened by then", () => {
    const built: readonly ConversationTurnStep[] = [
      { kind: "toolCall", call: placedOn(wandering, "rule-1", [moveTile]) },
      { kind: "toolCall", call: placedOn(scared, "rule-2", [seeTile]) },
      { kind: "toolCall", call: cleanBuild },
    ];

    const markup = render({ record: record([{ kind: "assistant", steps: built }]) });
    const unbuilt = render({ record: record([{ kind: "assistant", steps: built.slice(0, 2) }]) });

    assert.equal(countOf(markup, /data-assistant-compiles="ok"/), 2);
    assert.equal(countOf(unbuilt, /data-assistant-compiles="ok"/), 0);
  });
});

describe("the edits the editor refused", () => {
  test("stands one snag naming the code it was refused under and the tile it was about", () => {
    const markup = render({
      record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call: refusedEdit }] }]),
    });

    assert.deepEqual(cardKinds(markup), ["snag"]);
    assert.match(markup, /data-assistant-snag="12"/);
    assert.match(markup, new RegExp(`data-assistant-snag-tile="${escaped(seeTile.tileId)}"`));
    assert.match(markup, /data-assistant-snag-rule="rule-1"/);
  });

  test("collapses every proposal asking the very same thing, however much narration falls between", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: refusedEdit },
            { kind: "toolCall", call: refusedEdit },
            { kind: "narration", text: "Let me try somewhere else." },
            { kind: "toolCall", call: refusedEdit },
          ],
        },
      ]),
    });

    assert.deepEqual(cardKinds(markup), ["snag", "narration"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-snag-repeats"), ["3"]);
  });

  test("keeps proposals asking for different things apart", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: refusedEdit },
            { kind: "toolCall", call: refusedFor(moveTile.tileId) },
          ],
        },
      ]),
    });

    assert.deepEqual(cardKinds(markup), ["snag", "snag"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-snag-repeats"), ["1", "1"]);
  });

  test("names the tile in the word an earlier payload gave it", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: catalogNaming([seeTile]) },
            { kind: "toolCall", call: refusedEdit },
          ],
        },
      ]),
    });

    assert.match(markup, new RegExp(`data-assistant-tile-word[^>]*>${seeTile.label}<`));
  });

  test("opens to what the rejecting diagnostic reported", () => {
    const markup = render({
      record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call: refusedEdit }] }]),
    });

    assert.match(markup, /<details[^>]*data-assistant-fold="diagnostic"/);
    assert.deepEqual(valuesOf(markup, "data-assistant-diag-param"), ["ruleId", "tileId"]);
  });
});

describe("what a turn only looked at", () => {
  test("stands no line of its own anywhere in the transcript", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: catalogRead },
            { kind: "toolCall", call: refusedEdit },
            { kind: "toolCall", call: appliedEdit },
          ],
        },
      ]),
    });

    assert.doesNotMatch(markup, /data-assistant-activity/);
    assert.deepEqual(cardKinds(markup), ["snag", "receipt", "lookups"]);
  });

  test("keeps the evidence of a turn that changed nothing at all", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: catalogRead },
            { kind: "toolCall", call: catalogNaming([seeTile]) },
          ],
        },
      ]),
    });

    assert.deepEqual(cardKinds(markup), ["lookups"]);
    assert.match(markup, /data-assistant-lookups="2"/);
    assert.deepEqual(valuesOf(markup, "data-assistant-step"), ["read_catalog", "read_catalog"]);
  });

  test("counts calls asking the very same thing as one row", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: catalogRead },
            { kind: "toolCall", call: catalogRead },
            { kind: "toolCall", call: catalogRead },
          ],
        },
      ]),
    });

    assert.match(markup, /data-assistant-lookups="3"/);
    assert.deepEqual(valuesOf(markup, "data-assistant-step"), ["read_catalog"]);
  });
});

describe("the folds a card opens", () => {
  test("every one is a native disclosure, which the keyboard reaches and works unaided", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: catalogRead },
            { kind: "toolCall", call: refusedEdit },
            { kind: "toolCall", call: appliedEdit },
          ],
        },
      ]),
    });

    const folds = countOf(markup, /data-assistant-fold=/);
    assert.equal(folds, 3);
    assert.equal(countOf(markup, /<details[^>]*data-assistant-fold=/), folds);
    assert.equal(countOf(markup, /<summary/), folds);
  });
});

describe("markup in what is said", () => {
  test("reads the entity's narration as the markdown subset, under the mark the line carries", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [{ kind: "narration", text: "**Two** things:\n\n- one `here`\n- and *another*" }],
        },
      ]),
    });

    assert.match(markup, /data-assistant-narration/);
    assert.match(markup, /<strong[^>]*>Two<\/strong>/);
    assert.match(markup, /<ul[^>]*>/);
    assert.equal(countOf(markup, /<li[^>]*>/), 2);
    assert.match(markup, /<code[^>]*>here<\/code>/);
    assert.match(markup, /<em[^>]*>another<\/em>/);
  });

  test("leaves what the person typed literal, whatever markup it holds", () => {
    const markup = render({
      record: record([{ kind: "user", text: "**not loud** and <b>not this</b> and `not typed`" }]),
    });

    assert.match(markup, /data-assistant-entry="user"/);
    assert.match(markup, /\*\*not loud\*\*/);
    assert.match(markup, /&lt;b&gt;/);
    assert.doesNotMatch(markup, /<strong/);
    assert.doesNotMatch(markup, /<code/);
    assert.doesNotMatch(markup, /<b>/);
  });
});

describe("how a turn ended", () => {
  test("says nothing about a turn that simply finished", () => {
    const finished = record([
      {
        kind: "assistant",
        steps: [{ kind: "narration", text: "Done." }],
        ending: { kind: "end", code: RelayTurnEndCode.Complete },
      },
    ]);

    assert.doesNotMatch(render({ record: finished }), /data-assistant-ending/);
  });

  test("marks every abnormal ending with the code it ended on", () => {
    const abnormal = [RelayTurnEndCode.Stopped, RelayTurnEndCode.Truncated, RelayTurnEndCode.Failed] as const;

    for (const code of abnormal) {
      const markup = render({ record: record([{ kind: "assistant", steps: [], ending: { kind: "end", code } }]) });
      assert.match(markup, new RegExp(`data-assistant-ending="${code}"`), code);
    }

    for (const code of Object.values(ConversationTurnFailureCode)) {
      const cut = record([{ kind: "assistant", steps: [], ending: { kind: "failure", code } }]);
      assert.match(render({ record: cut }), new RegExp(`data-assistant-ending="${code}"`), code);
    }
  });

  test("says something of its own about each way a turn was cut short", () => {
    const codes = Object.values(ConversationTurnFailureCode);

    const notes = codes.map((code) => {
      const cut = record([{ kind: "assistant", steps: [], ending: { kind: "failure", code } }]);
      return endingNote(render({ record: cut }), code);
    });

    for (const [at, note] of notes.entries()) assert.ok(note.length > 0, codes[at]);
    assert.equal(new Set(notes).size, codes.length, "no two failures read alike");
  });

  test("says how a turn ended in the same kind of container the entity speaks in", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [{ kind: "narration", text: "Looking." }],
          ending: { kind: "end", code: RelayTurnEndCode.Truncated },
        },
      ]),
    });

    assert.deepEqual(bubbleKinds(markup), ["entity", "entity"]);
    assert.equal(bubbleAround(markup, "data-assistant-ending"), bubbleAround(markup, "data-assistant-narration"));
  });

  test("offers to be asked again where the entity broke off mid-answer, and nowhere else", () => {
    const truncated: ConversationTurnEnding = { kind: "end", code: RelayTurnEndCode.Truncated };
    const invites: readonly ConversationTurnEnding[] = [
      truncated,
      { kind: "failure", code: ConversationTurnFailureCode.ToolServingFailed },
    ];
    const declines: readonly ConversationTurnEnding[] = [
      { kind: "end", code: RelayTurnEndCode.Complete },
      { kind: "end", code: RelayTurnEndCode.Stopped },
      { kind: "end", code: RelayTurnEndCode.Failed },
      { kind: "failure", code: ConversationTurnFailureCode.NotConnected },
      { kind: "failure", code: ConversationTurnFailureCode.Disconnected },
    ];

    for (const ending of invites) {
      const markup = render({ record: asked(ending), onAskAgain: () => {} });
      assert.match(markup, /<button[^>]*data-assistant-ask-again/, ending.code);
    }
    for (const ending of declines) {
      const markup = render({ record: asked(ending), onAskAgain: () => {} });
      assert.doesNotMatch(markup, /data-assistant-ask-again/, ending.code);
    }
    assert.doesNotMatch(render({ record: asked(truncated) }), /data-assistant-ask-again/);
  });
});

describe("the entity's presence while a turn runs", () => {
  const running = record([
    { kind: "user", text: "make me hide" },
    { kind: "assistant", steps: [{ kind: "narration", text: "Looking." }] },
  ]);

  test("stands at the end of the transcript while the turn is open, in a container of the entity's own", () => {
    const markup = render({ status: AssistantStatus.TurnActive, record: running });
    const lines = laidOutLines(markup);

    assert.match(markup, /data-assistant-presence/);
    assert.equal(lines[lines.length - 1], "presence");
    assert.deepEqual(bubbleKinds(markup), ["ask", "entity", "entity"]);
  });

  test("is gone once the turn is over, however it ended", () => {
    const ended = record([
      { kind: "user", text: "make me hide" },
      {
        kind: "assistant",
        steps: [{ kind: "narration", text: "Looking." }],
        ending: { kind: "end", code: RelayTurnEndCode.Complete },
      },
    ]);

    assert.doesNotMatch(render({ status: AssistantStatus.Ready, record: ended }), /data-assistant-presence/);
    assert.doesNotMatch(render({ status: AssistantStatus.Connecting, record: running }), /data-assistant-presence/);
    assert.doesNotMatch(render(), /data-assistant-presence/);
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

describe("a key pressed in the intent box", () => {
  test("plain Enter sends what is typed", () => {
    assert.equal(intentKeyAction("Enter", false, false, false, "make a heart"), "send");
  });

  test("Shift+Enter falls through to the newline it types", () => {
    assert.equal(intentKeyAction("Enter", true, false, false, "make a heart"), "pass");
  });

  test("an Enter mid-composition belongs to the composition", () => {
    assert.equal(intentKeyAction("Enter", false, true, false, "make a heart"), "pass");
  });

  test("Enter during a running turn is swallowed, not sent", () => {
    assert.equal(intentKeyAction("Enter", false, false, true, "make a heart"), "swallow");
  });

  test("Enter over whitespace is swallowed, not sent", () => {
    assert.equal(intentKeyAction("Enter", false, false, false, "   "), "swallow");
  });

  test("any other key falls through to typing", () => {
    assert.equal(intentKeyAction("a", false, false, false, "make a heart"), "pass");
  });

  test("Escape leaves the box rather than closing anything", () => {
    assert.equal(intentKeyAction("Escape", false, false, false, "make a heart"), "leave");
  });

  test("Escape leaves an empty box just the same", () => {
    assert.equal(intentKeyAction("Escape", false, false, false, ""), "leave");
  });

  test("Escape leaves the box while a turn is running too", () => {
    assert.equal(intentKeyAction("Escape", false, false, true, "make a heart"), "leave");
  });

  test("an Escape mid-composition belongs to the composition", () => {
    assert.equal(intentKeyAction("Escape", false, true, false, "make a heart"), "pass");
  });
});

/** An intent box standing in no document, recording every way it was asked to take the keyboard. */
function boxTakingKeyboard(): { box: HTMLTextAreaElement; takes: FocusOptions[] } {
  const takes: FocusOptions[] = [];
  const box = {
    focus: (options?: FocusOptions) => {
      takes.push(options ?? {});
    },
  } as unknown as HTMLTextAreaElement;
  return { box, takes };
}

const viewSource = readFileSync(fileURLToPath(new URL("./ConversationView.tsx", import.meta.url)), "utf8");

describe("the keyboard when the panel is opened", () => {
  test("an open the person asked for lands the keyboard in the intent box, scrolling nothing to do it", () => {
    const { box, takes } = boxTakingKeyboard();

    landKeyboardInIntent(box, 1);

    assert.deepEqual(takes, [{ preventScroll: true }]);
  });

  test("an open the person did not ask for lands the keyboard nowhere", () => {
    const { box, takes } = boxTakingKeyboard();

    landKeyboardInIntent(box, undefined);

    assert.deepEqual(takes, []);
  });

  test("the box the view stands is the one an open lands the keyboard in, once per open counted", () => {
    assert.match(viewSource, /landKeyboardInIntent\(intentBox\.current,\s*opensByPerson\)/);
    assert.match(viewSource, /\},\s*\[opensByPerson\]\)/);
  });
});

describe("the rehearsals a turn ran", () => {
  test("stands each rehearsal as a card of its own, out of the look-ups fold", () => {
    const markup = render({
      record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call: rehearsed({}) }] }]),
    });

    assert.deepEqual(cardKinds(markup), ["run"]);
    assert.match(markup, /data-assistant-run-state="ran"/);
    assert.doesNotMatch(markup, /data-assistant-lookups/);
  });

  test("cuts the timeline into one cell per stretch, keeping the thinks each stretch covers", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            {
              kind: "toolCall",
              call: rehearsed({
                spans: [
                  span(0, 4, { when: ["rule-1=false"] }),
                  span(4, 16, { fired: ["rule-1"], when: ["rule-1=true"], dispatched: ["actuator.move()=1@rule-1"] }),
                ],
              }),
            },
          ],
        },
      ]),
    });

    assert.deepEqual(valuesOf(markup, "data-assistant-cell-thinks"), ["4", "16"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-cell-activity"), ["watching", "acting"]);
    assert.match(markup, /data-assistant-timeline="20"/);
  });

  test("reads a gate's own sensor call as watching, and a rule that reached no gate as acting", () => {
    const gateReads = rehearsed({
      spans: [span(0, 20, { when: ["rule-1=false"], dispatched: ["sensor.see(a carnivore=1)=1@rule-1"] })],
    });
    const ungated = rehearsed({ spans: [span(0, 20, { dispatched: ["actuator.move()=1@rule-9"] })] });
    const parked = rehearsed({ spans: [span(0, 20, { waiting: ["rule-1"] })] });
    const idle = rehearsed({ spans: [span(0, 20, {})] });

    const activityOf = (call: ConversationToolCall): string[] =>
      valuesOf(
        render({ record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call }] }]) }),
        "data-assistant-cell-activity"
      );

    assert.deepEqual(activityOf(gateReads), ["watching"]);
    assert.deepEqual(activityOf(ungated), ["acting"]);
    assert.deepEqual(activityOf(parked), ["waiting"]);
    assert.deepEqual(activityOf(idle), ["quiet"]);
  });

  test("cuts a stretch again where the run changed state, bringing a state it returns to back", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            {
              kind: "toolCall",
              call: rehearsed({
                thinks: 3,
                spans: [span(0, 3, { fired: ["rule-1"], when: ["rule-1=true"] })],
                identity: ["0 00000001", "1 00000002", "2 00000001"],
              }),
            },
          ],
        },
      ]),
    });

    const steps = valuesOf(markup, "data-assistant-cell-identity");
    assert.equal(steps.length, 3, "one cell per state the run stood in");
    assert.equal(steps[0], steps[2], "the state it came back to reads as the state it started in");
    assert.notEqual(steps[0], steps[1]);
    assert.deepEqual(valuesOf(markup, "data-assistant-cell-thinks"), ["1", "1", "1"]);
  });

  test("leaves the cells of a run that logged no state carrying none", () => {
    const markup = render({
      record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call: rehearsed({ identity: [] }) }] }]),
    });

    assert.match(markup, /data-assistant-cell-activity/);
    assert.doesNotMatch(markup, /data-assistant-cell-identity/);
  });

  test("marks the page the brain moved to and the percepts the scenario delivered, in think order", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            {
              kind: "toolCall",
              call: rehearsed(
                {
                  spans: [span(0, 5, { when: ["rule-1=false"] }), span(5, 15, { when: ["rule-1=true"], page: "0->1" })],
                },
                {
                  scenario: {
                    seed: 1,
                    subject: "herbivore",
                    inputs: [{ kind: "carnivore-ahead", at: 2, value: 60 }],
                  },
                  thinks: 20,
                }
              ),
            },
          ],
        },
      ]),
    });

    assert.deepEqual(valuesOf(markup, "data-assistant-marker"), ["input", "page"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-marker-at"), ["2", "5"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-marker-kind"), ["carnivore-ahead"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-marker-page"), ["1"]);
  });

  test("says so where the record of a run stops before the run did", () => {
    const cut = rehearsed({ thinks: 400, spansTruncated: true, spans: [span(0, 30, { when: ["rule-1=true"] })] });

    const markup = render({ record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call: cut }] }]) });

    assert.match(markup, /data-assistant-run-truncated="true"/);
    assert.match(markup, /data-assistant-timeline-cut="370"/);
  });

  test("says a run stopped short of the thinks it was asked for, and says nothing when it did not", () => {
    const short = rehearsed({ thinks: 6 });
    const whole = rehearsed({});

    assert.match(
      render({ record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call: short }] }]) }),
      /data-assistant-run-asked="20"/
    );
    assert.doesNotMatch(
      render({ record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call: whole }] }]) }),
      /data-assistant-run-asked/
    );
  });

  test("opens to the stretch-by-stretch record and what the run dispatched in all", () => {
    const call = rehearsed({ dispatchTotals: ["actuator.move(wandering=1)=17", "sensor.see()=20"] });

    const markup = render({ record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call }] }]) });

    assert.equal(countOf(markup, /data-assistant-fold="run"/), 1);
    assert.deepEqual(valuesOf(markup, "data-assistant-run-step"), ["acting"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-dispatch-count"), ["17", "20"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-dispatch"), [
      escaped("actuator.move(wandering=1)"),
      escaped("sensor.see()"),
    ]);
  });

  test("keeps a rehearsal that never ran as a card carrying the code that stopped it, with no timeline", () => {
    const markup = render({
      record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call: rehearsalRefused("unknown_subject") }] }]),
    });

    assert.deepEqual(cardKinds(markup), ["run"]);
    assert.match(markup, /data-assistant-run-state="blocked"/);
    assert.match(markup, /data-assistant-run-blocked="unknown_subject"/);
    assert.doesNotMatch(markup, /data-assistant-timeline=/);
    assert.doesNotMatch(markup, /data-assistant-lookups/);
  });

  test("keeps a rehearsal the bridge could not serve out of the look-ups fold too", () => {
    const unserved: ConversationToolCall = {
      name: "simulate",
      input: scenario,
      outcome: { kind: "ok", payload: { error: "invalid_input", detail: "thinks: too_small" }, isError: true },
    };

    const markup = render({ record: record([{ kind: "assistant", steps: [{ kind: "toolCall", call: unserved }] }]) });

    assert.deepEqual(cardKinds(markup), ["run"]);
    assert.match(markup, /data-assistant-run-blocked="invalid_input"/);
  });

  test("stands the newest run full and folds every run it stands after to a line of its own", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: rehearsed({ runId: "run-1" }) },
            { kind: "toolCall", call: rehearsed({ runId: "run-2", thinks: 12 }) },
          ],
        },
      ]),
    });

    assert.deepEqual(cardKinds(markup), ["run", "run"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-run"), ["run-1", "run-2"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-run-superseded"), ["true"]);
    assert.equal(countOf(markup, /data-assistant-fold="run"/), 2, "a superseded run still opens to its record");
  });
});

describe("a build that came back dirty", () => {
  test("stands as a card of its own, out of the look-ups fold, counting what stops the build", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            {
              kind: "toolCall",
              call: dirtyBuild([droppedTile, { code: 3002, severity: "warning", ruleId: "rule-1", params: {} }]),
            },
          ],
        },
      ]),
    });

    assert.deepEqual(cardKinds(markup), ["build"]);
    assert.match(markup, /data-assistant-build-errors="1"/);
    assert.deepEqual(valuesOf(markup, "data-assistant-build-diag"), ["1016", "3002"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-build-severity"), ["error", "warning"]);
    assert.doesNotMatch(markup, /data-assistant-lookups/);
  });

  test("counts builds that came back reporting the very same things as one card", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: dirtyBuild([droppedTile]) },
            { kind: "toolCall", call: dirtyBuild([droppedTile]) },
            { kind: "toolCall", call: dirtyBuild([{ code: 1015, severity: "error", ruleId: "rule-2", params: {} }]) },
          ],
        },
      ]),
    });

    assert.deepEqual(cardKinds(markup), ["build", "build"]);
    assert.deepEqual(valuesOf(markup, "data-assistant-build-repeats"), ["2", "1"]);
  });

  test("leaves a clean build ticking the receipts standing, saying nothing of its own", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: appliedEdit },
            { kind: "toolCall", call: cleanBuild },
            { kind: "toolCall", call: dirtyBuild([droppedTile]) },
          ],
        },
      ]),
    });

    assert.deepEqual(cardKinds(markup), ["receipt", "build"]);
    assert.equal(countOf(markup, /data-assistant-compiles="ok"/), 1, "the tick a clean build left stands");
  });
});

describe("the turns a conversation stands after", () => {
  test("folds every turn but the newest to a header the keyboard opens", () => {
    const markup = render({
      record: record([
        { kind: "user", text: "make me hide" },
        {
          kind: "assistant",
          steps: [{ kind: "toolCall", call: appliedEdit }],
          ending: { kind: "end", code: RelayTurnEndCode.Complete },
        },
        { kind: "user", text: "now run away" },
        { kind: "assistant", steps: [{ kind: "narration", text: "On it." }] },
      ]),
    });

    assert.deepEqual(valuesOf(markup, "data-assistant-turn"), ["folded", "latest"]);
    assert.equal(countOf(markup, /<details[^>]*data-assistant-fold="turn"/), 1);
    assert.equal(countOf(markup, /data-assistant-fold="turn"/), 1);
  });

  test("leaves a lone turn standing full", () => {
    const markup = render({
      record: record([
        { kind: "user", text: "make me hide" },
        { kind: "assistant", steps: [{ kind: "narration", text: "On it." }] },
      ]),
    });

    assert.deepEqual(valuesOf(markup, "data-assistant-turn"), ["latest"]);
    assert.doesNotMatch(markup, /data-assistant-fold="turn"/);
  });

  test("keeps every block of a folded turn behind its header", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: appliedEdit },
            { kind: "toolCall", call: rehearsed({}) },
          ],
          ending: { kind: "end", code: RelayTurnEndCode.Complete },
        },
        { kind: "assistant", steps: [{ kind: "narration", text: "On it." }] },
      ]),
    });

    assert.deepEqual(cardKinds(markup), ["receipt", "run", "narration"]);
    assert.equal(countOf(markup, /<summary/), 3, "the turn's own header, its edits fold, and its run fold");
  });
});

describe("where a conversation got to when a turn left no answer", () => {
  const kept: readonly ConversationTurnStep[] = [
    { kind: "toolCall", call: placedOn(wandering, "rule-1", [moveTile]) },
    { kind: "toolCall", call: cleanBuild },
    { kind: "toolCall", call: rehearsed({}) },
  ];

  test("stands an account of what is kept above the note on every ending that left none", () => {
    const answerless = [RelayTurnEndCode.Stopped, RelayTurnEndCode.Truncated, RelayTurnEndCode.Failed] as const;

    for (const code of answerless) {
      const markup = render({ record: record([{ kind: "assistant", steps: kept, ending: { kind: "end", code } }]) });
      assert.match(markup, /data-assistant-card="gotto"/, code);
      assert.match(markup, /data-assistant-gotto-rules="1"/, code);
    }
    for (const code of Object.values(ConversationTurnFailureCode)) {
      const cut = record([{ kind: "assistant", steps: kept, ending: { kind: "failure", code } }]);
      assert.match(render({ record: cut }), /data-assistant-card="gotto"/, code);
    }
  });

  test("says nothing of the kind about a turn that simply finished", () => {
    const finished = record([
      { kind: "assistant", steps: kept, ending: { kind: "end", code: RelayTurnEndCode.Complete } },
    ]);

    assert.doesNotMatch(render({ record: finished }), /data-assistant-card="gotto"/);
  });

  test("stands above the note about how the turn ended, not below it", () => {
    const stopped = record([
      { kind: "assistant", steps: kept, ending: { kind: "end", code: RelayTurnEndCode.Stopped } },
    ]);

    const markup = render({ record: stopped });
    assert.ok(
      markup.indexOf('data-assistant-card="gotto"') < markup.indexOf("data-assistant-ending="),
      "the account of what is kept comes first"
    );
  });

  test("carries what every turn left standing, including the turns folded away", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [{ kind: "toolCall", call: placedOn(wandering, "rule-1", [moveTile]) }],
          ending: { kind: "end", code: RelayTurnEndCode.Complete },
        },
        {
          kind: "assistant",
          steps: [{ kind: "toolCall", call: placedOn(scared, "rule-2", [seeTile]) }],
          ending: { kind: "end", code: RelayTurnEndCode.Truncated },
        },
      ]),
    });

    assert.match(markup, /data-assistant-gotto-rules="2"/);
    assert.match(markup, /data-assistant-gotto-pages="2"/);
    assert.deepEqual(valuesOf(markup, "data-assistant-gotto-page"), [wandering.pageId, scared.pageId]);
  });

  test("takes a rule a later turn deleted back out of what is kept", () => {
    const removed: ConversationToolCall = {
      name: "propose_edit",
      input: { op: "deleteRule", ruleId: "rule-1" },
      outcome: {
        kind: "ok",
        payload: {
          ok: true,
          historyDepth: 2,
          onPage: wandering,
          removed: "rule",
          rule: { ruleId: "rule-1", when: [], do: [], children: [] },
        },
      },
    };
    const entries: readonly ConversationEntry[] = [
      {
        kind: "assistant",
        steps: [
          { kind: "toolCall", call: placedOn(wandering, "rule-1", [moveTile]) },
          { kind: "toolCall", call: placedOn(scared, "rule-2", [seeTile]) },
        ],
        ending: { kind: "end", code: RelayTurnEndCode.Complete },
      },
      {
        kind: "assistant",
        steps: [{ kind: "toolCall", call: removed }],
        ending: { kind: "end", code: RelayTurnEndCode.Stopped },
      },
    ];

    const kept = render({ record: record(entries) });
    const before = render({
      record: record([{ ...entries[0], ending: { kind: "end", code: RelayTurnEndCode.Stopped } } as ConversationEntry]),
    });

    assert.match(before, /data-assistant-gotto-rules="2"/, "both rules stand before the delete");
    assert.match(kept, /data-assistant-gotto-rules="1"/);
    assert.deepEqual(valuesOf(kept, "data-assistant-gotto-page"), [scared.pageId]);
  });

  test("says nothing at all when a turn that left no answer kept nothing either", () => {
    const nothing = record([
      { kind: "assistant", steps: [], ending: { kind: "failure", code: ConversationTurnFailureCode.NotConnected } },
    ]);

    const markup = render({ record: nothing });
    assert.doesNotMatch(markup, /data-assistant-card="gotto"/);
    assert.match(markup, /data-assistant-ending="not_connected"/);
  });

  test("counts the ways the editor refused a proposal that nothing took back", () => {
    const markup = render({
      record: record([
        {
          kind: "assistant",
          steps: [
            { kind: "toolCall", call: refusedEdit },
            { kind: "toolCall", call: refusedEdit },
            { kind: "toolCall", call: refusedFor(moveTile.tileId) },
            { kind: "toolCall", call: appliedEdit },
          ],
          ending: { kind: "end", code: RelayTurnEndCode.Truncated },
        },
      ]),
    });

    assert.match(markup, /data-assistant-gotto-snags="2"/);
  });
});
