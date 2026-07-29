import { kTileLabelContext } from "../../localization/catalog";
import type { Localizer } from "../../localization/localizer";
import type { LocalizedValue } from "../../localization/template";
import { List, type ReadonlyList } from "../../platform/list";
import { MathOps } from "../../platform/math";
import { StringUtils as SU } from "../../platform/string";
import { TypeUtils } from "../../platform/types";
import {
  type IBrainRuleDef,
  type IBrainTileDef,
  type ITileLanguageMetadata,
  isInlineTileDef,
  LiteralDisplayFormats,
  RuleSide,
  type TileSentenceFrame,
} from "../interfaces";
import type { BrainTileAccessorDef } from "../tiles/accessors";
import { getCatalogFallbackLabel } from "../tiles/catalog";
import { applyDisplayFormat } from "../tiles/display-format";
import type { BrainTileLiteralDef } from "../tiles/literals";
import type { BrainTileOutputDef } from "../tiles/outputs";
import type { BrainTileVariableDef } from "../tiles/variables";

// ---------------------------------------------------------------------------
// Segment contract
// ---------------------------------------------------------------------------

/** A word of a projected sentence, rendering the tile at `sourceTileIndex`. */
export interface SentenceWordSegment {
  readonly kind: "word";
  readonly text: string;
  /** Index into {@link flattenRuleTiles} of the tile this word renders. */
  readonly sourceTileIndex: number;
}

/** Connective text a sentence template supplies, owned by no tile. */
export interface SentenceGlueSegment {
  readonly kind: "glue";
  readonly text: string;
}

/** One piece of a projected sentence: a tile's word, or template glue. */
export type SentenceSegment = SentenceWordSegment | SentenceGlueSegment;

/** A tile of a rule, with the side and per-side index it sits at. */
export interface SentenceTileRef {
  readonly side: RuleSide;
  /** Index of the tile within its own side's tile list. */
  readonly tileIndex: number;
  readonly tileDef: IBrainTileDef;
}

/**
 * Every tile of `rule` in sentence order: the WHEN side's tiles followed by the
 * DO side's. A word segment's `sourceTileIndex` indexes this list.
 */
export function flattenRuleTiles(rule: IBrainRuleDef): ReadonlyList<SentenceTileRef> {
  const refs = new List<SentenceTileRef>();
  const whenTiles = rule.when().tiles();
  for (let i = 0; i < whenTiles.size(); i++) {
    refs.push({ side: RuleSide.When, tileIndex: i, tileDef: whenTiles.get(i) });
  }
  const doTiles = rule.do().tiles();
  for (let i = 0; i < doTiles.size(); i++) {
    refs.push({ side: RuleSide.Do, tileIndex: i, tileDef: doTiles.get(i) });
  }
  return refs.asReadonly();
}

/** The display string of `segments`: their text, in order. */
export function sentenceText(segments: ReadonlyList<SentenceSegment>): string {
  let text = "";
  for (let i = 0; i < segments.size(); i++) {
    text += segments.get(i).text;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Catalog entries
// ---------------------------------------------------------------------------

/** Context tag of the WHEN-side sentence templates and the always-word. */
const kWhenContext = "sentence-when";

/** Context tag of the per-frame default bare word. */
const kBareContext = "sentence-bare";

/** Context tag of the connective text between words and between clauses. */
const kGlueContext = "sentence-glue";

const kVerbTemplate = "When I {form} {object}";
const kStateTemplate = "When I am {form} {object}";
const kEventTemplate = "When {form} {object}";
const kSubjectlessTemplate = "When {condition}";
const kAlwaysWord = "Always";
const kBareDefaultTemplate = "{frame, select, verb {anything} other {}}";
const kWordGlueTemplate = "{a} {b}";
const kClauseTemplate = "{trigger}, {action}";
const kTerminalTemplate = "{sentence}.";

// ---------------------------------------------------------------------------
// Template rendering with tile spans preserved
// ---------------------------------------------------------------------------

// A slot's placeholder is filled with a marker the template engine passes
// through untouched, so the rendered text splits back into glue runs and the
// segments each slot contributed.
const kSlotOpen = SU.fromCharCode(2);
const kSlotClose = SU.fromCharCode(3);

/** A template placeholder and the segments filling it. */
interface SentenceSlot {
  readonly name: string;
  readonly phrase: ReadonlyList<SentenceSegment>;
}

function glueSegment(text: string): SentenceGlueSegment {
  return { kind: "glue", text };
}

function wordSegment(text: string, sourceTileIndex: number): SentenceWordSegment {
  return { kind: "word", text, sourceTileIndex };
}

function slot(name: string, phrase: ReadonlyList<SentenceSegment>): SentenceSlot {
  return { name, phrase };
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** Collapse each run of whitespace in `text` to a single space. */
function collapseSpaces(text: string): string {
  let out = "";
  let pendingSpace = false;
  const length = SU.length(text);
  for (let i = 0; i < length; i++) {
    const ch = SU.charAt(text, i);
    if (isWhitespace(ch)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      out += " ";
      pendingSpace = false;
    }
    out += ch;
  }
  return pendingSpace ? `${out} ` : out;
}

function trimStart(text: string): string {
  let start = 0;
  const length = SU.length(text);
  while (start < length && isWhitespace(SU.charAt(text, start))) {
    start += 1;
  }
  return SU.substring(text, start);
}

function trimEnd(text: string): string {
  let stop = SU.length(text);
  while (stop > 0 && isWhitespace(SU.charAt(text, stop - 1))) {
    stop -= 1;
  }
  return SU.substring(text, 0, stop);
}

/**
 * Merge adjacent glue, drop empty text, collapse whitespace runs, and trim the
 * sentence's outer edges, so a slot that renders nothing leaves no doubled or
 * dangling space.
 */
function normalizeSegments(segments: ReadonlyList<SentenceSegment>): List<SentenceSegment> {
  const merged = new List<SentenceSegment>();
  for (let i = 0; i < segments.size(); i++) {
    const segment = segments.get(i);
    if (segment.text === "") {
      continue;
    }
    const last = merged.size() > 0 ? merged.get(merged.size() - 1) : undefined;
    if (segment.kind === "glue" && last !== undefined && last.kind === "glue") {
      merged.set(merged.size() - 1, glueSegment(last.text + segment.text));
      continue;
    }
    merged.push(segment);
  }

  const out = new List<SentenceSegment>();
  const count = merged.size();
  for (let i = 0; i < count; i++) {
    const segment = merged.get(i);
    if (segment.kind !== "glue") {
      out.push(segment);
      continue;
    }
    let text = collapseSpaces(segment.text);
    if (i === 0) {
      text = trimStart(text);
    }
    if (i === count - 1) {
      text = trimEnd(text);
    }
    if (text !== "") {
      out.push(glueSegment(text));
    }
  }
  return out;
}

/** Split `rendered` at its slot markers, splicing each slot's segments in. */
function spliceSlots(rendered: string, slots: ReadonlyList<SentenceSlot>): List<SentenceSegment> {
  const out = new List<SentenceSegment>();
  const length = SU.length(rendered);
  let text = "";
  let i = 0;
  while (i < length) {
    const ch = SU.charAt(rendered, i);
    const close = ch === kSlotOpen ? SU.indexOf(rendered, kSlotClose, i + 1) : -1;
    const ordinal = close < 0 ? -1 : MathOps.parseFloat(SU.substring(rendered, i + 1, close));
    if (close < 0 || MathOps.isNaN(ordinal) || ordinal < 0 || ordinal >= slots.size()) {
      text += ch;
      i += 1;
      continue;
    }
    if (text !== "") {
      out.push(glueSegment(text));
      text = "";
    }
    const phrase = slots.get(ordinal).phrase;
    for (let j = 0; j < phrase.size(); j++) {
      out.push(phrase.get(j));
    }
    i = close + 1;
  }
  if (text !== "") {
    out.push(glueSegment(text));
  }
  return out;
}

/**
 * Render `source` in the active locale with each slot's segments spliced into
 * its named placeholder. Text the template contributes becomes glue, and the
 * result is normalized so a slot the template left unfilled costs no space.
 */
function renderPhrase(
  localizer: Localizer,
  source: string,
  context: string,
  slots: ReadonlyList<SentenceSlot>
): List<SentenceSegment> {
  const params: Record<string, LocalizedValue> = {};
  for (let i = 0; i < slots.size(); i++) {
    params[slots.get(i).name] = `${kSlotOpen}${i}${kSlotClose}`;
  }
  return normalizeSegments(spliceSlots(localizer.tr(source, params, context), slots));
}

// ---------------------------------------------------------------------------
// Tile words
// ---------------------------------------------------------------------------

function tileLanguage(tileDef: IBrainTileDef): ITileLanguageMetadata | undefined {
  return tileDef.metadata?.language;
}

/** The sentence frame of `tileDef`, defaulting to the verb frame. */
function tileFrame(tileDef: IBrainTileDef): TileSentenceFrame {
  return tileLanguage(tileDef)?.frame ?? "verb";
}

/**
 * The word of a tile whose reading is user content -- a literal's value, a
 * variable's name, a page's name -- which never localizes.
 */
function userContentWord(tileDef: IBrainTileDef): string | undefined {
  if (tileDef.kind === "literal") {
    const literalDef = tileDef as BrainTileLiteralDef;
    const format = literalDef.displayFormat;
    if (format !== LiteralDisplayFormats.Default && TypeUtils.isNumber(literalDef.value)) {
      return applyDisplayFormat(literalDef.value, format);
    }
    return literalDef.valueLabel || SU.toString(literalDef.value);
  }
  if (tileDef.kind === "variable") {
    return (tileDef as BrainTileVariableDef).varName;
  }
  if (tileDef.kind === "page") {
    return tileDef.metadata?.label;
  }
  return undefined;
}

/** The vocabulary term naming `tileDef` when it carries no form and no label. */
function vocabularyName(tileDef: IBrainTileDef): string {
  if (tileDef.kind === "accessor") {
    return (tileDef as BrainTileAccessorDef).fieldName;
  }
  if (tileDef.kind === "output") {
    return (tileDef as BrainTileOutputDef).outputName;
  }
  return getCatalogFallbackLabel(tileDef);
}

/**
 * The word `tileDef` reads as in the locale `localizer` renders, resolved in
 * this order: the tile's authored `metadata.language.form`, else its user
 * content (a literal's value, a variable's name, a page's name), else its
 * `metadata.label`, else the vocabulary term naming it (an accessor's field
 * name, an output's name, or the trailing segment of its tile id).
 *
 * Vocabulary localizes through the tile-label context; user content is the
 * author's own text and never localizes. {@link projectRuleSentence} reads
 * every tile through this function: call it wherever a surface has to label a
 * tile with the word its sentence uses.
 */
export function tileSentenceWord(tileDef: IBrainTileDef, localizer: Localizer): string {
  const form = tileLanguage(tileDef)?.form;
  if (form !== undefined && form !== "") {
    return localizer.tr(form, undefined, kTileLabelContext);
  }
  const ownWord = userContentWord(tileDef);
  if (ownWord !== undefined) {
    return ownWord;
  }
  const label = tileDef.metadata?.label;
  if (label !== undefined && label !== "") {
    return localizer.tr(label, undefined, kTileLabelContext);
  }
  return localizer.tr(vocabularyName(tileDef), undefined, kTileLabelContext);
}

/** The word completing a sensor placed with no object argument. */
function bareWord(localizer: Localizer, tileDef: IBrainTileDef): string {
  const bare = tileLanguage(tileDef)?.bare;
  if (bare !== undefined && bare !== "") {
    return localizer.tr(bare, undefined, kTileLabelContext);
  }
  return localizer.tr(kBareDefaultTemplate, { frame: tileFrame(tileDef) }, kBareContext);
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

function wordPhrase(localizer: Localizer, tileDef: IBrainTileDef, sourceTileIndex: number): List<SentenceSegment> {
  const phrase = new List<SentenceSegment>();
  phrase.push(wordSegment(tileSentenceWord(tileDef, localizer), sourceTileIndex));
  return phrase;
}

/** The head tile's bare completion, empty when its frame supplies no word. */
function barePhrase(localizer: Localizer, head: IBrainTileDef, sourceTileIndex: number): List<SentenceSegment> {
  const phrase = new List<SentenceSegment>();
  const bare = bareWord(localizer, head);
  if (bare !== "") {
    phrase.push(wordSegment(bare, sourceTileIndex));
  }
  return phrase;
}

/** Join the words of `tiles` from index `from` with the locale's word glue. */
function joinWords(
  localizer: Localizer,
  tiles: ReadonlyList<IBrainTileDef>,
  from: number,
  indexOffset: number
): List<SentenceSegment> {
  let phrase = wordPhrase(localizer, tiles.get(from), indexOffset + from);
  for (let i = from + 1; i < tiles.size(); i++) {
    const slots = new List<SentenceSlot>();
    slots.push(slot("a", phrase));
    slots.push(slot("b", wordPhrase(localizer, tiles.get(i), indexOffset + i)));
    phrase = renderPhrase(localizer, kWordGlueTemplate, kGlueContext, slots);
  }
  return phrase;
}

function frameTemplate(frame: TileSentenceFrame): string {
  if (frame === "state") {
    return kStateTemplate;
  }
  if (frame === "event") {
    return kEventTemplate;
  }
  return kVerbTemplate;
}

/**
 * Whether the WHEN side of `tiles` reads as a bare condition: true for a side
 * headed by any tile other than a sensor, and for a side whose head is an inline
 * sensor that more tiles follow. An inline sensor alone reads through its frame.
 */
function isSubjectlessWhenSide(tiles: ReadonlyList<IBrainTileDef>): boolean {
  const head = tiles.get(0);
  if (head.kind !== "sensor") {
    return true;
  }
  return isInlineTileDef(head) && tiles.size() > 1;
}

/**
 * Render the WHEN side through its head tile's frame template when a sensor
 * heads it, and through the subjectless template otherwise: a side headed by an
 * operator, value, parameter, literal, or variable reads as a bare condition, as
 * does an inline sensor continued by an expression, with every tile of the side
 * rendering as an expression into the one slot.
 */
function projectWhenClause(localizer: Localizer, tiles: ReadonlyList<IBrainTileDef>): List<SentenceSegment> {
  const head = tiles.get(0);
  const slots = new List<SentenceSlot>();
  if (isSubjectlessWhenSide(tiles)) {
    slots.push(slot("condition", joinWords(localizer, tiles, 0, 0)));
    return renderPhrase(localizer, kSubjectlessTemplate, kWhenContext, slots);
  }
  slots.push(slot("form", wordPhrase(localizer, head, 0)));
  slots.push(slot("object", tiles.size() > 1 ? joinWords(localizer, tiles, 1, 0) : barePhrase(localizer, head, 0)));
  return renderPhrase(localizer, frameTemplate(tileFrame(head)), kWhenContext, slots);
}

/**
 * Project `rule` as a sentence in `localizer`'s locale.
 *
 * The result is the sentence's segments in order: each word carries the index
 * of the tile it renders (see {@link flattenRuleTiles}), and template-supplied
 * connective text is glue. The display string is {@link sentenceText} of the
 * result. A rule with no tiles projects no segments.
 *
 * The projection is derived state: the same rule under the same catalogs always
 * yields the same segments. Live callers reach a localizer through
 * `brainDef.servicesLocalizer()`.
 */
export function projectRuleSentence(rule: IBrainRuleDef, localizer: Localizer): ReadonlyList<SentenceSegment> {
  const whenTiles = rule.when().tiles();
  const doTiles = rule.do().tiles();
  if (whenTiles.isEmpty() && doTiles.isEmpty()) {
    return new List<SentenceSegment>().asReadonly();
  }

  let trigger: ReadonlyList<SentenceSegment>;
  if (whenTiles.isEmpty()) {
    const always = new List<SentenceSegment>();
    always.push(glueSegment(localizer.tr(kAlwaysWord, undefined, kWhenContext)));
    trigger = always;
  } else {
    trigger = projectWhenClause(localizer, whenTiles);
  }

  let body = trigger;
  if (!doTiles.isEmpty()) {
    const clauseSlots = new List<SentenceSlot>();
    clauseSlots.push(slot("trigger", trigger));
    clauseSlots.push(slot("action", joinWords(localizer, doTiles, 0, whenTiles.size())));
    body = renderPhrase(localizer, kClauseTemplate, kGlueContext, clauseSlots);
  }

  const terminalSlots = new List<SentenceSlot>();
  terminalSlots.push(slot("sentence", body));
  return renderPhrase(localizer, kTerminalTemplate, kGlueContext, terminalSlots).asReadonly();
}
