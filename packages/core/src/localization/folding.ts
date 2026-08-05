import { StringUtils as SU } from "../platform/string";

/** Accented Latin characters and the unaccented text they fold to. */
const kFoldPairs: readonly (readonly [string, string])[] = [
  ["À", "a"],
  ["Á", "a"],
  ["Â", "a"],
  ["Ã", "a"],
  ["Ä", "a"],
  ["Å", "a"],
  ["Ā", "a"],
  ["Ă", "a"],
  ["Ą", "a"],
  ["à", "a"],
  ["á", "a"],
  ["â", "a"],
  ["ã", "a"],
  ["ä", "a"],
  ["å", "a"],
  ["ā", "a"],
  ["ă", "a"],
  ["ą", "a"],
  ["Æ", "ae"],
  ["æ", "ae"],
  ["Ç", "c"],
  ["Ć", "c"],
  ["Č", "c"],
  ["ç", "c"],
  ["ć", "c"],
  ["č", "c"],
  ["Ď", "d"],
  ["Đ", "d"],
  ["Ð", "d"],
  ["ď", "d"],
  ["đ", "d"],
  ["ð", "d"],
  ["È", "e"],
  ["É", "e"],
  ["Ê", "e"],
  ["Ë", "e"],
  ["Ē", "e"],
  ["Ė", "e"],
  ["Ę", "e"],
  ["Ě", "e"],
  ["è", "e"],
  ["é", "e"],
  ["ê", "e"],
  ["ë", "e"],
  ["ē", "e"],
  ["ė", "e"],
  ["ę", "e"],
  ["ě", "e"],
  ["Ğ", "g"],
  ["ğ", "g"],
  ["Ì", "i"],
  ["Í", "i"],
  ["Î", "i"],
  ["Ï", "i"],
  ["Ī", "i"],
  ["Į", "i"],
  ["İ", "i"],
  ["ì", "i"],
  ["í", "i"],
  ["î", "i"],
  ["ï", "i"],
  ["ī", "i"],
  ["į", "i"],
  ["ı", "i"],
  ["Ĺ", "l"],
  ["Ľ", "l"],
  ["Ł", "l"],
  ["ĺ", "l"],
  ["ľ", "l"],
  ["ł", "l"],
  ["Ñ", "n"],
  ["Ń", "n"],
  ["Ň", "n"],
  ["ñ", "n"],
  ["ń", "n"],
  ["ň", "n"],
  ["Ò", "o"],
  ["Ó", "o"],
  ["Ô", "o"],
  ["Õ", "o"],
  ["Ö", "o"],
  ["Ø", "o"],
  ["Ō", "o"],
  ["Ő", "o"],
  ["ò", "o"],
  ["ó", "o"],
  ["ô", "o"],
  ["õ", "o"],
  ["ö", "o"],
  ["ø", "o"],
  ["ō", "o"],
  ["ő", "o"],
  ["Œ", "oe"],
  ["œ", "oe"],
  ["Ŕ", "r"],
  ["Ř", "r"],
  ["ŕ", "r"],
  ["ř", "r"],
  ["Ś", "s"],
  ["Ş", "s"],
  ["Š", "s"],
  ["ś", "s"],
  ["ş", "s"],
  ["š", "s"],
  ["ß", "ss"],
  ["Ţ", "t"],
  ["Ť", "t"],
  ["ţ", "t"],
  ["ť", "t"],
  ["Þ", "th"],
  ["þ", "th"],
  ["Ù", "u"],
  ["Ú", "u"],
  ["Û", "u"],
  ["Ü", "u"],
  ["Ū", "u"],
  ["Ů", "u"],
  ["Ű", "u"],
  ["Ų", "u"],
  ["ù", "u"],
  ["ú", "u"],
  ["û", "u"],
  ["ü", "u"],
  ["ū", "u"],
  ["ů", "u"],
  ["ű", "u"],
  ["ų", "u"],
  ["Ý", "y"],
  ["ý", "y"],
  ["ÿ", "y"],
  ["Ź", "z"],
  ["Ż", "z"],
  ["Ž", "z"],
  ["ź", "z"],
  ["ż", "z"],
  ["ž", "z"],
];

function hasNonAscii(s: string): boolean {
  const n = SU.length(s);
  for (let i = 0; i < n; i++) {
    if (SU.charCodeAt(s, i) > 127) {
      return true;
    }
  }
  return false;
}

/**
 * Fold `s` for search matching: accented Latin characters lose their
 * diacritics and the result is lowercased, so a query of `uber` matches a
 * candidate of `Uber`. Apply it to the query and the candidate alike.
 */
export function foldForSearch(s: string): string {
  if (!hasNonAscii(s)) {
    return SU.toLowerCase(s);
  }
  let folded = s;
  for (const pair of kFoldPairs) {
    if (SU.indexOf(folded, pair[0]) >= 0) {
      folded = SU.split(folded, pair[0]).join(pair[1]);
    }
  }
  return SU.toLowerCase(folded);
}
