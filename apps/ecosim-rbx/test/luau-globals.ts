/**
 * Minimal Node stand-ins for the Roblox ambient globals the mirrored brain
 * sources under `src/server/brain/` read.
 *
 * Importing this module installs the stand-ins. Import it before any module
 * that reaches the mirror, because the mirror evaluates `math.pi` at module
 * scope.
 *
 * Only the members the mirror actually touches are provided:
 *
 * - `math`: the subset of Luau's math library the mirror calls.
 * - `typeIs`: the Luau type predicate, for `"string"`, `"number"`,
 *   `"boolean"`, `"function"`, and `"table"`.
 * - `string.format`: `%s`, `%d`, and `%.Nf` directives.
 * - `String.prototype.size` / `.sub` / `.find` and `Array.prototype.size`:
 *   the Luau string and array members roblox-ts compiles method calls to.
 *   `sub` and `find` use Luau's 1-based inclusive indexing.
 */

type LuauFindResult = [number | undefined, number | undefined];

const luauMath = {
  pi: Math.PI,
  huge: Number.POSITIVE_INFINITY,
  abs: (x: number): number => Math.abs(x),
  atan2: (y: number, x: number): number => Math.atan2(y, x),
  cos: (x: number): number => Math.cos(x),
  max: (...values: number[]): number => Math.max(...values),
  min: (...values: number[]): number => Math.min(...values),
  sin: (x: number): number => Math.sin(x),
  sqrt: (x: number): number => Math.sqrt(x),
};

function luauTypeIs(value: unknown, kind: string): boolean {
  switch (kind) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "function":
      return typeof value === "function";
    case "table":
      return typeof value === "object" && value !== null;
    case "nil":
      return value === undefined || value === null;
    default:
      return false;
  }
}

function formatDirective(directive: string, arg: unknown): string {
  const fixed = /^%\.(\d+)f$/.exec(directive);
  if (fixed) {
    return Number(arg).toFixed(Number.parseInt(fixed[1], 10));
  }
  if (directive === "%d") {
    return String(Math.trunc(Number(arg)));
  }
  if (directive === "%s") {
    return String(arg);
  }
  throw new Error(`Luau string.format shim does not implement the directive '${directive}'`);
}

function luauFormat(template: string, ...args: unknown[]): string {
  let argIndex = 0;
  return template.replace(/%%|%\.?\d*[a-zA-Z]/g, (directive) => {
    if (directive === "%%") return "%";
    const arg = args[argIndex];
    argIndex += 1;
    return formatDirective(directive, arg);
  });
}

/**
 * Luau `string.sub`: `i` and `j` are 1-based and inclusive, negative values
 * count back from the end, and `j` defaults to the last character.
 */
function luauSub(text: string, i: number, j: number = -1): string {
  const len = text.length;
  let start = i < 0 ? len + i + 1 : i;
  let stop = j < 0 ? len + j + 1 : j;
  if (start < 1) start = 1;
  if (stop > len) stop = len;
  if (start > stop) return "";
  return text.slice(start - 1, stop);
}

/**
 * Luau `string.find` restricted to plain (non-pattern) searches, which is the
 * only form the mirror uses. Returns the 1-based inclusive `[start, stop]`
 * pair, or `[undefined, undefined]` when the needle is absent.
 */
function luauFind(text: string, needle: string, init: number = 1, plain: boolean = false): LuauFindResult {
  if (!plain) {
    throw new Error("Luau string.find shim implements plain searches only; pass plain = true");
  }
  const len = text.length;
  let from = init < 0 ? len + init : init - 1;
  if (from < 0) from = 0;
  const idx = text.indexOf(needle, from);
  if (idx === -1) return [undefined, undefined];
  return [idx + 1, idx + needle.length];
}

function defineMember(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
}

const globals = globalThis as unknown as Record<string, unknown>;

globals.math = luauMath;
globals.typeIs = luauTypeIs;
globals.string = { format: luauFormat };

defineMember(String.prototype, "size", function size(this: string): number {
  return this.length;
});
defineMember(String.prototype, "sub", function sub(this: string, i: number, j?: number): string {
  return luauSub(this, i, j);
});
defineMember(
  String.prototype,
  "find",
  function find(this: string, needle: string, init?: number, plain?: boolean): LuauFindResult {
    return luauFind(this, needle, init, plain);
  }
);
defineMember(Array.prototype, "size", function size(this: unknown[]): number {
  return this.length;
});
