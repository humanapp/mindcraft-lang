import { Dict } from "../platform/dict";
import { MathOps } from "../platform/math";
import { StringUtils as SU } from "../platform/string";
import { formatTemplate, parseTemplate, type TemplateBranch, type TemplateNode } from "./template";

/** ASCII letters and the accented characters the pseudo-locale renders them as. */
const kAccentPairs: readonly (readonly [string, string])[] = [
  ["a", "á"],
  ["b", "ƀ"],
  ["c", "ç"],
  ["d", "ð"],
  ["e", "é"],
  ["f", "ƒ"],
  ["g", "ğ"],
  ["h", "ĥ"],
  ["i", "í"],
  ["j", "ĵ"],
  ["k", "ķ"],
  ["l", "ĺ"],
  ["m", "ɱ"],
  ["n", "ñ"],
  ["o", "ó"],
  ["p", "þ"],
  ["q", "ʠ"],
  ["r", "ŕ"],
  ["s", "š"],
  ["t", "ţ"],
  ["u", "ú"],
  ["v", "ṽ"],
  ["w", "ŵ"],
  ["x", "ẋ"],
  ["y", "ý"],
  ["z", "ž"],
  ["A", "Á"],
  ["B", "Ɓ"],
  ["C", "Ç"],
  ["D", "Ð"],
  ["E", "É"],
  ["F", "Ƒ"],
  ["G", "Ğ"],
  ["H", "Ĥ"],
  ["I", "Í"],
  ["J", "Ĵ"],
  ["K", "Ķ"],
  ["L", "Ĺ"],
  ["M", "Ṁ"],
  ["N", "Ñ"],
  ["O", "Ó"],
  ["P", "Þ"],
  ["Q", "Ǫ"],
  ["R", "Ŕ"],
  ["S", "Š"],
  ["T", "Ţ"],
  ["U", "Ú"],
  ["V", "Ṽ"],
  ["W", "Ŵ"],
  ["X", "Ẋ"],
  ["Y", "Ý"],
  ["Z", "Ž"],
];

function buildAccentMap(): Dict<string, string> {
  const map = new Dict<string, string>();
  for (const pair of kAccentPairs) {
    map.set(pair[0], pair[1]);
  }
  return map;
}

const kAccentMap = buildAccentMap();

/** Marker opening every pseudo-localized string. */
const kOpenMarker = "[!";

/** Marker closing every pseudo-localized string. */
const kCloseMarker = "!]";

/** Character the pseudo-locale pads with to expand length. */
const kPadChar = "~";

/** Fraction of the letter count added as padding. */
const kExpansion = 0.4;

interface AccentedText {
  readonly text: string;
  readonly letters: number;
}

/**
 * Accent the ASCII letters of `text`, leaving `$(...)` icon tokens intact.
 * Non-ASCII bytes pass through untouched.
 */
function accentText(text: string): AccentedText {
  const n = SU.length(text);
  let out = "";
  let letters = 0;
  let i = 0;
  while (i < n) {
    if (SU.charAt(text, i) === "$" && SU.charAt(text, i + 1) === "(") {
      const close = SU.indexOf(text, ")", i + 2);
      if (close >= 0) {
        out += SU.substring(text, i, close + 1);
        i = close + 1;
        continue;
      }
    }
    const ch = SU.charAt(text, i);
    const accented = kAccentMap.get(ch);
    if (accented === undefined) {
      out += ch;
    } else {
      out += accented;
      letters += 1;
    }
    i += 1;
  }
  return { text: out, letters };
}

function accentNodes(nodes: readonly TemplateNode[], counter: { letters: number }): TemplateNode[] {
  const out: TemplateNode[] = [];
  for (const node of nodes) {
    if (node.kind === "text") {
      const accented = accentText(node.text);
      counter.letters += accented.letters;
      out.push({ kind: "text", text: accented.text });
    } else if (node.kind === "plural" || node.kind === "select") {
      const branches: TemplateBranch[] = [];
      for (const branch of node.branches) {
        branches.push({ key: branch.key, nodes: accentNodes(branch.nodes, counter) });
      }
      out.push(
        node.kind === "plural"
          ? { kind: "plural", name: node.name, branches }
          : { kind: "select", name: node.name, branches }
      );
    } else {
      out.push(node);
    }
  }
  return out;
}

/**
 * Generate the pseudo-locale rendering of an English source string: literal
 * text is accented, the whole string is bracketed with `[!` and `!]`, and
 * padding expands its length so clipped layouts show up.
 *
 * Placeholders, plural and select syntax, branch keys, and `$(...)` icon
 * tokens are reproduced unaltered, so a pseudo-localized template renders with
 * the same parameters as its source.
 */
export function pseudoLocalize(source: string): string {
  const parsed = parseTemplate(source);
  const counter = { letters: 0 };
  const nodes = accentNodes(parsed.nodes, counter);
  const padding = SU.rep(kPadChar, MathOps.floor(counter.letters * kExpansion));
  return `${kOpenMarker}${formatTemplate(nodes)}${padding}${kCloseMarker}`;
}
