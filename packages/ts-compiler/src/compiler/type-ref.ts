import { CoreTypeNames } from "@mindcraft-lang/core/runtime";
import ts from "typescript";
import { qualifiedClassName } from "./symbol-keys.js";

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

/** The canonical registry name of the ambient TypeRef token `idNode` references, or undefined. */
export function ambientTypeTokenName(idNode: ts.Identifier, checker: ts.TypeChecker): string | undefined {
  const symbol = checker.getSymbolAtLocation(idNode);
  if (!symbol) return undefined;
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declarations = target.getDeclarations();
  const declaration = declarations && declarations.length > 0 ? declarations[0] : undefined;
  if (!declaration || !isMindcraftModuleDeclaration(declaration)) return undefined;
  return CORE_TYPE_REF_CANONICAL.get(target.name);
}

/**
 * The declared initializer expression a shorthand object member references
 * (`{ accessors }` reads `const accessors = ...`), or undefined when the
 * shorthand does not resolve to an initialized variable declaration.
 */
export function shorthandValueExpression(
  prop: ts.ShorthandPropertyAssignment,
  checker: ts.TypeChecker
): ts.Expression | undefined {
  let symbol = checker.getShorthandAssignmentValueSymbol(prop);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  const decl = symbol?.valueDeclaration;
  if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
    return decl.initializer;
  }
  return undefined;
}

/** The `StructType(...)` call expression `expr` is, or undefined when it is not one. */
export function structTypeCallExpression(expr: ts.Expression | undefined): ts.CallExpression | undefined {
  if (!expr || !ts.isCallExpression(expr)) return undefined;
  if (!ts.isIdentifier(expr.expression) || expr.expression.text !== "StructType") return undefined;
  return expr;
}

/**
 * The config object literal of a `StructType({...})` call expression, or
 * undefined when `expr` is not one.
 */
export function structTypeConfigObject(expr: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
  const call = structTypeCallExpression(expr);
  if (!call) return undefined;
  const arg = call.arguments.length === 1 ? call.arguments[0] : undefined;
  return arg && ts.isObjectLiteralExpression(arg) ? arg : undefined;
}

/**
 * Resolve a type-naming config expression to its canonical registry name.
 * Accepts a string literal (the name verbatim), an identifier bound to an
 * ambient TypeRef token imported from the `mindcraft` module, or an identifier
 * bound to a user `StructType({...})` or `enum` declaration (resolving to its
 * qualified `<namespace>:<file>::<binding>` name). Every form yields the
 * canonical name, so name-keyed derivations (tile ids, registry lookups) are
 * identical across spellings.
 */
export function resolveTypeNameExpression(
  expr: ts.Expression,
  checker: ts.TypeChecker,
  projectNamespace: string
): ResolvedTypeName {
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
  if (!declaration) {
    return { error: `\`${expr.text}\` has no resolvable declaration` };
  }

  if (ts.isEnumDeclaration(declaration)) {
    return {
      name: qualifiedClassName(projectNamespace, declaration.getSourceFile().fileName, declaration.name.text),
    };
  }

  if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
    if (structTypeConfigObject(declaration.initializer)) {
      return {
        name: qualifiedClassName(projectNamespace, declaration.getSourceFile().fileName, declaration.name.text),
      };
    }
    if (structTypeCallExpression(declaration.initializer)) {
      return {
        error: `\`${expr.text}\` is a \`StructType\` binding whose config is not a single inline object literal`,
      };
    }
  }

  if (!isMindcraftModuleDeclaration(declaration)) {
    return {
      error: `\`${expr.text}\` is not a type token exported by \`mindcraft\`, a \`StructType\` binding, or an enum`,
    };
  }

  const canonical = CORE_TYPE_REF_CANONICAL.get(target.name);
  if (canonical === undefined) {
    return { error: `\`${target.name}\` is not a known type token` };
  }
  return { name: canonical };
}

/** True when `node` is declared inside an ambient `declare module "mindcraft"` block. */
export function isMindcraftModuleDeclaration(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isModuleDeclaration(current) && ts.isStringLiteral(current.name) && current.name.text === "mindcraft") {
      return true;
    }
    current = current.parent;
  }
  return false;
}
