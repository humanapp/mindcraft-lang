/**
 * Pins the accelerator registry against the editor's own key decisions, both
 * ways round.
 *
 * Forward: every press a contribution claims reaches a decision that does
 * something, in every mode the contribution stands in, and every press it
 * claims the browser keeps reaches none.
 *
 * Reverse: every press the decisions act on is claimed by some contribution of
 * that mode, so an accelerator nobody wrote up fails here.
 *
 * Shown: every press a contribution claims appears in one of the chip bindings
 * the help page draws, so a claim the reader never sees fails here too. The
 * other direction stays open: a binding may draw a key that is live only at
 * some moments, which the forward check cannot prove from one moment.
 *
 * The presses run through the real decision functions over one representative
 * moment per mode: a rule holding a word on each side, an offering of two
 * chips wrapped onto two rows, and a cursor standing on no chip. Claims and
 * modes are asserted; the markdown a contribution emits is display prose and is
 * asserted nowhere.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices } from "@wendoo-lang/core/brain";
import { RuleSide } from "@wendoo-lang/core/brain";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import {
  type AcceleratorBinding,
  type AcceleratorClaim,
  acceleratorsForMode,
  kAcceleratorContributions,
} from "./accelerators";
import type { StripCandidate, StripCellGeometry, StripOption } from "./candidate-strip-model";
import { type CaretPosition, caretRun } from "./caret-run";
import {
  type ComposerInputFacts,
  type ComposerInputState,
  composerTokenForKey,
  composerTrayToken,
  decideSentenceCellEntry,
  reduceComposerInput,
} from "./composer-input-model";
import { type EditorMode, kEditorModes } from "./editor-mode";
import { decideHistoryShortcut } from "./history-shortcut";
import {
  decidePageGridGrab,
  decidePageGridOperation,
  decidePageKey,
  type PageGridCell,
  pageGridRows,
  resolvePageGridCursor,
} from "./page-grid-model";
import { makeActuator, makeBrain, makeSensor } from "./test-only-rule-fixtures";

/** One press, as the decisions read it. */
interface Press {
  readonly key: string;
  readonly withCommand: boolean;
}

/** The keys the sweep presses, with and without the command modifier. */
const kProbedKeys: readonly string[] = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  " ",
  "Escape",
  "Tab",
  "Home",
  "End",
  "Delete",
  "Backspace",
  ",",
  ".",
  '"',
  "a",
  "1",
  "+",
  "(",
  "c",
  "x",
  "v",
  "z",
  "Z",
  "y",
];

let services: BrainServices;
let run: readonly CaretPosition[];
let rows: readonly (readonly PageGridCell[])[];
let facts: (mode: EditorMode) => ComposerInputFacts;

/** Every cell of the page's grid a press can land on. */
const kCells: readonly PageGridCell[] = [
  { kind: "handle", ruleId: "r1" },
  { kind: "tile", ruleId: "r1", side: RuleSide.When, tileIndex: 0 },
  { kind: "append", ruleId: "r1", side: RuleSide.When },
  { kind: "sentence", ruleId: "r1" },
  { kind: "append-rule" },
];

/** The tile the armed position was opened on, which the tray's Delete takes out. */
const kArmedElement: CaretPosition = { kind: "element", side: RuleSide.When, tileIndex: 0 };

const kOptions: readonly StripOption[] = [
  { optionId: "opt-lead", bandKey: "best", candidateKey: "lead" },
  { optionId: "opt-next", bandKey: "best", candidateKey: "next" },
];

/** Two chips wrapped onto two rows, so the vertical arrows have somewhere to step. */
const kGeometry: readonly StripCellGeometry[] = [
  { cursor: { kind: "chip", optionId: "opt-lead" }, left: 0, width: 40, top: 0 },
  { cursor: { kind: "chip", optionId: "opt-next" }, left: 0, width: 40, top: 40 },
];

before(() => {
  services = __test__createBrainServices();
  const { ruleDef } = makeBrain(
    services,
    [makeSensor(services, "accelerator-when")],
    [makeActuator(services, "accelerator-do")]
  );
  run = caretRun(ruleDef);
  rows = pageGridRows([
    { ruleId: "r1", whenTileCount: 1, doTileCount: 1, whenAppendable: true, doAppendable: true, hasSentence: true },
  ]);
  const candidate: StripCandidate = {
    key: "lead",
    tileDef: makeSensor(services, "accelerator-candidate"),
    label: "lead",
    group: "sensor",
    viaConversion: false,
    origin: { kind: "suggested" },
  };
  facts = (mode) => {
    // A text value in progress stands its own text cursor at the end of what
    // has been typed into it.
    const typed = mode === "text-literal" ? 2 : 0;
    return {
      mode,
      caretRun: run,
      textCursor: { start: typed, end: typed },
      armedSideCanEnd: true,
      positionOffersTile: true,
      ruleIsEmpty: false,
      doTileCount: 1,
      ownNewestPlacement: undefined,
      topCandidate: candidate,
      spaceCandidate: candidate,
      highlightedCandidate: undefined,
      leadCursor: { kind: "chip", optionId: "opt-lead" },
      acceptsTextLiteral: true,
      pendingTextLiteral: candidate,
      options: kOptions,
      cellGeometry: kGeometry,
    };
  };
});

/**
 * The composer states `mode` is probed in. Every mode but `text-literal` has
 * one; a text value can stand on either surface, so both are probed and a key
 * live on either counts as live.
 */
function composerStates(mode: EditorMode): ComposerInputState[] {
  const entries = mode === "composing" ? (["sentence"] as const) : ([mode === "text-literal" ? null : "tray"] as const);
  const surfaces = mode === "text-literal" ? (["tray", "sentence"] as const) : entries;
  const states: ComposerInputState[] = [];
  for (const entry of surfaces) {
    if (entry === null) continue;
    const composes = entry === "sentence";
    states.push({
      caret: composes ? (run.find((position) => position.kind === "element") ?? run[0]) : undefined,
      armedSide: RuleSide.When,
      armedEntry: entry,
      filter: "",
      cursor: undefined,
      highlightMode: "typing",
      pivoted: false,
      textLiteral: mode === "text-literal" ? "hi" : undefined,
    });
  }
  return states;
}

/** What every page-grid decision makes of `press`, over every cell. */
function gridOutcome(press: Press): string {
  return JSON.stringify(
    kCells.map((cell) => {
      const full = { ...press, placement: "on-cell" } as const;
      return [
        decidePageKey(rows, resolvePageGridCursor(rows, cell), full, undefined),
        decidePageGridOperation(cell, full) ?? null,
        decidePageGridGrab(cell, full),
        cell.kind === "sentence" ? (decideSentenceCellEntry(press.key, press.withCommand) ?? null) : null,
      ];
    })
  );
}

/** What the page makes of `press` while it holds rule 1. */
function heldOutcome(press: Press): string {
  const cursor = resolvePageGridCursor(rows, kCells[0]);
  return JSON.stringify(decidePageKey(rows, cursor, { ...press, placement: "on-cell" }, "r1"));
}

/** What the composer makes of `press` in `mode`, over every state that mode is probed in. */
function composerOutcome(mode: EditorMode, press: Press): string {
  const tray = composerTrayToken(press.key, mode, kArmedElement) ?? null;
  const token = composerTokenForKey(press.key, "filter", press.withCommand) ?? null;
  const reduced = composerStates(mode).map((state) =>
    token === null ? [] : reduceComposerInput(state, token, facts(mode)).effects
  );
  return JSON.stringify([tray, token, reduced]);
}

/** The step `press` takes along the editor's history in `mode`, or null for none. */
function historyOutcome(mode: EditorMode, press: Press): string {
  return JSON.stringify(decideHistoryShortcut(mode, press) ?? null);
}

/** What every decision of `mode` makes of `press`, as a value two presses compare by. */
function outcome(mode: EditorMode, press: Press): string {
  const surface =
    mode === "grid-selection"
      ? gridOutcome(press)
      : mode === "rule-held"
        ? heldOutcome(press)
        : composerOutcome(mode, press);
  return `${surface}|${historyOutcome(mode, press)}`;
}

/** True when `mode` acts on `press` at the moment it is probed in. */
function isLive(mode: EditorMode, press: Press): boolean {
  if (decideHistoryShortcut(mode, press) !== undefined) return true;
  if (mode === "grid-selection") {
    for (const cell of kCells) {
      const full = { ...press, placement: "on-cell" } as const;
      if (decidePageKey(rows, resolvePageGridCursor(rows, cell), full, undefined).kind !== "inert") return true;
      if (decidePageGridOperation(cell, full) !== undefined) return true;
      if (decidePageGridGrab(cell, full)) return true;
      if (cell.kind === "sentence" && decideSentenceCellEntry(press.key, press.withCommand) !== undefined) return true;
    }
    return false;
  }
  if (mode === "rule-held") {
    const cursor = resolvePageGridCursor(rows, kCells[0]);
    return decidePageKey(rows, cursor, { ...press, placement: "on-cell" }, "r1").kind !== "inert";
  }
  if (composerTrayToken(press.key, mode, kArmedElement) !== undefined) return true;
  const token = composerTokenForKey(press.key, "filter", press.withCommand);
  if (token === undefined) return false;
  return composerStates(mode).some((state) => reduceComposerInput(state, token, facts(mode)).effects.length > 0);
}

/** True when `mode` takes text typed into its surface. */
function takesTyping(mode: EditorMode): boolean {
  if (mode === "grid-selection") return decideSentenceCellEntry("a", false) !== undefined;
  if (mode === "rule-held") return false;
  return composerStates(mode).some(
    (state) =>
      reduceComposerInput(state, { kind: "text", text: `${state.textLiteral ?? state.filter}a` }, facts(mode)).effects
        .length > 0
  );
}

/** How a press reads in a failure message. */
function pressName(press: Press): string {
  return `${press.withCommand ? "Command+" : ""}${press.key === " " ? "Space" : press.key}`;
}

/** True when `claim` claims `press`, counting a typing claim for any single character but Space. */
function claimCovers(claim: AcceleratorClaim, press: Press): boolean {
  if (claim.kind === "typing") return !press.withCommand && press.key.length === 1 && press.key !== " ";
  if (claim.kind === "pointer") return false;
  return claim.key === press.key && (claim.withCommand ?? false) === press.withCommand;
}

/** True when `binding` draws the press `claim` names. */
function bindingDraws(binding: AcceleratorBinding, claim: AcceleratorClaim): boolean {
  if (binding.kind !== "chord") return false;
  if (claim.kind !== "key" && claim.kind !== "browser") return false;
  const withCommand = (binding.modifiers ?? []).includes("command");
  return binding.keys.includes(claim.key) && withCommand === (claim.withCommand ?? false);
}

describe("accelerator registry", () => {
  test("every contribution has a unique id and at least one claim and binding in at least one mode", () => {
    const ids = kAcceleratorContributions.map((contribution) => contribution.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const contribution of kAcceleratorContributions) {
      assert.ok(contribution.when.length > 0, `${contribution.id} stands in no mode`);
      assert.ok(contribution.claims.length > 0, `${contribution.id} claims nothing`);
      assert.ok(contribution.bindings.length > 0, `${contribution.id} draws nothing`);
      for (const binding of contribution.bindings) {
        if (binding.kind === "chord") {
          assert.ok(binding.keys.length > 0, `${contribution.id} draws a chord with no key`);
        }
      }
      for (const mode of contribution.when) {
        assert.ok(kEditorModes.includes(mode), `${contribution.id} names the unknown mode ${mode}`);
      }
    }
  });

  test("every press a contribution claims is drawn by one of its bindings", () => {
    for (const contribution of kAcceleratorContributions) {
      for (const claim of contribution.claims) {
        if (claim.kind !== "key" && claim.kind !== "browser") continue;
        const press = { key: claim.key, withCommand: claim.withCommand ?? false };
        assert.ok(
          contribution.bindings.some((binding) => bindingDraws(binding, claim)),
          `${contribution.id} claims ${pressName(press)}, which none of its bindings draw`
        );
      }
    }
  });

  test("every key a contribution claims does something in every mode it stands in", () => {
    for (const contribution of kAcceleratorContributions) {
      for (const mode of contribution.when) {
        for (const claim of contribution.claims) {
          if (claim.kind === "key") {
            const press = { key: claim.key, withCommand: claim.withCommand ?? false };
            assert.ok(isLive(mode, press), `${contribution.id} claims ${pressName(press)}, inert in ${mode}`);
          }
          if (claim.kind === "typing") {
            assert.ok(takesTyping(mode), `${contribution.id} claims typing, which ${mode} does not take`);
          }
        }
      }
    }
  });

  test("every key a contribution leaves to the browser reaches no decision", () => {
    for (const contribution of kAcceleratorContributions) {
      for (const claim of contribution.claims) {
        if (claim.kind !== "browser") continue;
        for (const mode of contribution.when) {
          const press = { key: claim.key, withCommand: claim.withCommand ?? false };
          assert.ok(!isLive(mode, press), `${contribution.id} leaves ${pressName(press)} alone, acted on in ${mode}`);
        }
      }
    }
  });

  test("every press a mode acts on is claimed by a contribution of that mode", () => {
    for (const mode of kEditorModes) {
      const claims = acceleratorsForMode(mode).flatMap((contribution) => contribution.claims);
      for (const key of kProbedKeys) {
        for (const withCommand of [false, true]) {
          const press = { key, withCommand };
          if (!isLive(mode, press)) continue;
          // A chord reading exactly as its unmodified press is the same
          // accelerator, documented once.
          if (withCommand && outcome(mode, press) === outcome(mode, { key, withCommand: false })) continue;
          assert.ok(
            claims.some((claim) => claimCovers(claim, press)),
            `${mode} acts on ${pressName(press)}, which no contribution claims`
          );
        }
      }
    }
  });

  test("every mode but the held rule offers at least one contribution", () => {
    for (const mode of kEditorModes) {
      const live = acceleratorsForMode(mode);
      assert.ok(live.length > 0, `${mode} documents nothing`);
    }
    assert.deepEqual(acceleratorsForMode(undefined), []);
  });
});
