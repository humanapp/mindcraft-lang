import ts from "typescript";
import { DescriptorDiagCode } from "./diag-codes.js";
import type { CompileDiagnostic, ExtractedArgSpec, ExtractedDescriptor, ExtractedParam, SourceSpan } from "./types.js";

export interface ExtractionResult {
  descriptor?: ExtractedDescriptor;
  diagnostics: CompileDiagnostic[];
}

export function extractDescriptor(sourceFile: ts.SourceFile): ExtractionResult {
  const diagnostics: CompileDiagnostic[] = [];

  function addDiag(code: DescriptorDiagCode, node: ts.Node, message: string): void {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    diagnostics.push({
      code,
      message,
      severity: "error",
      line: start.line + 1,
      column: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
    });
  }

  function spanOf(node: ts.Node): SourceSpan {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    return {
      line: start.line + 1,
      column: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
    };
  }

  let defaultExport: ts.ExportAssignment | undefined;

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      defaultExport = statement;
    }
  }

  if (!defaultExport) {
    diagnostics.push({
      code: DescriptorDiagCode.MissingDefaultExport,
      message: "Missing default export. Expected `export default Sensor({...})` or `export default Actuator({...})`.",
      severity: "error",
      line: 1,
      column: 1,
    });
    return { diagnostics };
  }

  const expr = defaultExport.expression;
  if (!ts.isCallExpression(expr)) {
    addDiag(
      DescriptorDiagCode.InvalidDefaultExport,
      expr,
      "Default export must be a call to `Sensor({...})` or `Actuator({...})`."
    );
    return { diagnostics };
  }

  if (!ts.isIdentifier(expr.expression)) {
    addDiag(
      DescriptorDiagCode.InvalidDefaultExport,
      expr.expression,
      "Default export must be a call to `Sensor({...})` or `Actuator({...})`."
    );
    return { diagnostics };
  }

  const callee = expr.expression.text;
  if (callee !== "Sensor" && callee !== "Actuator") {
    addDiag(
      DescriptorDiagCode.InvalidDefaultExport,
      expr.expression,
      "Default export must be a call to `Sensor({...})` or `Actuator({...})`."
    );
    return { diagnostics };
  }

  const kind: "sensor" | "actuator" = callee === "Sensor" ? "sensor" : "actuator";

  if (expr.arguments.length !== 1) {
    addDiag(
      DescriptorDiagCode.InvalidCalleeArgumentCount,
      expr,
      `\`${callee}()\` must be called with exactly one argument.`
    );
    return { diagnostics };
  }

  const arg = expr.arguments[0];
  if (!ts.isObjectLiteralExpression(arg)) {
    addDiag(
      DescriptorDiagCode.CalleeArgumentNotObjectLiteral,
      arg,
      `\`${callee}()\` argument must be an object literal.`
    );
    return { diagnostics };
  }

  let name: string | undefined;
  let args: ExtractedArgSpec[] = [];
  let onExecuteNode: ts.FunctionExpression | ts.MethodDeclaration | ts.ArrowFunction | undefined;
  let execIsAsync = false;
  let onPageEnteredNode: ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction | null = null;
  let label: string | undefined;
  let icon: string | undefined;
  let iconSpan: SourceSpan | undefined;
  let docs: string | undefined;
  let docsSpan: SourceSpan | undefined;
  let tags: string[] | undefined;

  for (const prop of arg.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      switch (prop.name.text) {
        case "name":
          if (ts.isStringLiteral(prop.initializer)) {
            name = prop.initializer.text;
          } else {
            addDiag(DescriptorDiagCode.NameMustBeStringLiteral, prop.initializer, "`name` must be a string literal.");
          }
          break;

        case "args":
          args = extractArgs(prop.initializer, addDiag);
          break;

        case "onExecute":
          if (ts.isFunctionExpression(prop.initializer) || ts.isArrowFunction(prop.initializer)) {
            onExecuteNode = prop.initializer;
            execIsAsync = prop.initializer.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
          } else {
            addDiag(DescriptorDiagCode.OnExecuteMustBeFunction, prop.initializer, "`onExecute` must be a function.");
          }
          break;

        case "onPageEntered":
          if (ts.isFunctionExpression(prop.initializer) || ts.isArrowFunction(prop.initializer)) {
            onPageEnteredNode = prop.initializer;
          } else {
            addDiag(
              DescriptorDiagCode.OnPageEnteredMustBeFunction,
              prop.initializer,
              "`onPageEntered` must be a function."
            );
          }
          break;

        case "label":
          if (ts.isStringLiteral(prop.initializer)) {
            label = prop.initializer.text;
          } else {
            addDiag(DescriptorDiagCode.LabelMustBeStringLiteral, prop.initializer, "`label` must be a string literal.");
          }
          break;

        case "icon":
          if (ts.isStringLiteral(prop.initializer)) {
            icon = prop.initializer.text;
            iconSpan = spanOf(prop.initializer);
          } else {
            addDiag(DescriptorDiagCode.IconMustBeStringLiteral, prop.initializer, "`icon` must be a string literal.");
          }
          break;

        case "docs":
          if (ts.isStringLiteral(prop.initializer)) {
            docs = prop.initializer.text;
            docsSpan = spanOf(prop.initializer);
          } else {
            addDiag(DescriptorDiagCode.DocsMustBeStringLiteral, prop.initializer, "`docs` must be a string literal.");
          }
          break;

        case "tags":
          if (ts.isArrayLiteralExpression(prop.initializer)) {
            tags = [];
            for (const elem of prop.initializer.elements) {
              if (ts.isStringLiteral(elem)) {
                tags.push(elem.text);
              } else {
                addDiag(
                  DescriptorDiagCode.TagElementMustBeStringLiteral,
                  elem,
                  "Each element of `tags` must be a string literal."
                );
              }
            }
          } else {
            addDiag(DescriptorDiagCode.TagsMustBeArrayLiteral, prop.initializer, "`tags` must be an array literal.");
          }
          break;
      }
    } else if (ts.isMethodDeclaration(prop) && ts.isIdentifier(prop.name)) {
      if (prop.name.text === "onExecute") {
        onExecuteNode = prop;
        execIsAsync = prop.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
      } else if (prop.name.text === "onPageEntered") {
        onPageEnteredNode = prop;
      }
    }
  }

  if (name === undefined) {
    addDiag(DescriptorDiagCode.NamePropertyRequired, arg, "`name` property is required.");
  }
  if (onExecuteNode === undefined) {
    addDiag(DescriptorDiagCode.OnExecuteRequired, arg, "`onExecute` method is required.");
  }

  let returnType: string | undefined;
  if (kind === "sensor" && onExecuteNode) {
    returnType = extractReturnType(onExecuteNode, execIsAsync, addDiag);
  }

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  return {
    descriptor: {
      kind,
      name: name!,
      returnType: kind === "sensor" ? returnType : undefined,
      args,
      execIsAsync,
      onExecuteNode: onExecuteNode!,
      onPageEnteredNode,
      label,
      icon,
      iconSpan,
      docs,
      docsSpan,
      tags,
    },
    diagnostics: [],
  };
}

function extractArgs(
  node: ts.Expression,
  addDiag: (code: DescriptorDiagCode, node: ts.Node, message: string) => void
): ExtractedArgSpec[] {
  if (!ts.isArrayLiteralExpression(node)) {
    addDiag(DescriptorDiagCode.ArgsMustBeArrayLiteral, node, "`args` must be an array literal.");
    return [];
  }

  const result: ExtractedArgSpec[] = [];
  for (const elem of node.elements) {
    const spec = extractArgSpec(elem, addDiag);
    if (spec) result.push(spec);
  }
  return result;
}

function extractArgSpec(
  node: ts.Expression,
  addDiag: (code: DescriptorDiagCode, node: ts.Node, message: string) => void
): ExtractedArgSpec | undefined {
  if (!ts.isCallExpression(node)) {
    addDiag(
      DescriptorDiagCode.ArgSpecMustBeCallExpression,
      node,
      "Each arg spec must be a call expression (e.g., `param(...)`, `modifier(...)`, `choice(...)`)."
    );
    return undefined;
  }

  if (!ts.isIdentifier(node.expression)) {
    addDiag(DescriptorDiagCode.UnrecognizedArgSpecCall, node.expression, "Unrecognized arg spec call.");
    return undefined;
  }

  const callee = node.expression.text;
  switch (callee) {
    case "modifier":
      return extractModifierSpec(node, addDiag);
    case "param":
      return extractParamSpec(node, addDiag);
    case "choice":
      return extractChoiceSpec(node, addDiag);
    case "optional":
      return extractOptionalSpec(node, addDiag);
    case "repeated":
      return extractRepeatedSpec(node, addDiag);
    case "conditional":
      return extractConditionalSpec(node, addDiag);
    case "seq":
      return extractSeqSpec(node, addDiag);
    default:
      addDiag(
        DescriptorDiagCode.UnrecognizedArgSpecCall,
        node.expression,
        `Unrecognized arg spec function: \`${callee}\`.`
      );
      return undefined;
  }
}

function extractModifierSpec(
  node: ts.CallExpression,
  addDiag: (code: DescriptorDiagCode, node: ts.Node, message: string) => void
): ExtractedArgSpec | undefined {
  const args = node.arguments;
  if (args.length < 2 || !ts.isStringLiteral(args[0])) {
    addDiag(
      DescriptorDiagCode.ModifierIdMustBeStringLiteral,
      args[0] ?? node,
      "`modifier()` first argument must be a string literal id."
    );
    return undefined;
  }

  const id = args[0].text;

  if (!ts.isObjectLiteralExpression(args[1])) {
    addDiag(
      DescriptorDiagCode.ModifierOptsMustBeObjectLiteral,
      args[1],
      "`modifier()` second argument must be an object literal."
    );
    return undefined;
  }

  let label: string | undefined;
  let icon: string | undefined;

  for (const prop of args[1].properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const propName = getPropertyName(prop);
    if (propName === "label") {
      if (ts.isStringLiteral(prop.initializer)) {
        label = prop.initializer.text;
      } else {
        addDiag(
          DescriptorDiagCode.ModifierLabelMustBeStringLiteral,
          prop.initializer,
          "`modifier()` label must be a string literal."
        );
      }
    } else if (propName === "icon") {
      if (ts.isStringLiteral(prop.initializer)) {
        icon = prop.initializer.text;
      } else {
        addDiag(
          DescriptorDiagCode.ModifierIconMustBeStringLiteral,
          prop.initializer,
          "`modifier()` icon must be a string literal."
        );
      }
    }
  }

  if (label === undefined) {
    addDiag(DescriptorDiagCode.ModifierLabelRequired, args[1], "`modifier()` requires a `label` property.");
    return undefined;
  }

  return { kind: "modifier", id, label, icon };
}

function extractParamSpec(
  node: ts.CallExpression,
  addDiag: (code: DescriptorDiagCode, node: ts.Node, message: string) => void
): ExtractedParam | undefined {
  const args = node.arguments;
  if (args.length < 2 || !ts.isStringLiteral(args[0])) {
    addDiag(
      DescriptorDiagCode.ParamNameMustBeStringLiteral,
      args[0] ?? node,
      "`param()` first argument must be a string literal name."
    );
    return undefined;
  }

  const paramName = args[0].text;

  if (!ts.isObjectLiteralExpression(args[1])) {
    addDiag(
      DescriptorDiagCode.ParamOptsMustBeObjectLiteral,
      args[1],
      "`param()` second argument must be an object literal."
    );
    return undefined;
  }

  let type: string | undefined;
  let defaultValue: number | string | boolean | null | undefined;
  let hasDefault = false;
  let anonymous = false;

  for (const prop of args[1].properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const propName = getPropertyName(prop);

    if (propName === "type") {
      if (ts.isStringLiteral(prop.initializer)) {
        type = prop.initializer.text;
      } else {
        addDiag(
          DescriptorDiagCode.ParamTypeMustBeStringLiteral,
          prop.initializer,
          "Param `type` must be a string literal."
        );
      }
    } else if (propName === "default") {
      hasDefault = true;
      defaultValue = extractLiteralValue(prop.initializer);
      if (defaultValue === undefined && !isNullishLiteral(prop.initializer)) {
        addDiag(
          DescriptorDiagCode.ParamDefaultMustBeLiteral,
          prop.initializer,
          "Param `default` must be a literal value."
        );
      }
    } else if (propName === "anonymous") {
      if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
        anonymous = true;
      } else if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) {
        anonymous = false;
      } else {
        addDiag(
          DescriptorDiagCode.ParamAnonymousMustBeBoolean,
          prop.initializer,
          "Param `anonymous` must be a boolean literal."
        );
      }
    }
  }

  if (type === undefined) {
    addDiag(DescriptorDiagCode.ParamDefinitionMissingType, args[1], "Param definition must have a `type` property.");
    return undefined;
  }

  const result: ExtractedParam = { kind: "param", name: paramName, type, anonymous };
  if (hasDefault) {
    result.defaultValue = defaultValue;
  }
  return result;
}

function extractChoiceSpec(
  node: ts.CallExpression,
  addDiag: (code: DescriptorDiagCode, node: ts.Node, message: string) => void
): ExtractedArgSpec | undefined {
  const args = node.arguments;
  if (args.length === 0) {
    addDiag(DescriptorDiagCode.ChoiceRequiresArguments, node, "`choice()` requires at least one argument.");
    return undefined;
  }

  let name: string | undefined;
  let startIdx = 0;

  if (ts.isStringLiteral(args[0])) {
    name = args[0].text;
    startIdx = 1;
  }

  const items: ExtractedArgSpec[] = [];
  for (let i = startIdx; i < args.length; i++) {
    const spec = extractArgSpec(args[i], addDiag);
    if (spec) items.push(spec);
  }

  if (items.length === 0) {
    addDiag(DescriptorDiagCode.ChoiceRequiresArguments, node, "`choice()` requires at least one spec argument.");
    return undefined;
  }

  return { kind: "choice", name, items };
}

function extractOptionalSpec(
  node: ts.CallExpression,
  addDiag: (code: DescriptorDiagCode, node: ts.Node, message: string) => void
): ExtractedArgSpec | undefined {
  if (node.arguments.length !== 1) {
    addDiag(DescriptorDiagCode.OptionalRequiresOneArgument, node, "`optional()` requires exactly one argument.");
    return undefined;
  }

  const item = extractArgSpec(node.arguments[0], addDiag);
  if (!item) return undefined;
  return { kind: "optional", item };
}

function extractRepeatedSpec(
  node: ts.CallExpression,
  addDiag: (code: DescriptorDiagCode, node: ts.Node, message: string) => void
): ExtractedArgSpec | undefined {
  if (node.arguments.length < 1) {
    addDiag(DescriptorDiagCode.RepeatedRequiresModifier, node, "`repeated()` requires at least one argument.");
    return undefined;
  }

  const item = extractArgSpec(node.arguments[0], addDiag);
  if (!item) return undefined;

  let min: number | undefined;
  let max: number | undefined;

  if (node.arguments.length >= 2) {
    if (!ts.isObjectLiteralExpression(node.arguments[1])) {
      addDiag(
        DescriptorDiagCode.RepeatedOptsMustBeObjectLiteral,
        node.arguments[1],
        "`repeated()` second argument must be an object literal."
      );
      return undefined;
    }
    for (const prop of node.arguments[1].properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const propName = getPropertyName(prop);
      if (propName === "min") {
        if (ts.isNumericLiteral(prop.initializer)) {
          min = Number.parseFloat(prop.initializer.text);
        } else {
          addDiag(
            DescriptorDiagCode.RepeatedBoundMustBeNumericLiteral,
            prop.initializer,
            "`repeated()` `min` must be a numeric literal."
          );
        }
      } else if (propName === "max") {
        if (ts.isNumericLiteral(prop.initializer)) {
          max = Number.parseFloat(prop.initializer.text);
        } else {
          addDiag(
            DescriptorDiagCode.RepeatedBoundMustBeNumericLiteral,
            prop.initializer,
            "`repeated()` `max` must be a numeric literal."
          );
        }
      }
    }
  }

  return { kind: "repeated", item, min, max };
}

function extractConditionalSpec(
  node: ts.CallExpression,
  addDiag: (code: DescriptorDiagCode, node: ts.Node, message: string) => void
): ExtractedArgSpec | undefined {
  if (node.arguments.length < 2) {
    addDiag(
      DescriptorDiagCode.ConditionalRequiresAtLeastTwoArguments,
      node,
      "`conditional()` requires at least two arguments: condition and thenItem."
    );
    return undefined;
  }

  if (!ts.isStringLiteral(node.arguments[0])) {
    addDiag(
      DescriptorDiagCode.ConditionalConditionMustBeStringLiteral,
      node.arguments[0],
      "`conditional()` first argument must be a string literal condition name."
    );
    return undefined;
  }
  const condition = node.arguments[0].text;

  const thenItem = extractArgSpec(node.arguments[1], addDiag);
  if (!thenItem) return undefined;

  let elseItem: ExtractedArgSpec | undefined;
  if (node.arguments.length >= 3) {
    elseItem = extractArgSpec(node.arguments[2], addDiag) ?? undefined;
  }

  return { kind: "conditional", condition, thenItem, elseItem };
}

function extractSeqSpec(
  node: ts.CallExpression,
  addDiag: (code: DescriptorDiagCode, node: ts.Node, message: string) => void
): ExtractedArgSpec | undefined {
  if (node.arguments.length === 0) {
    addDiag(DescriptorDiagCode.SeqRequiresArguments, node, "`seq()` requires at least one argument.");
    return undefined;
  }

  const items: ExtractedArgSpec[] = [];
  for (const a of node.arguments) {
    const spec = extractArgSpec(a, addDiag);
    if (spec) items.push(spec);
  }
  return { kind: "seq", items };
}

function extractReturnType(
  funcNode: ts.FunctionExpression | ts.MethodDeclaration | ts.ArrowFunction,
  isAsync: boolean,
  addDiag: (code: DescriptorDiagCode, node: ts.Node, message: string) => void
): string | undefined {
  const typeNode = funcNode.type;
  if (!typeNode) {
    addDiag(
      DescriptorDiagCode.SensorReturnTypeRequired,
      funcNode,
      "Sensor `onExecute` must have an explicit return type annotation."
    );
    return undefined;
  }

  let effectiveType = typeNode;

  if (isAsync && ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName;
    if (ts.isIdentifier(typeName) && typeName.text === "Promise" && typeNode.typeArguments?.length === 1) {
      effectiveType = typeNode.typeArguments[0];
    }
  }

  const returnTypeName = extractTypeNodeText(effectiveType);
  if (!returnTypeName) {
    addDiag(
      DescriptorDiagCode.SensorReturnTypeRequired,
      typeNode,
      "Sensor `onExecute` return type must be a type name."
    );
    return undefined;
  }

  if (returnTypeName === "void") {
    addDiag(DescriptorDiagCode.SensorReturnTypeMustNotBeVoid, typeNode, "Sensor `onExecute` must not return void.");
    return undefined;
  }

  return returnTypeName;
}

function extractTypeNodeText(typeNode: ts.TypeNode): string | undefined {
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    return typeNode.typeName.text;
  }
  if (typeNode.kind === ts.SyntaxKind.NumberKeyword) return "number";
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return "string";
  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return "boolean";
  if (typeNode.kind === ts.SyntaxKind.VoidKeyword) return "void";

  if (ts.isUnionTypeNode(typeNode)) {
    const nonNullTypes = typeNode.types.filter(
      (t) => t.kind !== ts.SyntaxKind.NullKeyword && t.kind !== ts.SyntaxKind.UndefinedKeyword
    );
    const hasNull = typeNode.types.some(
      (t) => t.kind === ts.SyntaxKind.NullKeyword || t.kind === ts.SyntaxKind.UndefinedKeyword
    );
    if (nonNullTypes.length === 1 && hasNull) {
      const baseName = extractTypeNodeText(nonNullTypes[0]);
      if (baseName) return `${baseName}?`;
    }
  }

  return undefined;
}

function getPropertyName(prop: ts.PropertyAssignment): string | undefined {
  if (ts.isIdentifier(prop.name)) return prop.name.text;
  if (ts.isStringLiteral(prop.name)) return prop.name.text;
  return undefined;
}

function extractLiteralValue(node: ts.Expression): number | string | boolean | null | undefined {
  if (ts.isNumericLiteral(node)) return Number.parseFloat(node.text);
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number.parseFloat(node.operand.text);
  }
  return undefined;
}

function isNullishLiteral(node: ts.Expression): boolean {
  return node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined");
}
