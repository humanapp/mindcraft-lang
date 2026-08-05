import { StringUtils as SU } from "../platform/string";

/**
 * How a locale cases the word that opens a sentence.
 *
 * The operation the spec drives is strictly one-directional: it uppercases the
 * word's leading unit and nothing else. It never lowercases, never case-folds,
 * and never reaches past that unit, so a word authored with capitals -- a
 * proper noun, a brand -- reads exactly as its author wrote it wherever it
 * stands, and applying the rule to an already-capitalized word returns it
 * unchanged. A locale supplying its own spec is bound by the same contract.
 */
export interface SentenceCaseSpec {
  /**
   * Whether the locale capitalizes the word opening a sentence at all. `false`
   * makes the operation the identity, for a caseless script or an orthography
   * that opens a sentence in lower case.
   */
  readonly capitalizes: boolean;
  /**
   * Leading letter sequences the locale uppercases as one unit, written in
   * lower case -- `ij` in Dutch, whose sentence-initial form is `IJ`. Each is
   * matched case-insensitively against the start of the word and the longest
   * match wins; a word matching none takes its first character as the unit.
   */
  readonly initialUnits?: readonly string[];
}

/** Sentence-case spec of the default locale: uppercase the leading character. */
export const defaultSentenceCaseSpec: SentenceCaseSpec = { capitalizes: true };

/** Length of the leading unit of `text` under `spec`, in characters. */
function leadingUnitLength(spec: SentenceCaseSpec, text: string): number {
  let longest = 0;
  for (const unit of spec.initialUnits ?? []) {
    const size = SU.length(unit);
    if (size > longest && SU.toLowerCase(SU.substring(text, 0, size)) === unit) {
      longest = size;
    }
  }
  return longest > 0 ? longest : 1;
}

/**
 * Case `text` as the word a sentence opens with, under `spec` and in the casing
 * rules of `locale`: its leading unit is uppercased and the remainder is
 * returned exactly as given.
 *
 * Returns `text` unchanged when `spec` does not capitalize and when `text` is
 * empty. Applying it twice is the same as applying it once.
 */
export function applySentenceCase(spec: SentenceCaseSpec, locale: string, text: string): string {
  if (!spec.capitalizes || text === "") {
    return text;
  }
  const unit = leadingUnitLength(spec, text);
  return SU.toLocaleUpperCase(SU.substring(text, 0, unit), locale) + SU.substring(text, unit);
}
