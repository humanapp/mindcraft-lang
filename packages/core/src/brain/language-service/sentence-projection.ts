import { kTileLabelContext } from "../../localization/catalog";
import type { Localizer } from "../../localization/localizer";
import type { LocalizedValue } from "../../localization/template";
import { List, type ReadonlyList } from "../../platform/list";
import { MathOps } from "../../platform/math";
import { StringUtils as SU } from "../../platform/string";
import { TypeUtils } from "../../platform/types";
import { CoreOpId, CoreTypeIds } from "../../runtime";
import {
  type IBrainPageDef,
  type IBrainRuleDef,
  type IBrainTileDef,
  type ITileLanguageMetadata,
  isActionTileDef,
  isInlineTileDef,
  LiteralDisplayFormats,
  mkOperatorTileId,
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

/**
 * One rule's clause inside a projected paragraph: the rule's own segments, with
 * every word's `sourceTileIndex` indexing {@link flattenRuleTiles} of the rule
 * `ruleId` names.
 */
export interface ParagraphRuleEntry {
  readonly kind: "rule";
  /** `id()` of the rule whose clause this entry carries. */
  readonly ruleId: number;
  readonly segments: ReadonlyList<SentenceSegment>;
}

/**
 * Connective text between two rules' clauses -- a child connective, a
 * sentence-final period, or the space between sentences -- owned by no rule.
 */
export interface ParagraphGlueEntry {
  readonly kind: "glue";
  readonly text: string;
}

/** One piece of a projected paragraph: a rule's clause, or connective glue. */
export type ParagraphEntry = ParagraphRuleEntry | ParagraphGlueEntry;

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

/** The display string of `entries`: each rule clause's text and each glue, in order. */
export function paragraphText(entries: ReadonlyList<ParagraphEntry>): string {
  let text = "";
  for (let i = 0; i < entries.size(); i++) {
    const entry = entries.get(i);
    text += entry.kind === "rule" ? sentenceText(entry.segments) : entry.text;
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

/** Context tag of the punctuation a value's own reading carries. */
const kValueContext = "sentence-value";

/**
 * Context tag of the vocabulary that relates one rule to another: the child
 * connectives, a child's subordinate clause forms, and the glue between the
 * sentences of a paragraph.
 */
const kConnectiveContext = "sentence-connective";

const kVerbTemplate = "When I {form} {object}";
const kStateTemplate = "When I am {form} {object}";
const kEventTemplate = "When {form} {object}";
const kSubjectlessTemplate = "When {condition}";
const kNegatedVerbTemplate = "When I do {negation} {form} {object}";
const kNegatedStateTemplate = "When I am {negation} {form} {object}";
const kNegatedEventTemplate = "When {negation} {form} {object}";
const kAlwaysWord = "Always";
const kBareDefaultTemplate = "{frame, select, verb {anything} other {}}";
const kTextValueTemplate = '"{value}"';
const kWordGlueTemplate = "{a} {b}";
const kClauseTemplate = "{trigger}, {action}";
const kTerminalTemplate = "{sentence}.";

const kChildConditionTemplate = "{parent}, and if {condition}";
const kChildConsequenceTemplate = "{parent}, and {consequence}";
const kChildClauseTemplate = "{condition}, {action}";
const kSentenceGlueTemplate = "{sentence} {rest}";
const kChildVerbTemplate = "I {form} {object}";
const kChildStateTemplate = "I am {form} {object}";
const kChildEventTemplate = "{form} {object}";
const kChildSubjectlessTemplate = "{condition}";
const kChildNegatedVerbTemplate = "I do {negation} {form} {object}";
const kChildNegatedStateTemplate = "I am {negation} {form} {object}";
const kChildNegatedEventTemplate = "{negation} {form} {object}";

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

/**
 * Walk `rendered`, reporting each run of template text to `onText` and each
 * slot marker whose ordinal is below `slotCount` to `onSlot`, in order. Text
 * that is not a well-formed marker of a known slot is reported as text.
 */
function walkSlotMarkers(
  rendered: string,
  slotCount: number,
  onText: (text: string) => void,
  onSlot: (ordinal: number) => void
): void {
  const length = SU.length(rendered);
  let text = "";
  let i = 0;
  while (i < length) {
    const ch = SU.charAt(rendered, i);
    const close = ch === kSlotOpen ? SU.indexOf(rendered, kSlotClose, i + 1) : -1;
    const ordinal = close < 0 ? -1 : MathOps.parseFloat(SU.substring(rendered, i + 1, close));
    if (close < 0 || MathOps.isNaN(ordinal) || ordinal < 0 || ordinal >= slotCount) {
      text += ch;
      i += 1;
      continue;
    }
    if (text !== "") {
      onText(text);
      text = "";
    }
    onSlot(ordinal);
    i = close + 1;
  }
  if (text !== "") {
    onText(text);
  }
}

/** Split `rendered` at its slot markers, splicing each slot's segments in. */
function spliceSlots(rendered: string, slots: ReadonlyList<SentenceSlot>): List<SentenceSegment> {
  const out = new List<SentenceSegment>();
  walkSlotMarkers(
    rendered,
    slots.size(),
    (text) => {
      out.push(glueSegment(text));
    },
    (ordinal) => {
      const phrase = slots.get(ordinal).phrase;
      for (let j = 0; j < phrase.size(); j++) {
        out.push(phrase.get(j));
      }
    }
  );
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
 * author's own text and never localizes. The word is the tile's raw reading: a
 * text literal resolves to its bare value, carrying no quotation marks. Call it
 * wherever a surface has to label a tile with the word its sentence uses.
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

/** Whether `tileDef`'s call spec declares at least one argument slot a tile can fill. */
function declaresArgument(tileDef: IBrainTileDef): boolean {
  return isActionTileDef(tileDef) && tileDef.action.callDef.argSlots.size() > 0;
}

/**
 * The word completing a sensor placed with no object argument: the tile's own
 * authored `bare`, else the frame's default word, which a sensor takes only
 * when its call spec declares an argument that could have filled the object
 * position. A sensor that declares none reads with no completion at all.
 */
function bareWord(localizer: Localizer, tileDef: IBrainTileDef): string {
  const bare = tileLanguage(tileDef)?.bare;
  if (bare !== undefined && bare !== "") {
    return localizer.tr(bare, undefined, kTileLabelContext);
  }
  if (!declaresArgument(tileDef)) {
    return "";
  }
  return localizer.tr(kBareDefaultTemplate, { frame: tileFrame(tileDef) }, kBareContext);
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** Whether `tileDef` is a literal holding a text value. */
function isTextLiteral(tileDef: IBrainTileDef): boolean {
  return tileDef.kind === "literal" && (tileDef as BrainTileLiteralDef).valueType === CoreTypeIds.String;
}

/**
 * The text of the word segment `tileDef` contributes to a sentence: a text
 * literal's value inside the locale's quotation marks, so the value's own
 * punctuation cannot read as sentence structure and an empty value still reads
 * as a pair of marks, and every other tile's {@link tileSentenceWord} unchanged.
 */
function sentenceWordText(localizer: Localizer, tileDef: IBrainTileDef): string {
  const word = tileSentenceWord(tileDef, localizer);
  if (!isTextLiteral(tileDef)) {
    return word;
  }
  return localizer.tr(kTextValueTemplate, { value: word }, kValueContext);
}

function wordPhrase(localizer: Localizer, tileDef: IBrainTileDef, sourceTileIndex: number): List<SentenceSegment> {
  const phrase = new List<SentenceSegment>();
  phrase.push(wordSegment(sentenceWordText(localizer, tileDef), sourceTileIndex));
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

/** The template of `frame` carrying a negation word inside the clause. */
function negatedFrameTemplate(frame: TileSentenceFrame): string {
  if (frame === "state") {
    return kNegatedStateTemplate;
  }
  if (frame === "event") {
    return kNegatedEventTemplate;
  }
  return kNegatedVerbTemplate;
}

/**
 * Whether the WHEN side of `tiles` reads as a bare condition: true for a side
 * headed by any tile other than a sensor, and for a side headed by an inline
 * sensor, whose value heads a condition.
 */
function isSubjectlessWhenSide(tiles: ReadonlyList<IBrainTileDef>): boolean {
  const head = tiles.get(0);
  return head.kind !== "sensor" || isInlineTileDef(head);
}

/** Whether `tileDef` opens an expression of its own beside the tiles around it. */
function startsOwnExpression(tileDef: IBrainTileDef): boolean {
  return tileDef.kind === "operator" || tileDef.kind === "controlFlow";
}

/**
 * The sensor a NOT-headed `tiles` negates, or undefined when the negation covers
 * no whole sensor call: an expression operand, or a sensor that a further
 * operator or grouping extends.
 */
function negatedSensor(tiles: ReadonlyList<IBrainTileDef>): IBrainTileDef | undefined {
  if (tiles.size() < 2 || tiles.get(0).tileId !== mkOperatorTileId(CoreOpId.Not)) {
    return undefined;
  }
  const operand = tiles.get(1);
  if (operand.kind !== "sensor") {
    return undefined;
  }
  for (let i = 2; i < tiles.size(); i++) {
    if (startsOwnExpression(tiles.get(i))) {
      return undefined;
    }
  }
  return operand;
}

/**
 * Fill the negated frame's slots for the side `tiles`, whose head negates the
 * sensor `sensed`: the head's own word as the negation, the sensor's word as the
 * form, and the tiles after the sensor as its object, completed by the sensor's
 * bare word when none follow.
 */
function negatedFrameSlots(
  localizer: Localizer,
  tiles: ReadonlyList<IBrainTileDef>,
  sensed: IBrainTileDef
): List<SentenceSlot> {
  const slots = new List<SentenceSlot>();
  slots.push(slot("negation", wordPhrase(localizer, tiles.get(0), 0)));
  slots.push(slot("form", wordPhrase(localizer, sensed, 1)));
  slots.push(slot("object", tiles.size() > 2 ? joinWords(localizer, tiles, 2, 0) : barePhrase(localizer, sensed, 1)));
  return slots;
}

/**
 * Render the WHEN side through the negated variant of a sensor's frame when the
 * side negates that sensor, through its head tile's frame template when a sensor
 * heads it, and through the subjectless template otherwise: a side headed by an
 * operator, value, parameter, literal, or variable reads as a bare condition, as
 * does an inline sensor, with every tile of the side rendering as an expression
 * into the one slot.
 */
function projectWhenClause(localizer: Localizer, tiles: ReadonlyList<IBrainTileDef>): List<SentenceSegment> {
  const head = tiles.get(0);
  const slots = new List<SentenceSlot>();
  const sensed = negatedSensor(tiles);
  if (sensed !== undefined) {
    return renderPhrase(
      localizer,
      negatedFrameTemplate(tileFrame(sensed)),
      kWhenContext,
      negatedFrameSlots(localizer, tiles, sensed)
    );
  }
  if (isSubjectlessWhenSide(tiles)) {
    slots.push(slot("condition", joinWords(localizer, tiles, 0, 0)));
    return renderPhrase(localizer, kSubjectlessTemplate, kWhenContext, slots);
  }
  slots.push(slot("form", wordPhrase(localizer, head, 0)));
  slots.push(slot("object", tiles.size() > 1 ? joinWords(localizer, tiles, 1, 0) : barePhrase(localizer, head, 0)));
  return renderPhrase(localizer, frameTemplate(tileFrame(head)), kWhenContext, slots);
}

/**
 * The word a rule with no condition reads as in the locale `localizer` renders:
 * the trigger {@link projectRuleSentence} gives a rule whose WHEN side holds no
 * tiles. Call it wherever a surface has to read a rule's trigger word.
 */
export function whenTriggerWord(localizer: Localizer): string {
  return localizer.tr(kAlwaysWord, undefined, kWhenContext);
}

/**
 * The clause of `rule` with no sentence-final punctuation: its trigger -- the
 * WHEN side's reading, or the always-word when that side is empty -- followed by
 * its action when its DO side has tiles.
 */
function projectRuleClause(localizer: Localizer, rule: IBrainRuleDef): List<SentenceSegment> {
  const whenTiles = rule.when().tiles();
  const doTiles = rule.do().tiles();

  let trigger: List<SentenceSegment>;
  if (whenTiles.isEmpty()) {
    trigger = new List<SentenceSegment>();
    trigger.push(glueSegment(whenTriggerWord(localizer)));
  } else {
    trigger = projectWhenClause(localizer, whenTiles);
  }
  if (doTiles.isEmpty()) {
    return trigger;
  }

  const clauseSlots = new List<SentenceSlot>();
  clauseSlots.push(slot("trigger", trigger));
  clauseSlots.push(slot("action", joinWords(localizer, doTiles, 0, whenTiles.size())));
  return renderPhrase(localizer, kClauseTemplate, kGlueContext, clauseSlots);
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
  if (rule.when().tiles().isEmpty() && rule.do().tiles().isEmpty()) {
    return new List<SentenceSegment>().asReadonly();
  }
  const terminalSlots = new List<SentenceSlot>();
  terminalSlots.push(slot("sentence", projectRuleClause(localizer, rule)));
  return renderPhrase(localizer, kTerminalTemplate, kGlueContext, terminalSlots).asReadonly();
}

// ---------------------------------------------------------------------------
// Paragraph projection
// ---------------------------------------------------------------------------

/** A paragraph template placeholder and the entries filling it. */
interface ParagraphSlot {
  readonly name: string;
  readonly entries: ReadonlyList<ParagraphEntry>;
}

function glueEntry(text: string): ParagraphGlueEntry {
  return { kind: "glue", text };
}

function ruleEntry(ruleId: number, segments: ReadonlyList<SentenceSegment>): ParagraphRuleEntry {
  return { kind: "rule", ruleId, segments };
}

function paragraphSlot(name: string, entries: ReadonlyList<ParagraphEntry>): ParagraphSlot {
  return { name, entries };
}

/** Merge adjacent glue entries, drop empty ones, and collapse whitespace runs. */
function mergeGlueEntries(entries: ReadonlyList<ParagraphEntry>): List<ParagraphEntry> {
  const out = new List<ParagraphEntry>();
  for (let i = 0; i < entries.size(); i++) {
    const entry = entries.get(i);
    if (entry.kind === "rule") {
      out.push(entry);
      continue;
    }
    const text = collapseSpaces(entry.text);
    if (text === "") {
      continue;
    }
    const last = out.size() > 0 ? out.get(out.size() - 1) : undefined;
    if (last !== undefined && last.kind === "glue") {
      out.set(out.size() - 1, glueEntry(collapseSpaces(last.text + text)));
      continue;
    }
    out.push(glueEntry(text));
  }
  return out;
}

/** Trim the leading and trailing glue of a finished paragraph. */
function trimParagraphEdges(entries: ReadonlyList<ParagraphEntry>): List<ParagraphEntry> {
  const out = new List<ParagraphEntry>();
  const count = entries.size();
  for (let i = 0; i < count; i++) {
    const entry = entries.get(i);
    if (entry.kind === "rule") {
      out.push(entry);
      continue;
    }
    let text = entry.text;
    if (i === 0) {
      text = trimStart(text);
    }
    if (i === count - 1) {
      text = trimEnd(text);
    }
    if (text !== "") {
      out.push(glueEntry(text));
    }
  }
  return out;
}

/**
 * Render `source` in the active locale with each slot's entries spliced into its
 * named placeholder. Text the template contributes becomes a glue entry, and
 * rule entries pass through untouched, so a rule keeps its identity and its
 * spans wherever a locale places it.
 */
function composeEntries(
  localizer: Localizer,
  source: string,
  context: string,
  slots: ReadonlyList<ParagraphSlot>
): List<ParagraphEntry> {
  const params: Record<string, LocalizedValue> = {};
  for (let i = 0; i < slots.size(); i++) {
    params[slots.get(i).name] = `${kSlotOpen}${i}${kSlotClose}`;
  }
  const out = new List<ParagraphEntry>();
  walkSlotMarkers(
    localizer.tr(source, params, context),
    slots.size(),
    (text) => {
      out.push(glueEntry(text));
    },
    (ordinal) => {
      const entries = slots.get(ordinal).entries;
      for (let j = 0; j < entries.size(); j++) {
        out.push(entries.get(j));
      }
    }
  );
  return mergeGlueEntries(out.asReadonly());
}

function childFrameTemplate(frame: TileSentenceFrame): string {
  if (frame === "state") {
    return kChildStateTemplate;
  }
  if (frame === "event") {
    return kChildEventTemplate;
  }
  return kChildVerbTemplate;
}

/** The subordinate template of `frame` carrying a negation word inside the clause. */
function childNegatedFrameTemplate(frame: TileSentenceFrame): string {
  if (frame === "state") {
    return kChildNegatedStateTemplate;
  }
  if (frame === "event") {
    return kChildNegatedEventTemplate;
  }
  return kChildNegatedVerbTemplate;
}

/**
 * Render the WHEN side of a child rule as a subordinate clause: the negated frame
 * of the sensor a negation heads, the condition alone for a subjectless side, and
 * otherwise the head tile's frame applied to the tiles that follow it. The result
 * carries no trigger word.
 */
function projectChildWhenClause(localizer: Localizer, tiles: ReadonlyList<IBrainTileDef>): List<SentenceSegment> {
  const head = tiles.get(0);
  const slots = new List<SentenceSlot>();
  const sensed = negatedSensor(tiles);
  if (sensed !== undefined) {
    return renderPhrase(
      localizer,
      childNegatedFrameTemplate(tileFrame(sensed)),
      kConnectiveContext,
      negatedFrameSlots(localizer, tiles, sensed)
    );
  }
  if (isSubjectlessWhenSide(tiles)) {
    slots.push(slot("condition", joinWords(localizer, tiles, 0, 0)));
    return renderPhrase(localizer, kChildSubjectlessTemplate, kConnectiveContext, slots);
  }
  slots.push(slot("form", wordPhrase(localizer, head, 0)));
  slots.push(slot("object", tiles.size() > 1 ? joinWords(localizer, tiles, 1, 0) : barePhrase(localizer, head, 0)));
  return renderPhrase(localizer, childFrameTemplate(tileFrame(head)), kConnectiveContext, slots);
}

/**
 * The continuation clause of a child `rule`, which must have tiles on at least
 * one side: its action alone when its WHEN side is empty, its subordinate
 * condition alone when its DO side is empty, and otherwise the two joined.
 */
function projectChildClause(localizer: Localizer, rule: IBrainRuleDef): List<SentenceSegment> {
  const whenTiles = rule.when().tiles();
  const doTiles = rule.do().tiles();
  if (whenTiles.isEmpty()) {
    return joinWords(localizer, doTiles, 0, 0);
  }
  const condition = projectChildWhenClause(localizer, whenTiles);
  if (doTiles.isEmpty()) {
    return condition;
  }
  const clauseSlots = new List<SentenceSlot>();
  clauseSlots.push(slot("condition", condition));
  clauseSlots.push(slot("action", joinWords(localizer, doTiles, 0, whenTiles.size())));
  return renderPhrase(localizer, kChildClauseTemplate, kConnectiveContext, clauseSlots);
}

/** Whether `rule` has no tiles on either side. */
function isTilelessRule(rule: IBrainRuleDef): boolean {
  return rule.when().tiles().isEmpty() && rule.do().tiles().isEmpty();
}

/**
 * Extend the sentence `head` with each rule of `children` in order, joining each
 * through the connective its own shape takes and then continuing with its own
 * children.
 */
function attachChildRules(
  localizer: Localizer,
  head: List<ParagraphEntry>,
  children: ReadonlyList<IBrainRuleDef>
): List<ParagraphEntry> {
  let out = head;
  for (let i = 0; i < children.size(); i++) {
    const child = children.get(i);
    if (isTilelessRule(child)) {
      out = attachChildRules(localizer, out, child.children());
      continue;
    }
    const childEntries = new List<ParagraphEntry>();
    childEntries.push(ruleEntry(child.id(), projectChildClause(localizer, child).asReadonly()));

    const slots = new List<ParagraphSlot>();
    slots.push(paragraphSlot("parent", out.asReadonly()));
    if (child.when().tiles().isEmpty()) {
      slots.push(paragraphSlot("consequence", childEntries.asReadonly()));
      out = composeEntries(localizer, kChildConsequenceTemplate, kConnectiveContext, slots.asReadonly());
    } else {
      slots.push(paragraphSlot("condition", childEntries.asReadonly()));
      out = composeEntries(localizer, kChildConditionTemplate, kConnectiveContext, slots.asReadonly());
    }
    out = attachChildRules(localizer, out, child.children());
  }
  return out;
}

/** Append one terminated sentence per rule of `rules` that carries tiles. */
function collectSentences(
  localizer: Localizer,
  rules: ReadonlyList<IBrainRuleDef>,
  out: List<List<ParagraphEntry>>
): void {
  for (let i = 0; i < rules.size(); i++) {
    const rule = rules.get(i);
    if (isTilelessRule(rule)) {
      collectSentences(localizer, rule.children(), out);
      continue;
    }
    let entries = new List<ParagraphEntry>();
    entries.push(ruleEntry(rule.id(), projectRuleClause(localizer, rule).asReadonly()));
    entries = attachChildRules(localizer, entries, rule.children());

    const terminalSlots = new List<ParagraphSlot>();
    terminalSlots.push(paragraphSlot("sentence", entries.asReadonly()));
    out.push(composeEntries(localizer, kTerminalTemplate, kGlueContext, terminalSlots.asReadonly()));
  }
}

/**
 * Project `page` as a paragraph in `localizer`'s locale.
 *
 * The result is the paragraph's entries in order: one {@link ParagraphRuleEntry}
 * per rule that carries tiles, each holding that rule's own segments, separated
 * by {@link ParagraphGlueEntry} connectives. The display string is
 * {@link paragraphText} of the result.
 *
 * One sentence covers each top-level rule and all of its descendants: a child
 * rule contributes no sentence of its own but extends its parent's as a ", and
 * if <condition>, <action>" continuation, recursively for deeper nesting. A rule
 * with no tiles -- the trailing empty rule among them -- contributes nothing,
 * and its children take its place. A page with no rules projects no entries.
 *
 * The projection is derived state: the same page under the same catalogs always
 * yields the same entries, and nothing about it is persisted. Live callers reach
 * a localizer through `brainDef.servicesLocalizer()`.
 */
export function projectPageParagraph(page: IBrainPageDef, localizer: Localizer): ReadonlyList<ParagraphEntry> {
  const sentences = new List<List<ParagraphEntry>>();
  collectSentences(localizer, page.children(), sentences);
  if (sentences.isEmpty()) {
    return new List<ParagraphEntry>().asReadonly();
  }

  let paragraph = sentences.get(0);
  for (let i = 1; i < sentences.size(); i++) {
    const slots = new List<ParagraphSlot>();
    slots.push(paragraphSlot("sentence", paragraph.asReadonly()));
    slots.push(paragraphSlot("rest", sentences.get(i).asReadonly()));
    paragraph = composeEntries(localizer, kSentenceGlueTemplate, kConnectiveContext, slots.asReadonly());
  }
  return trimParagraphEdges(paragraph.asReadonly()).asReadonly();
}
