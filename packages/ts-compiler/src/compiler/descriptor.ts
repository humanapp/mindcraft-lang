import ts from "typescript";
import { DescriptorDiagCode } from "./diag-codes.js";
import type { CompileDiagnostic, ExtractedDescriptor, ExtractedParam, SourceSpan } from "./types.js";

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
  let outputType: string | undefined;
  let params: ExtractedParam[] = [];
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

        case "output":
          if (kind !== "sensor") {
            addDiag(DescriptorDiagCode.OutputOnlyValidForSensors, prop, "`output` is only valid for sensors.");
          } else if (ts.isStringLiteral(prop.initializer)) {
            outputType = prop.initializer.text;
          } else {
            addDiag(
              DescriptorDiagCode.OutputMustBeStringLiteral,
              prop.initializer,
              "`output` must be a string literal."
            );
          }
          break;

        case "params":
          params = extractParams(prop.initializer, addDiag);
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
  if (kind === "sensor" && outputType === undefined) {
    addDiag(DescriptorDiagCode.OutputPropertyRequired, arg, "`output` property is required for sensors.");
  }
  if (onExecuteNode === undefined) {
    addDiag(DescriptorDiagCode.OnExecuteRequired, arg, "`onExecute` method is required.");
  }

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  return {
    descriptor: {
      kind,
      name: name!,
      outputType: kind === "sensor" ? outputType : undefined,
      params,
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

function extractParams(
  node: ts.Expression,
  addDiag: (code: DescriptorDiagCode, node: ts.Node, message: string) => void
): ExtractedParam[] {
  if (!ts.isObjectLiteralExpression(node)) {
    addDiag(DescriptorDiagCode.ParamsMustBeObjectLiteral, node, "`params` must be an object literal.");
    return [];
  }

  const params: ExtractedParam[] = [];

  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      addDiag(
        DescriptorDiagCode.ParamEntryMustUsePropertySyntax,
        prop,
        "Param entries must use property assignment syntax."
      );
      continue;
    }

    const paramName = getPropertyName(prop);
    if (paramName === undefined) {
      addDiag(
        DescriptorDiagCode.ParamNameMustBeIdentifier,
        prop.name,
        "Param name must be an identifier or string literal."
      );
      continue;
    }

    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      addDiag(
        DescriptorDiagCode.ParamDefinitionMustBeObjectLiteral,
        prop.initializer,
        "Param definition must be an object literal with `type` and optional `default`."
      );
      continue;
    }

    let type: string | undefined;
    let defaultValue: number | string | boolean | null | undefined;
    let hasDefault = false;
    let anonymous = false;

    for (const paramProp of prop.initializer.properties) {
      if (!ts.isPropertyAssignment(paramProp)) continue;
      const propName = getPropertyName(paramProp);

      if (propName === "type") {
        if (ts.isStringLiteral(paramProp.initializer)) {
          type = paramProp.initializer.text;
        } else {
          addDiag(
            DescriptorDiagCode.ParamTypeMustBeStringLiteral,
            paramProp.initializer,
            "Param `type` must be a string literal."
          );
        }
      } else if (propName === "default") {
        hasDefault = true;
        defaultValue = extractLiteralValue(paramProp.initializer);
        if (defaultValue === undefined && !isNullishLiteral(paramProp.initializer)) {
          addDiag(
            DescriptorDiagCode.ParamDefaultMustBeLiteral,
            paramProp.initializer,
            "Param `default` must be a literal value."
          );
        }
      } else if (propName === "anonymous") {
        if (paramProp.initializer.kind === ts.SyntaxKind.TrueKeyword) {
          anonymous = true;
        } else if (paramProp.initializer.kind === ts.SyntaxKind.FalseKeyword) {
          anonymous = false;
        } else {
          addDiag(
            DescriptorDiagCode.ParamAnonymousMustBeBoolean,
            paramProp.initializer,
            "Param `anonymous` must be a boolean literal."
          );
        }
      }
    }

    if (type === undefined) {
      addDiag(
        DescriptorDiagCode.ParamDefinitionMissingType,
        prop.initializer,
        "Param definition must have a `type` property."
      );
      continue;
    }

    const param: ExtractedParam = {
      name: paramName,
      type,
      required: !hasDefault,
      anonymous,
    };

    if (hasDefault) {
      param.defaultValue = defaultValue;
    }

    params.push(param);
  }

  return params;
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
