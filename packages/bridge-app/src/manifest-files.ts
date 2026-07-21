/**
 * Queries and edits over a project content manifest's `files` list: the list
 * names what is in the build, while the project may hold more files than it
 * lists. Membership tells the two apart; the only error direction is a listed
 * file that is absent from the project. The edit helpers toggle one entry in
 * the manifest's JSON text while leaving every other byte of the document
 * untouched.
 */

/**
 * Normalize a manifest `files` entry or project file path for comparison by
 * stripping leading `./` and `/` segments. `"./a.ts"`, `"/a.ts"`, and
 * `"a.ts"` all normalize to `"a.ts"`.
 */
export function normalizeManifestFilePath(path: string): string {
  let result = path;
  for (;;) {
    if (result.startsWith("./")) {
      result = result.slice(2);
    } else if (result.startsWith("/")) {
      result = result.slice(1);
    } else {
      return result;
    }
  }
}

/**
 * True when `path` is named by the manifest `files` list, comparing both
 * sides with {@link normalizeManifestFilePath}.
 */
export function isFileInBuild(files: readonly string[], path: string): boolean {
  const target = normalizeManifestFilePath(path);
  return files.some((entry) => normalizeManifestFilePath(entry) === target);
}

/**
 * Return the `files` entries, as written, whose normalized path `exists`
 * rejects. An empty result means every listed file is present. Paths absent
 * from `files` are never reported, whatever `exists` answers for them.
 *
 * @param files - The manifest `files` list.
 * @param exists - Presence test invoked with each entry's normalized path.
 */
export function findMissingListedFiles(files: readonly string[], exists: (path: string) => boolean): readonly string[] {
  return files.filter((entry) => !exists(normalizeManifestFilePath(entry)));
}

/**
 * Read the `files` list from a manifest's JSON text without validating the
 * rest of the document. Returns the string entries when the document is a
 * JSON object whose `files` is an array holding at least one string, and
 * `undefined` otherwise (including unparseable text).
 */
export function readManifestFilesList(manifestText: string): readonly string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const files = (parsed as Record<string, unknown>).files;
  if (!Array.isArray(files)) {
    return undefined;
  }
  const entries = files.filter((entry): entry is string => typeof entry === "string");
  return entries.length > 0 ? entries : undefined;
}

/**
 * Add `path` (normalized) to the manifest text's `files` array, preserving
 * every byte of the document outside that array and matching the array's
 * existing one-entry-per-line or single-line formatting. Returns the edited
 * text, or `undefined` when the document has no well-formed root-level
 * string-array `files`, the entry is already listed, or the edit would not
 * produce valid JSON.
 */
export function addManifestFilesEntry(manifestText: string, path: string): string | undefined {
  const span = findFilesArray(manifestText);
  if (span === undefined) return undefined;
  const target = normalizeManifestFilePath(path);
  if (span.elements.some((element) => normalizeManifestFilePath(element.value) === target)) {
    return undefined;
  }
  const entryText = JSON.stringify(target);
  let edited: string;
  if (span.elements.length === 0) {
    edited = manifestText.slice(0, span.start + 1) + entryText + manifestText.slice(span.end);
  } else {
    const first = span.elements[0];
    const last = span.elements[span.elements.length - 1];
    const leading = manifestText.slice(span.start + 1, first.start);
    const separator = `,${leading === "" ? " " : leading}`;
    edited = manifestText.slice(0, last.end) + separator + entryText + manifestText.slice(last.end);
  }
  return isValidJson(edited) ? edited : undefined;
}

/**
 * Remove every `files` entry matching `path` (compared normalized) from the
 * manifest text, preserving every byte of the document outside the `files`
 * array. Returns the edited text, or `undefined` when the document has no
 * well-formed root-level string-array `files`, no entry matches, or the edit
 * would not produce valid JSON. Removing the last entry leaves `[]`.
 */
export function removeManifestFilesEntry(manifestText: string, path: string): string | undefined {
  const span = findFilesArray(manifestText);
  if (span === undefined) return undefined;
  const target = normalizeManifestFilePath(path);
  const kept = span.elements.filter((element) => normalizeManifestFilePath(element.value) !== target);
  if (kept.length === span.elements.length) return undefined;
  let content: string;
  if (kept.length === 0) {
    content = "";
  } else {
    const first = span.elements[0];
    const last = span.elements[span.elements.length - 1];
    const leading = manifestText.slice(span.start + 1, first.start);
    const trailing = manifestText.slice(last.end, span.end);
    const separator = span.elements.length >= 2 ? manifestText.slice(span.elements[0].end, span.elements[1].start) : "";
    content =
      leading + kept.map((element) => manifestText.slice(element.start, element.end)).join(separator) + trailing;
  }
  const edited = manifestText.slice(0, span.start + 1) + content + manifestText.slice(span.end);
  return isValidJson(edited) ? edited : undefined;
}

/** Source span of one string element inside the `files` array. */
interface FilesArrayElement {
  /** Index of the element's opening quote. */
  readonly start: number;
  /** Index just past the element's closing quote. */
  readonly end: number;
  /** Decoded string value of the element. */
  readonly value: string;
}

/** Source span of the root-level `files` array in a manifest's JSON text. */
interface FilesArraySpan {
  /** Index of the array's `[`. */
  readonly start: number;
  /** Index of the array's `]`. */
  readonly end: number;
  /** The array's string elements in order. */
  readonly elements: readonly FilesArrayElement[];
}

/**
 * Locate the root-level `files` array in JSON text. Only a `files` key of the
 * document's root object counts; the same key nested deeper, or the word
 * inside a string value, is ignored. Returns `undefined` when the key is
 * absent, its value is not an array of strings, or the text is malformed.
 */
function findFilesArray(text: string): FilesArraySpan | undefined {
  const stack: ("{" | "[")[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const token = scanString(text, i);
      if (token === undefined) return undefined;
      if (stack.length === 1 && stack[0] === "{" && token.value === "files") {
        const colon = skipWhitespace(text, token.end);
        if (text[colon] === ":") {
          const open = skipWhitespace(text, colon + 1);
          if (text[open] !== "[") return undefined;
          return scanFilesArray(text, open);
        }
      }
      i = token.end;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
    i++;
  }
  return undefined;
}

/** Scan the `files` array starting at its `[`; strings at element depth become elements. */
function scanFilesArray(text: string, open: number): FilesArraySpan | undefined {
  const elements: FilesArrayElement[] = [];
  let depth = 1;
  let i = open + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const token = scanString(text, i);
      if (token === undefined) return undefined;
      if (depth !== 1) return undefined;
      elements.push(token);
      i = token.end;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        if (ch !== "]") return undefined;
        return { start: open, end: i, elements };
      }
    } else if (ch !== "," && ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") {
      return undefined;
    }
    i++;
  }
  return undefined;
}

/** Scan one JSON string token starting at its opening quote. */
function scanString(text: string, start: number): FilesArrayElement | undefined {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') {
      const end = i + 1;
      try {
        return { start, end, value: JSON.parse(text.slice(start, end)) as string };
      } catch {
        return undefined;
      }
    }
    i++;
  }
  return undefined;
}

/** Index of the first non-whitespace character at or after `from`. */
function skipWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) {
    i++;
  }
  return i;
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
