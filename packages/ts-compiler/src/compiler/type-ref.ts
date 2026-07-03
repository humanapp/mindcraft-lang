import { CoreTypeNames } from "@mindcraft-lang/core/runtime";
import ts from "typescript";

/**
 * Canonical registry name for each ambient TypeRef token exported by the
 * `mindcraft` module, keyed by the token's exported binding name.
 */
const CORE_TYPE_REF_CANONICAL: ReadonlyMap<string, string> = new Map([
  ["NumberType", CoreTypeNames.Number],
  ["StringType", CoreTypeNames.String],
  ["BooleanType", CoreTypeNames.Boolean],
  ["BufferType", CoreTypeNames.Buffer],
]);

/** Result of {@link resolveTypeNameExpression}: the canonical type name, or a message describing why the expression names no type. */
export type ResolvedTypeName = { name: string } | { error: string };

/**
 * Resolve a type-naming config expression to its canonical registry name.
 * Accepts a string literal (the name verbatim) or an identifier bound to an
 * ambient TypeRef token imported from the `mindcraft` module. Both forms
 * yield the same canonical name, so name-keyed derivations (tile ids,
 * registry lookups) are identical across the two spellings.
 */
export function resolveTypeNameExpression(expr: ts.Expression, checker: ts.TypeChecker): ResolvedTypeName {
  if (ts.isStringLiteral(expr)) {
    return { name: expr.text };
  }

  if (!ts.isIdentifier(expr)) {
    return { error: "must be a type name string literal or an imported type token" };
  }

  const symbol = checker.getSymbolAtLocation(expr);
  if (!symbol) {
    return { error: `\`${expr.text}\` cannot be resolved` };
  }
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declarations = target.getDeclarations();
  const declaration = declarations && declarations.length > 0 ? declarations[0] : undefined;
  if (!declaration || !isMindcraftModuleDeclaration(declaration)) {
    return { error: `\`${expr.text}\` is not a type token exported by the \`mindcraft\` module` };
  }

  const canonical = CORE_TYPE_REF_CANONICAL.get(target.name);
  if (canonical === undefined) {
    return { error: `\`${target.name}\` is not a known type token` };
  }
  return { name: canonical };
}

/** True when `node` is declared inside an ambient `declare module "mindcraft"` block. */
function isMindcraftModuleDeclaration(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isModuleDeclaration(current) && ts.isStringLiteral(current.name) && current.name.text === "mindcraft") {
      return true;
    }
    current = current.parent;
  }
  return false;
}
