/** A parsed `[major, minor, patch]` version triple. */
type VersionTriple = readonly [number, number, number];

/** Parse the release triple of a version, ignoring any prerelease or build metadata. Returns `undefined` when malformed. */
function parseVersionTriple(version: string): VersionTriple | undefined {
  const release = version.split("-")[0].split("+")[0];
  const parts = release.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const triple = parts.map((part) => Number(part));
  if (triple.some((part) => !Number.isInteger(part) || part < 0)) {
    return undefined;
  }
  return [triple[0], triple[1], triple[2]];
}

/** Compare two version triples; negative when `a < b`, positive when `a > b`, zero when equal. */
function compareTriple(a: VersionTriple, b: VersionTriple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/** A parsed range comparator: a wildcard, or an operator with its version bound. */
type RangeComparator =
  | { readonly kind: "any" }
  | { readonly kind: "bound"; readonly operator: string; readonly bound: VersionTriple };

/** Parse a single range comparator. Returns `undefined` when the comparator is not in the supported grammar. */
function parseComparator(comparator: string): RangeComparator | undefined {
  if (comparator === "*" || comparator === "x" || comparator === "X") {
    return { kind: "any" };
  }
  const operatorMatch = comparator.match(/^(>=|<=|>|<|=|\^|~)?(.*)$/);
  if (operatorMatch === null) {
    return undefined;
  }
  const bound = parseVersionTriple(operatorMatch[2]);
  if (bound === undefined) {
    return undefined;
  }
  return { kind: "bound", operator: operatorMatch[1] ?? "", bound };
}

/** Split a range into its whitespace-separated comparator tokens. */
function rangeComparators(range: string): string[] {
  return range
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
}

/** The exclusive upper bound of a caret range: the next version that changes the leftmost non-zero component. */
function caretUpperBound(bound: VersionTriple): VersionTriple {
  if (bound[0] > 0) {
    return [bound[0] + 1, 0, 0];
  }
  if (bound[1] > 0) {
    return [0, bound[1] + 1, 0];
  }
  return [0, 0, bound[2] + 1];
}

/** Report whether a version triple satisfies a single parsed comparator. */
function satisfiesParsedComparator(target: VersionTriple, comparator: RangeComparator): boolean {
  if (comparator.kind === "any") {
    return true;
  }
  const order = compareTriple(target, comparator.bound);
  switch (comparator.operator) {
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
    case "^":
      return order >= 0 && compareTriple(target, caretUpperBound(comparator.bound)) < 0;
    case "~":
      return order >= 0 && compareTriple(target, [comparator.bound[0], comparator.bound[1] + 1, 0]) < 0;
    default:
      return order === 0;
  }
}

/**
 * Report whether a semantic version satisfies a semver range. Supports a
 * space-separated conjunction of comparators, each one of: `*`/`x` (any),
 * an exact `x.y.z` (optionally prefixed `=`), a caret range `^x.y.z`, a tilde
 * range `~x.y.z`, or a `>`, `>=`, `<`, or `<=` comparator. Prerelease and build
 * metadata are ignored in the comparison.
 *
 * @param version - A concrete semantic version.
 * @param range - The semver range to test against.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const target = parseVersionTriple(version);
  if (target === undefined) {
    return false;
  }
  return rangeComparators(range).every((comparator) => {
    const parsed = parseComparator(comparator);
    return parsed !== undefined && satisfiesParsedComparator(target, parsed);
  });
}

/**
 * Report whether a range string is fully within the grammar
 * {@link satisfiesRange} evaluates: at least one whitespace-separated
 * comparator, each a wildcard (`*`/`x`), an exact or `=`-prefixed `x.y.z`, a
 * `^x.y.z` caret range, a `~x.y.z` tilde range, or a `>`, `>=`, `<`, or `<=`
 * comparator over an `x.y.z` bound.
 *
 * @param range - The range string to check.
 */
export function isSupportedVersionRange(range: string): boolean {
  const comparators = rangeComparators(range);
  if (comparators.length === 0) {
    return false;
  }
  return comparators.every((comparator) => parseComparator(comparator) !== undefined);
}
