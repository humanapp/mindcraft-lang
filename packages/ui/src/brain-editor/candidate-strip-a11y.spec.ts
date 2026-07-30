/**
 * Pins the inline candidate strip's assistive-technology contract: the pure
 * decision logic behind the active-descendant highlight and the Escape key, and
 * the combobox/listbox wiring the strip renders -- roles, expanded and controls
 * references, unique option ids, and the live status region.
 *
 * Structural assertions only: every attribute value asserted here is a role, an
 * id reference, or a state flag. Labels, placeholders, and announcement wording
 * are display prose and are never asserted.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { BrainServices, IBrainTileDef } from "@mindcraft-lang/core/brain";
import {
  CoreLiteralFactoryId,
  CoreVariableFactoryId,
  mkLiteralFactoryTileId,
  mkOperatorTileId,
  mkVariableFactoryTileId,
  RuleSide,
} from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
import {
  bag,
  CoreHostActions,
  CoreOpId,
  CoreTypeIds,
  mkActionDescriptor,
  mkActuatorTileId,
  mkCallDef,
  mkSensorTileId,
  VOID_VALUE,
} from "@mindcraft-lang/core/runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrainCandidateStrip } from "./BrainCandidateStrip";
import { type BrainEditorConfig, BrainEditorProvider } from "./BrainEditorContext";
import {
  activeStripOption,
  arrangeCandidateSubcategories,
  bandOfStripOption,
  type CandidateEntry,
  decideStripEscape,
  decideStripFocusTarget,
  enterStripOptionsAt,
  isStripFilterTypingKey,
  kBestNextBandKey,
  mintVariableCandidates,
  moveActiveStripOption,
  moveActiveStripOption2D,
  type StripCandidate,
  type StripOptionBand,
  type StripOptionGeometry,
  stripBandPanelId,
  stripOptionId,
  tileCandidateGroup,
  toCandidateEntries,
  visibleStripOptions,
} from "./candidate-strip-model";
import type { CandidateStripSection, CandidateStripState } from "./hooks/useCandidateStrip";
import type { TileSourceLibrary } from "./tile-library-groups";

let services: BrainServices;

/** The provenance layer a probe sensor stands in for in the subcategory renders. */
type ProvenanceProbe = "application" | "library" | "libraryAlt";

/** Coordinates and display names of the installed libraries the probes are attributed to. */
const kLibrary: TileSourceLibrary = { coordinate: "strip-a11y/lib-one", name: "Zephyr Motors" };
const kLibraryAlt: TileSourceLibrary = { coordinate: "strip-a11y/lib-two", name: "Aster Sensors" };

/** Namespace of the active project in the render probes; no probe tile carries it. */
const kProjectNamespace = "strip-a11y-project";

let probeTileIds: Record<ProvenanceProbe, string>;

/**
 * Register real sensors covering the application and library provenance layers,
 * so a rendered section can hold more than one subcategory. Returns each
 * sensor's tile id keyed by the layer it stands in for.
 */
function registerProvenanceProbes(): Record<ProvenanceProbe, string> {
  const specs: readonly (readonly [ProvenanceProbe, string, number, string | undefined])[] = [
    ["application", "strip-a11y-app", 4920, undefined],
    ["library", "strip-a11y-lib", 4921, kLibrary.coordinate],
    ["libraryAlt", "strip-a11y-lib-alt", 4922, kLibraryAlt.coordinate],
  ];
  const tileIds = {} as Record<ProvenanceProbe, string>;
  for (const [probe, sensorId, fnId, namespace] of specs) {
    const fnEntry = services.runtime.functions.register(
      fnId,
      sensorId,
      false,
      { exec: () => VOID_VALUE },
      mkCallDef(bag())
    );
    const tileDef = new BrainTileSensorDef(sensorId, mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Boolean), {
      metadata: { label: sensorId },
      userIdentity: namespace === undefined ? undefined : { namespace, actionId: sensorId },
    });
    services.edit.tiles.registerTileDef(tileDef);
    tileIds[probe] = tileDef.tileId;
  }
  return tileIds;
}

before(() => {
  services = __test__createBrainServices();
  probeTileIds = registerProvenanceProbes();
});

function coreTile(tileId: string): IBrainTileDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `core tile not registered: ${tileId}`);
  return tileDef;
}

/** A candidate over a real core tile, keyed by its tile id as the strip's own candidates are. */
function candidate(tileId: string, viaConversion = false): StripCandidate {
  const tileDef = coreTile(tileId);
  return {
    key: viaConversion ? `conv:${tileId}` : tileId,
    tileDef,
    label: tileId,
    group: tileCandidateGroup(tileDef),
    viaConversion,
    origin: { kind: "suggested" },
  };
}

/** The strip's DOM id in every render probe, so option ids are deterministic. */
const kStripId = "strip";

const editorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map(),
  dataTypeNames: new Map(),
  customLiteralTypes: [],
  projectNamespace: kProjectNamespace,
  libraries: [kLibrary, kLibraryAlt],
};

/** A section in the shape the strip's hook builds it: its chips arranged into provenance clusters. */
function section(entries: readonly CandidateEntry[]): CandidateStripSection {
  const subcategories = arrangeCandidateSubcategories(entries, { projectNamespace: kProjectNamespace }, [
    kLibrary,
    kLibraryAlt,
  ]);
  return {
    key: entries[0].candidate.group,
    group: entries[0].candidate.group,
    subcategories,
    entries: subcategories.flatMap((subcategory) => subcategory.entries),
    totalCount: entries.length,
  };
}

function stripState(overrides: Partial<CandidateStripState>): CandidateStripState {
  return {
    bestNext: [],
    sections: [],
    filter: "",
    isUnknown: false,
    commitsWordInProgress: false,
    setFilter: () => {},
    commit: () => {},
    commitByKey: () => {},
    commitFromKey: () => undefined,
    ...overrides,
  };
}

function render(state: CandidateStripState): string {
  return renderToStaticMarkup(
    createElement(
      BrainEditorProvider,
      { config: editorConfig },
      createElement(BrainCandidateStrip, { id: kStripId, state, side: RuleSide.When, onDismiss: () => {} })
    )
  );
}

/** Every `id` attribute value in `markup`, in document order. */
function idsIn(markup: string): string[] {
  return [...markup.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]);
}

/** Every value of the attribute `name` in `markup`, in document order. */
function attributeValues(markup: string, name: string): string[] {
  return [...markup.matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g"))].map((match) => match[1]);
}

/** The opening tags in `markup` that carry `role="<role>"`. */
function tagsWithRole(markup: string, role: string): string[] {
  return [...markup.matchAll(/<[a-z]+\s[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => tag.includes(`role="${role}"`));
}

/** The value of `attribute` on `tag`, or undefined when the tag does not carry it. */
function attributeOf(tag: string, attribute: string): string | undefined {
  return new RegExp(`\\s${attribute}="([^"]*)"`).exec(tag)?.[1];
}

/** The individual ids of an id-list attribute value such as `aria-describedby`. */
function idReferences(value: string | undefined): string[] {
  return value === undefined ? [] : value.split(/\s+/).filter((token) => token.length > 0);
}

/**
 * The markup of the element carrying `id`, from its opening tag through its
 * matching closing tag, so a test can assert what that element contains.
 */
function elementById(markup: string, id: string): string {
  const opening = new RegExp(`<([a-z]+)[^>]*\\sid="${id}"[^>]*>`).exec(markup);
  assert.ok(opening, `no element carries the id ${id}`);
  const scanner = new RegExp(`<${opening[1]}(?:\\s[^>]*)?>|</${opening[1]}>`, "g");
  scanner.lastIndex = opening.index;
  let depth = 0;
  for (let hit = scanner.exec(markup); hit !== null; hit = scanner.exec(markup)) {
    depth += hit[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return markup.slice(opening.index, hit.index + hit[0].length);
  }
  assert.fail(`the element ${id} is never closed`);
}

/** The text an element renders, with every tag and attribute stripped out. */
function renderedText(markup: string): string {
  return markup.replace(/<[^>]*>/g, "");
}

const timeoutTileId = mkSensorTileId(CoreHostActions.Timeout.key);
const pageEnteredTileId = mkSensorTileId(CoreHostActions.OnPageEntered.key);
const switchPageTileId = mkActuatorTileId(CoreHostActions.SwitchPage.key);
const notTileId = mkOperatorTileId(CoreOpId.Not);
const numberLiteralFactoryId = mkLiteralFactoryTileId(CoreLiteralFactoryId.Number);
const numberVarFactoryId = mkVariableFactoryTileId(CoreVariableFactoryId.Number);

function bands(): StripOptionBand[] {
  return [
    { key: kBestNextBandKey, entries: toCandidateEntries([candidate(timeoutTileId), candidate(pageEnteredTileId)]) },
    { key: "operator+controlFlow", entries: toCandidateEntries([candidate(notTileId)]) },
  ];
}

describe("visibleStripOptions", () => {
  test("walks the best-next row first, then each open band, in band order", () => {
    const options = visibleStripOptions(kStripId, bands());
    assert.deepEqual(
      options.map((option) => option.candidateKey),
      [timeoutTileId, pageEnteredTileId, notTileId]
    );
    assert.deepEqual(
      options.map((option) => option.bandKey),
      [kBestNextBandKey, kBestNextBandKey, "operator+controlFlow"]
    );
  });

  test("gives every rendered chip a distinct id, including the same candidate in two bands", () => {
    const repeated: StripOptionBand[] = [
      { key: kBestNextBandKey, entries: toCandidateEntries([candidate(timeoutTileId)]) },
      { key: "sensor", entries: toCandidateEntries([candidate(timeoutTileId)]) },
    ];
    const ids = visibleStripOptions(kStripId, repeated).map((option) => option.optionId);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("distinct candidate keys never share an id", () => {
    const colliding: StripOptionBand[] = [
      {
        key: kBestNextBandKey,
        entries: toCandidateEntries([
          { ...candidate(timeoutTileId), key: "a:b" },
          { ...candidate(timeoutTileId), key: "a_b" },
          { ...candidate(timeoutTileId), key: "a/b" },
        ]),
      },
    ];
    const ids = visibleStripOptions(kStripId, colliding).map((option) => option.optionId);
    assert.equal(new Set(ids).size, 3);
  });

  test("ids are stable across calls for the same offering", () => {
    const first = visibleStripOptions(kStripId, bands()).map((option) => option.optionId);
    const second = visibleStripOptions(kStripId, bands()).map((option) => option.optionId);
    assert.deepEqual(first, second);
  });

  test("ids carry no characters that are illegal in a DOM id", () => {
    for (const option of visibleStripOptions(kStripId, bands())) {
      assert.match(option.optionId, /^[A-Za-z][A-Za-z0-9_-]*$/);
    }
  });
});

describe("moveActiveStripOption", () => {
  test("steps forward from nothing to the first chip and back to the last", () => {
    const options = visibleStripOptions(kStripId, bands());
    assert.equal(moveActiveStripOption(options, undefined, 1), options[0].optionId);
    assert.equal(moveActiveStripOption(options, undefined, -1), options[options.length - 1].optionId);
  });

  test("walks the whole sequence, crossing from the best-next row into the open band", () => {
    const options = visibleStripOptions(kStripId, bands());
    let active = moveActiveStripOption(options, undefined, 1);
    const walked = [active];
    for (let step = 1; step < options.length; step++) {
      active = moveActiveStripOption(options, active, 1);
      walked.push(active);
    }
    assert.deepEqual(
      walked,
      options.map((option) => option.optionId)
    );
  });

  test("wraps at both ends", () => {
    const options = visibleStripOptions(kStripId, bands());
    const last = options[options.length - 1].optionId;
    assert.equal(moveActiveStripOption(options, last, 1), options[0].optionId);
    assert.equal(moveActiveStripOption(options, options[0].optionId, -1), last);
  });

  test("an offering with no chip has nothing to highlight", () => {
    assert.equal(moveActiveStripOption([], undefined, 1), undefined);
    assert.equal(moveActiveStripOption([], undefined, -1), undefined);
  });

  test("a highlight on a chip that is no longer rendered restarts from the end of the sequence", () => {
    const options = visibleStripOptions(kStripId, bands());
    assert.equal(moveActiveStripOption(options, "strip-gone-gone", 1), options[0].optionId);
  });

  test("the horizontal step ignores where a chip sits, walking the render sequence across wraps", () => {
    const options = visibleStripOptions(kStripId, wrappedBands());
    let active = moveActiveStripOption(options, undefined, 1);
    const walked = [active];
    for (let step = 1; step < options.length; step++) {
      active = moveActiveStripOption(options, active, 1);
      walked.push(active);
    }
    assert.deepEqual(
      walked,
      options.map((option) => option.optionId)
    );
  });
});

/**
 * A wrapped offering with more chips than one row holds: a best-next row of
 * four chips and an open band of two, which the geometry fixture lays out as
 * three visual rows.
 */
function wrappedBands(): StripOptionBand[] {
  return [
    {
      key: kBestNextBandKey,
      entries: toCandidateEntries([
        candidate(timeoutTileId),
        candidate(pageEnteredTileId),
        candidate(switchPageTileId),
        candidate(notTileId),
      ]),
    },
    { key: "literal", entries: toCandidateEntries([candidate(numberLiteralFactoryId), candidate(timeoutTileId)]) },
  ];
}

/** Vertical distance between two wrapped rows in the geometry fixtures. */
const kRowPitch = 52;

/**
 * The chips of {@link wrappedBands} measured as three visual rows, in the order
 * the strip renders them. Row 0 and row 1 wrap the best-next band; row 2 is the
 * open band. `rowTops` overrides each chip's top so a test can stagger a row.
 */
function wrappedGeometry(rowTops?: readonly number[]): StripOptionGeometry[] {
  const options = visibleStripOptions(kStripId, wrappedBands());
  // left, width, row -- centers: row 0 at 50 and 158, row 1 at 30 and 118, row 2 at 70 and 198.
  const boxes: readonly (readonly [number, number, number])[] = [
    [0, 100, 0],
    [108, 100, 0],
    [0, 60, 1],
    [68, 100, 1],
    [0, 140, 2],
    [148, 100, 2],
  ];
  return options.map((option, index) => {
    const [left, width, row] = boxes[index];
    return { optionId: option.optionId, left, width, top: rowTops?.[index] ?? row * kRowPitch };
  });
}

/** The option id at `index` of the rendered sequence of {@link wrappedBands}. */
function wrappedOptionId(index: number): string {
  return visibleStripOptions(kStripId, wrappedBands())[index].optionId;
}

describe("moveActiveStripOption2D", () => {
  test("stepping down takes the chip below, not the chip beside", () => {
    const geometry = wrappedGeometry();
    const options = visibleStripOptions(kStripId, wrappedBands());
    const beside = moveActiveStripOption(options, wrappedOptionId(0), 1);
    assert.equal(beside, wrappedOptionId(1));
    assert.equal(moveActiveStripOption2D(geometry, wrappedOptionId(0), 1), wrappedOptionId(2));
  });

  test("the chip below is the one whose center is nearest the current center", () => {
    const geometry = wrappedGeometry();
    assert.equal(moveActiveStripOption2D(geometry, wrappedOptionId(1), 1), wrappedOptionId(3));
    assert.equal(moveActiveStripOption2D(geometry, wrappedOptionId(3), -1), wrappedOptionId(1));
  });

  test("a row staggered within the grouping tolerance stays one row", () => {
    const staggered = wrappedGeometry([0, 3, kRowPitch, kRowPitch + 2, 2 * kRowPitch, 2 * kRowPitch + 1]);
    assert.equal(moveActiveStripOption2D(staggered, wrappedOptionId(0), 1), wrappedOptionId(2));
    assert.equal(moveActiveStripOption2D(staggered, wrappedOptionId(1), 1), wrappedOptionId(3));
  });

  test("the vertical step crosses from one band into the next", () => {
    const geometry = wrappedGeometry();
    const options = visibleStripOptions(kStripId, wrappedBands());
    const moved = moveActiveStripOption2D(geometry, wrappedOptionId(3), 1);
    assert.equal(moved, wrappedOptionId(4));
    assert.equal(activeStripOption(options, wrappedOptionId(3))?.bandKey, kBestNextBandKey);
    assert.equal(activeStripOption(options, moved)?.bandKey, "literal");
  });

  test("stepping up crosses back into the preceding band", () => {
    const geometry = wrappedGeometry();
    assert.equal(moveActiveStripOption2D(geometry, wrappedOptionId(4), -1), wrappedOptionId(2));
  });

  test("wraps from the bottom row to the top row and back", () => {
    const geometry = wrappedGeometry();
    assert.equal(moveActiveStripOption2D(geometry, wrappedOptionId(5), 1), wrappedOptionId(1));
    assert.equal(moveActiveStripOption2D(geometry, wrappedOptionId(0), -1), wrappedOptionId(4));
  });

  test("an offering that fits on one row keeps the highlight where it is", () => {
    const singleRow = wrappedGeometry()
      .slice(0, 2)
      .map((measured) => ({ ...measured, top: 0 }));
    assert.equal(moveActiveStripOption2D(singleRow, wrappedOptionId(0), 1), wrappedOptionId(0));
    assert.equal(moveActiveStripOption2D(singleRow, wrappedOptionId(1), -1), wrappedOptionId(1));
  });

  test("two equally near chips below resolve to the leading one", () => {
    const tied: StripOptionGeometry[] = [
      { optionId: wrappedOptionId(0), left: 50, width: 100, top: 0 },
      { optionId: wrappedOptionId(1), left: 0, width: 100, top: kRowPitch },
      { optionId: wrappedOptionId(2), left: 100, width: 100, top: kRowPitch },
    ];
    assert.equal(moveActiveStripOption2D(tied, wrappedOptionId(0), 1), wrappedOptionId(1));
  });

  test("steps into the sequence from nothing, forward at the first chip and back at the last", () => {
    const geometry = wrappedGeometry();
    assert.equal(moveActiveStripOption2D(geometry, undefined, 1), wrappedOptionId(0));
    assert.equal(moveActiveStripOption2D(geometry, undefined, -1), wrappedOptionId(5));
    assert.equal(moveActiveStripOption2D(geometry, "strip-gone-gone", 1), wrappedOptionId(0));
  });

  test("an offering with no chip has nothing to highlight", () => {
    assert.equal(moveActiveStripOption2D([], undefined, 1), undefined);
    assert.equal(moveActiveStripOption2D([], "strip-gone-gone", -1), undefined);
  });

  test("the same geometry moves the highlight the same way every time", () => {
    assert.equal(
      moveActiveStripOption2D(wrappedGeometry(), wrappedOptionId(1), 1),
      moveActiveStripOption2D(wrappedGeometry(), wrappedOptionId(1), 1)
    );
    assert.equal(
      moveActiveStripOption2D(wrappedGeometry(), wrappedOptionId(4), -1),
      moveActiveStripOption2D(wrappedGeometry(), wrappedOptionId(4), -1)
    );
  });

  test("geometry given out of render order still groups by position", () => {
    const shuffled = [...wrappedGeometry()].reverse();
    assert.equal(moveActiveStripOption2D(shuffled, wrappedOptionId(0), 1), wrappedOptionId(2));
    assert.equal(moveActiveStripOption2D(shuffled, wrappedOptionId(4), -1), wrappedOptionId(2));
  });
});

describe("enterStripOptionsAt", () => {
  const conversionBandKey = "operator+controlFlow";

  test("stepping forward at a band enters that band's first chip", () => {
    const sequence = bands();
    const options = visibleStripOptions(kStripId, sequence);
    const firstInBand = options.find((option) => option.bandKey === conversionBandKey);
    assert.ok(firstInBand);
    assert.equal(enterStripOptionsAt(kStripId, sequence, conversionBandKey, 1), firstInBand.optionId);
  });

  test("stepping forward at a band whose chips are all filtered out enters nothing", () => {
    const emptied: StripOptionBand[] = [
      { key: kBestNextBandKey, entries: toCandidateEntries([candidate(timeoutTileId)]) },
      { key: conversionBandKey, entries: [] },
    ];
    assert.equal(enterStripOptionsAt(kStripId, emptied, conversionBandKey, 1), undefined);
    assert.equal(enterStripOptionsAt(kStripId, emptied, conversionBandKey, -1), undefined);
  });

  test("stepping back at a band enters the chip before it in the sequence", () => {
    const sequence = bands();
    const options = visibleStripOptions(kStripId, sequence);
    const firstInBand = options.findIndex((option) => option.bandKey === conversionBandKey);
    assert.ok(firstInBand > 0);
    assert.equal(enterStripOptionsAt(kStripId, sequence, conversionBandKey, -1), options[firstInBand - 1].optionId);
  });

  test("stepping back at the leading band wraps to the last chip of the sequence", () => {
    const sequence = bands();
    const options = visibleStripOptions(kStripId, sequence);
    assert.equal(enterStripOptionsAt(kStripId, sequence, kBestNextBandKey, -1), options[options.length - 1].optionId);
  });

  test("a band absent from the rendered sequence enters nothing", () => {
    assert.equal(enterStripOptionsAt(kStripId, bands(), "sensor", 1), undefined);
    assert.equal(enterStripOptionsAt(kStripId, bands(), "sensor", -1), undefined);
    assert.equal(enterStripOptionsAt(kStripId, [], kBestNextBandKey, 1), undefined);
  });

  test("entry lands on a rendered option the arrow keys then continue from", () => {
    const sequence = bands();
    const options = visibleStripOptions(kStripId, sequence);
    const entered = enterStripOptionsAt(kStripId, sequence, conversionBandKey, 1);
    assert.ok(entered);
    assert.ok(activeStripOption(options, entered));
    const index = options.findIndex((option) => option.optionId === entered);
    assert.equal(moveActiveStripOption(options, entered, 1), options[(index + 1) % options.length].optionId);
  });

  test("entry is deterministic for the same offering", () => {
    assert.equal(
      enterStripOptionsAt(kStripId, bands(), conversionBandKey, 1),
      enterStripOptionsAt(kStripId, bands(), conversionBandKey, 1)
    );
    assert.equal(
      enterStripOptionsAt(kStripId, bands(), conversionBandKey, -1),
      enterStripOptionsAt(kStripId, bands(), conversionBandKey, -1)
    );
  });
});

describe("activeStripOption", () => {
  test("resolves a rendered id and rejects one that is not rendered", () => {
    const options = visibleStripOptions(kStripId, bands());
    assert.equal(activeStripOption(options, options[1].optionId)?.candidateKey, pageEnteredTileId);
    assert.equal(activeStripOption(options, "strip-gone-gone"), undefined);
    assert.equal(activeStripOption(options, undefined), undefined);
  });
});

describe("bandOfStripOption", () => {
  test("reports the band a rendered chip belongs to", () => {
    const options = visibleStripOptions(kStripId, bands());
    assert.equal(bandOfStripOption(options, options[0].optionId), kBestNextBandKey);
    assert.equal(bandOfStripOption(options, options[2].optionId), "operator+controlFlow");
  });

  test("reports no band for a chip that is not rendered", () => {
    const options = visibleStripOptions(kStripId, bands());
    assert.equal(bandOfStripOption(options, "strip-gone-gone"), undefined);
    assert.equal(bandOfStripOption(options, undefined), undefined);
    assert.equal(bandOfStripOption([], options[0].optionId), undefined);
  });
});

describe("decideStripFocusTarget", () => {
  test("typing mode anchors the highlight on the filter box wherever it rests", () => {
    const options = visibleStripOptions(kStripId, bands());
    assert.deepEqual(decideStripFocusTarget(options, undefined, "typing"), { kind: "input" });
    assert.deepEqual(decideStripFocusTarget(options, options[0].optionId, "typing"), { kind: "input" });
    assert.deepEqual(decideStripFocusTarget(options, options[2].optionId, "typing"), { kind: "input" });
  });

  test("entering a band from its heading anchors the highlight on that band", () => {
    const sequence = bands();
    const options = visibleStripOptions(kStripId, sequence);
    const entered = enterStripOptionsAt(kStripId, sequence, "operator+controlFlow", 1);
    assert.ok(entered);
    assert.deepEqual(decideStripFocusTarget(options, entered, "browsing"), {
      kind: "band",
      bandKey: "operator+controlFlow",
    });
  });

  test("stepping back from a heading anchors on the band holding the preceding chip", () => {
    const sequence = bands();
    const options = visibleStripOptions(kStripId, sequence);
    const entered = enterStripOptionsAt(kStripId, sequence, "operator+controlFlow", -1);
    assert.ok(entered);
    assert.deepEqual(decideStripFocusTarget(options, entered, "browsing"), { kind: "band", bandKey: kBestNextBandKey });
  });

  test("crossing a band boundary anchors on the band the highlight moved into", () => {
    const options = visibleStripOptions(kStripId, wrappedBands());
    const geometry = wrappedGeometry();
    const before = wrappedOptionId(3);
    const after = moveActiveStripOption2D(geometry, before, 1);
    assert.deepEqual(decideStripFocusTarget(options, before, "browsing"), { kind: "band", bandKey: kBestNextBandKey });
    assert.deepEqual(decideStripFocusTarget(options, after, "browsing"), { kind: "band", bandKey: "literal" });
  });

  test("a highlight the offering no longer renders falls back to the filter box", () => {
    const options = visibleStripOptions(kStripId, bands());
    assert.deepEqual(decideStripFocusTarget(options, "strip-gone-gone", "browsing"), { kind: "input" });
    assert.deepEqual(decideStripFocusTarget(options, undefined, "browsing"), { kind: "input" });
    assert.deepEqual(decideStripFocusTarget([], options[0].optionId, "browsing"), { kind: "input" });
  });
});

describe("isStripFilterTypingKey", () => {
  test("printable characters and Backspace type into the filter box", () => {
    for (const key of ["a", "Z", "7", "-", " "]) assert.equal(isStripFilterTypingKey(key), true);
    assert.equal(isStripFilterTypingKey("Backspace"), true);
  });

  test("navigation, commit, and modifier keys do not type", () => {
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Tab", "Escape", "Shift", "Home"]) {
      assert.equal(isStripFilterTypingKey(key), false);
    }
  });
});

describe("decideStripEscape", () => {
  test("clears typed text first and dismisses once the text is empty", () => {
    assert.equal(decideStripEscape("see"), "clear-filter");
    assert.equal(decideStripEscape(" "), "clear-filter");
    assert.equal(decideStripEscape(""), "dismiss");
  });
});

describe("BrainCandidateStrip combobox wiring", () => {
  const bestNext = toCandidateEntries([candidate(timeoutTileId), candidate(pageEnteredTileId)]);
  const offering = stripState({
    bestNext,
    sections: [section(bestNext), section(toCandidateEntries([candidate(switchPageTileId, true)]))],
  });

  test("the filter box is a combobox controlling a rendered candidate container", () => {
    const markup = render(offering);
    const comboboxes = tagsWithRole(markup, "combobox");
    assert.equal(comboboxes.length, 1);
    assert.equal(attributeOf(comboboxes[0], "aria-expanded"), "true");
    const controls = attributeOf(comboboxes[0], "aria-controls");
    assert.ok(controls);
    assert.ok(idsIn(markup).includes(controls));
  });

  test("an offering with no chip reports the popup collapsed", () => {
    const markup = render(stripState({}));
    assert.equal(attributeOf(tagsWithRole(markup, "combobox")[0], "aria-expanded"), "false");
  });

  test("no chip is highlighted before an arrow key moves the highlight", () => {
    const markup = render(offering);
    assert.equal(attributeOf(tagsWithRole(markup, "combobox")[0], "aria-activedescendant"), undefined);
  });

  test("the id an arrow key would highlight is the id of a rendered option", () => {
    const markup = render(offering);
    const rendered = visibleStripOptions(kStripId, [{ key: kBestNextBandKey, entries: bestNext }]);
    const first = moveActiveStripOption(rendered, undefined, 1);
    assert.ok(first);
    const optionIds = tagsWithRole(markup, "option").map((tag) => attributeOf(tag, "id"));
    assert.ok(optionIds.includes(first));
  });

  test("every chip is an option carrying a unique id and a selection state", () => {
    const markup = render(offering);
    const options = tagsWithRole(markup, "option");
    assert.equal(options.length, bestNext.length);
    const optionIds = options.map((tag) => attributeOf(tag, "id"));
    assert.equal(new Set(optionIds).size, optionIds.length);
    for (const tag of options) {
      assert.equal(attributeOf(tag, "aria-selected"), "false");
      assert.equal(attributeOf(tag, "tabindex"), "-1");
    }
  });

  test("chips sit inside a listbox", () => {
    const markup = render(offering);
    assert.ok(tagsWithRole(markup, "listbox").length >= 1);
  });

  test("the strip carries one polite live region", () => {
    const markup = render(offering);
    assert.equal(attributeValues(markup, "aria-live").length, 1);
    assert.deepEqual(attributeValues(markup, "aria-live"), ["polite"]);
    assert.match(markup, /<output\s/);
  });

  test("every id the markup references resolves to an element the markup renders", () => {
    const markup = render(offering);
    const ids = new Set(idsIn(markup));
    for (const attribute of ["aria-controls", "aria-describedby", "aria-labelledby"]) {
      for (const value of attributeValues(markup, attribute)) {
        for (const reference of idReferences(value)) {
          assert.ok(ids.has(reference), `${attribute} points at a missing id: ${reference}`);
        }
      }
    }
  });

  test("the filter box carries a description of how to browse the offering", () => {
    const markup = render(offering);
    const described = idReferences(attributeOf(tagsWithRole(markup, "combobox")[0], "aria-describedby"));
    assert.equal(described.length, 1);
    assert.ok(idsIn(markup).includes(described[0]));
  });

  test("each accordion header reports its expanded state and controls its own panel", () => {
    const markup = render(offering);
    const headers = [...markup.matchAll(/<button\s[^>]*aria-expanded="[^"]*"[^>]*>/g)].map((match) => match[0]);
    assert.equal(headers.length, offering.sections.length);
    for (const [index, header] of headers.entries()) {
      assert.equal(attributeOf(header, "aria-expanded"), "false");
      assert.equal(attributeOf(header, "aria-controls"), stripBandPanelId(kStripId, offering.sections[index].key));
    }
  });

  test("opening a section adds its chips as options with ids distinct from the best-next row", () => {
    const filtered = stripState({
      filter: "t",
      bestNext,
      sections: [section(bestNext)],
    });
    const markup = render(filtered);
    const optionIds = tagsWithRole(markup, "option").map((tag) => attributeOf(tag, "id"));
    assert.equal(optionIds.length, bestNext.length * 2);
    assert.equal(new Set(optionIds).size, optionIds.length);
    assert.ok(optionIds.includes(stripOptionId(kStripId, kBestNextBandKey, timeoutTileId)));
    assert.ok(optionIds.includes(stripOptionId(kStripId, bestNext[0].candidate.group, timeoutTileId)));
    assert.equal(attributeOf(tagsWithRole(markup, "combobox")[0], "aria-expanded"), "true");
  });

  test("unknown filter text marks the box invalid and adds the rendered explanation to its description", () => {
    const markup = render(stripState({ filter: "zzz", isUnknown: true }));
    const combobox = tagsWithRole(markup, "combobox")[0];
    assert.equal(attributeOf(combobox, "aria-invalid"), "true");
    const described = idReferences(attributeOf(combobox, "aria-describedby"));
    const ids = idsIn(markup);
    assert.equal(described.length, 2);
    for (const reference of described) assert.ok(ids.includes(reference));
  });

  test("a matched filter leaves the box valid and describes it by the browsing hint alone", () => {
    const markup = render(stripState({ filter: "t", bestNext }));
    const combobox = tagsWithRole(markup, "combobox")[0];
    assert.equal(attributeOf(combobox, "aria-invalid"), "false");
    const described = idReferences(attributeOf(combobox, "aria-describedby"));
    assert.equal(described.length, 1);
    assert.ok(idsIn(markup).includes(described[0]));
  });

  test("a minted variable chip is an option like any other, drawn in the minting presentation", () => {
    const mints = mintVariableCandidates([candidate(numberVarFactoryId)], "speedy", () => "speedy");
    assert.ok(mints.length > 0);
    const entries = toCandidateEntries(mints);
    const markup = render(stripState({ filter: "speedy", isUnknown: true, bestNext: entries }));

    const options = tagsWithRole(markup, "option");
    assert.equal(options.length, entries.length);
    assert.equal(attributeOf(options[0], "id"), stripOptionId(kStripId, kBestNextBandKey, mints[0].key));
    assert.equal(attributeOf(options[0], "aria-selected"), "false");
    assert.equal(attributeOf(options[0], "data-presentation"), "minting");
    assert.ok(attributeOf(options[0], "aria-label"), "the mint chip is announced like a candidate");
    assert.ok(tagsWithRole(markup, "listbox").length >= 1);
  });

  test("a via-conversion chip renders as an option of its own group's section", () => {
    const conversionEntries = toCandidateEntries([candidate(numberLiteralFactoryId, true)]);
    const built = section(conversionEntries);
    const markup = render(stripState({ filter: "n", bestNext: [], sections: [built] }));
    const panel = elementById(markup, stripBandPanelId(kStripId, built.key));
    assert.deepEqual(
      tagsWithRole(panel, "option").map((tag) => attributeOf(tag, "id")),
      [stripOptionId(kStripId, built.key, conversionEntries[0].candidate.key)]
    );
  });
});

describe("BrainCandidateStrip provenance subcategories", () => {
  /** The offering of one open section holding `entries`, opened by filter text. */
  function openSection(entries: readonly CandidateEntry[]): {
    markup: string;
    section: CandidateStripSection;
    panel: string;
  } {
    const built = section(entries);
    const markup = render(stripState({ filter: "t", bestNext: [], sections: [built] }));
    return { markup, section: built, panel: elementById(markup, stripBandPanelId(kStripId, built.key)) };
  }

  const mixedEntries = () =>
    toCandidateEntries([
      candidate(probeTileIds.application),
      candidate(probeTileIds.library),
      candidate(probeTileIds.libraryAlt),
      candidate(timeoutTileId),
    ]);

  test("a mixed section renders one group per subcategory inside its single listbox", () => {
    const { markup, section, panel } = openSection(mixedEntries());

    assert.equal(tagsWithRole(markup, "listbox").length, 1);
    assert.ok(section.subcategories.length > 1);
    assert.equal(tagsWithRole(panel, "group").length, section.subcategories.length);
  });

  test("every group is named by a heading the markup renders", () => {
    const { markup, panel } = openSection(mixedEntries());
    const ids = idsIn(markup);

    const groups = tagsWithRole(panel, "group");
    assert.ok(groups.length > 0);
    for (const group of groups) {
      const labelledBy = attributeOf(group, "aria-labelledby");
      assert.ok(labelledBy);
      assert.equal(idReferences(labelledBy).length, 1);
      assert.ok(ids.includes(labelledBy));
    }
  });

  test("the section's chips stay options of its one listbox, in the arranged order", () => {
    const { section, panel } = openSection(mixedEntries());

    assert.deepEqual(
      tagsWithRole(panel, "option").map((tag) => attributeOf(tag, "id")),
      section.entries.map((entry) => stripOptionId(kStripId, section.key, entry.candidate.key))
    );
  });

  test("a section of one provenance renders its chips without a group", () => {
    const { section, panel } = openSection(
      toCandidateEntries([candidate(timeoutTileId), candidate(pageEnteredTileId)])
    );

    assert.equal(section.subcategories.length, 1);
    assert.equal(tagsWithRole(panel, "group").length, 0);
    assert.equal(tagsWithRole(panel, "option").length, 2);
  });

  test("a conversion chip is marked structurally and sits in the same listbox as the direct chips", () => {
    const { panel } = openSection(toCandidateEntries([candidate(timeoutTileId), candidate(pageEnteredTileId, true)]));

    const options = tagsWithRole(panel, "option");
    assert.equal(options.length, 2);
    assert.equal(attributeOf(options[0], "data-via-conversion"), undefined);
    assert.equal(attributeOf(options[1], "data-via-conversion"), "true");
  });

  test("a library chip carries its attribution in the accessible name, not in its rendered text", () => {
    const entries = toCandidateEntries([candidate(probeTileIds.library)]);
    const markup = render(stripState({ bestNext: entries, sections: [] }));
    const chip = elementById(markup, stripOptionId(kStripId, kBestNextBandKey, entries[0].candidate.key));

    assert.ok(attributeOf(chip, "aria-label")?.includes(kLibrary.name));
    assert.equal(renderedText(chip).includes(kLibrary.name), false);
  });
});

describe("BrainCandidateStrip band listboxes", () => {
  const bestNext = toCandidateEntries([candidate(timeoutTileId), candidate(pageEnteredTileId)]);

  /** An offering rendering two bands at once: the best-next row and one open section. */
  const twoBands = stripState({ filter: "t", bestNext, sections: [section(bestNext)] });

  test("every band listbox is focusable without becoming a tab stop", () => {
    const listboxes = tagsWithRole(render(twoBands), "listbox");
    assert.equal(listboxes.length, 2);
    for (const listbox of listboxes) assert.equal(attributeOf(listbox, "tabindex"), "-1");
  });

  test("every band listbox carries a distinct id the highlight can address it by", () => {
    const markup = render(twoBands);
    const listboxIds = tagsWithRole(markup, "listbox").map((tag) => attributeOf(tag, "id"));
    assert.equal(listboxIds.length, 2);
    for (const listboxId of listboxIds) {
      assert.ok(listboxId);
      assert.ok(idsIn(markup).includes(listboxId));
    }
    assert.equal(new Set(listboxIds).size, listboxIds.length);
  });

  test("every band listbox carries an accessible name", () => {
    for (const listbox of tagsWithRole(render(twoBands), "listbox")) {
      const name = attributeOf(listbox, "aria-label") ?? attributeOf(listbox, "aria-labelledby");
      assert.ok(name !== undefined && name.length > 0);
    }
  });

  test("no band listbox holds the highlight before an arrow key moves it", () => {
    for (const listbox of tagsWithRole(render(twoBands), "listbox")) {
      assert.equal(attributeOf(listbox, "aria-activedescendant"), undefined);
    }
  });
});
