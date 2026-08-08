#!/usr/bin/env node

// Fails when a function-valued member is declared method-style on one side of
// an `implements` or `extends` relationship and property-style on the other.
//
// roblox-ts picks the Luau call convention from the DECLARED type: a method
// emits `function C:name(...)` and is called with a colon, while a
// function-typed property emits a plain field and is called with a dot. When a
// class implements an interface member in the opposite style, calls made
// through the interface pass the first argument where `self` belongs. TypeScript
// accepts both spellings, Biome accepts both, and the Node suite cannot tell
// them apart because JavaScript has no colon/dot distinction -- the fault only
// appears on Luau.

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.join(__dirname, "..");
const configPath = path.join(projectRoot, "tsconfig.rbx.json");

/** Declaration kinds this check distinguishes. */
const METHOD = "method";
const PROPERTY = "function-valued property";

/**
 * Classifies a declaration as method-style, property-style, or not
 * function-valued at all.
 *
 * @param {ts.Declaration} declaration
 * @returns {string | undefined}
 */
function callStyleOf(declaration) {
  if (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration)) {
    return METHOD;
  }
  if (ts.isPropertyDeclaration(declaration)) {
    if (declaration.initializer !== undefined) {
      return ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)
        ? PROPERTY
        : undefined;
    }
    return declaration.type !== undefined && ts.isFunctionTypeNode(declaration.type) ? PROPERTY : undefined;
  }
  if (ts.isPropertySignature(declaration)) {
    return declaration.type !== undefined && ts.isFunctionTypeNode(declaration.type) ? PROPERTY : undefined;
  }
  return undefined;
}

/**
 * Resolves the declared style of `name` on `type`, following the type's own
 * inheritance chain.
 *
 * @param {ts.TypeChecker} checker
 * @param {ts.Type} type
 * @param {string} name
 * @returns {{ style: string, declaration: ts.Declaration } | undefined}
 */
function inheritedStyle(checker, type, name) {
  const property = checker.getPropertyOfType(type, name);
  const declarations = property?.declarations ?? [];
  for (const declaration of declarations) {
    const style = callStyleOf(declaration);
    if (style !== undefined) {
      return { style, declaration };
    }
  }
  return undefined;
}

/**
 * @param {ts.Node} node
 * @returns {string}
 */
function locate(node) {
  const sourceFile = node.getSourceFile();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(projectRoot, sourceFile.fileName)}:${line + 1}:${character + 1}`;
}

/**
 * @param {ts.NamedDeclaration} member
 * @returns {string | undefined}
 */
function memberName(member) {
  return member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : undefined;
}

function main() {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();

  const mismatches = [];
  let membersChecked = 0;

  /**
   * @param {ts.ClassDeclaration | ts.InterfaceDeclaration} container
   * @param {ts.SyntaxKind} heritageToken
   */
  function compareAgainstHeritage(container, heritageToken) {
    for (const clause of container.heritageClauses ?? []) {
      if (clause.token !== heritageToken) continue;
      for (const baseExpression of clause.types) {
        const baseType = checker.getTypeAtLocation(baseExpression);
        for (const member of container.members) {
          const name = memberName(member);
          if (name === undefined) continue;
          const ownStyle = callStyleOf(member);
          if (ownStyle === undefined) continue;
          const base = inheritedStyle(checker, baseType, name);
          if (base === undefined) continue;
          membersChecked += 1;
          if (base.style !== ownStyle) {
            mismatches.push(
              `${locate(member)} ${container.name?.text ?? "<anonymous>"}.${name} is a ${ownStyle}, but ` +
                `${baseExpression.expression.getText()}.${name} at ${locate(base.declaration)} is a ${base.style}`
            );
          }
        }
      }
    }
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (!sourceFile.fileName.startsWith(path.join(projectRoot, "src"))) continue;
    ts.forEachChild(sourceFile, function visit(node) {
      if (ts.isClassDeclaration(node)) {
        compareAgainstHeritage(node, ts.SyntaxKind.ImplementsKeyword);
      } else if (ts.isInterfaceDeclaration(node)) {
        compareAgainstHeritage(node, ts.SyntaxKind.ExtendsKeyword);
      }
      ts.forEachChild(node, visit);
    });
  }

  if (mismatches.length > 0) {
    for (const mismatch of mismatches) {
      process.stderr.write(`${mismatch}\n`);
    }
    process.stderr.write(`call-style check: ${mismatches.length} mismatch(es) across ${membersChecked} members.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Checked ${membersChecked} inherited members. No call-style mismatches.\n`);
}

if (!fs.existsSync(configPath)) {
  throw new Error(`missing ${configPath}`);
}
main();
