import { List } from "@mindcraft-lang/core";
import { compiler, getBrainServices } from "@mindcraft-lang/core/brain";
import ts from "typescript";
import { buildAmbientDeclarations } from "./ambient.js";
import { buildCallDef } from "./call-def-builder.js";
import { extractDescriptor } from "./descriptor.js";
import { CompileDiagCode } from "./diag-codes.js";
import { emitFunction } from "./emit.js";
import type { FunctionEntry, ImportedClass, ImportedFunction, ImportedVariable } from "./lowering.js";
import { lowerProgram, qualifiedClassName } from "./lowering.js";
import type {
  CallSiteInfo,
  CompileDiagnostic,
  CompileOptions,
  DebugFileInfo,
  DebugFunctionInfo,
  DebugMetadata,
  DebugSpan,
  ExtractedDescriptor,
  ExtractedParam,
  LocalInfo,
  ScopeInfo,
  SuspendSiteInfo,
  UserAuthoredProgram,
} from "./types.js";
import { validateAst } from "./validator.js";
import { createVirtualCompilerHost } from "./virtual-host.js";

export interface FunctionDebugInfo {
  funcIndex: number;
  name: string;
  spans: DebugSpan[];
  pcToSpanIndex: number[];
  scopes: ScopeInfo[];
  locals: LocalInfo[];
  callSites: CallSiteInfo[];
  suspendSites: SuspendSiteInfo[];
}

export interface CompileResult {
  diagnostics: CompileDiagnostic[];
  program?: UserAuthoredProgram;
  descriptor?: ExtractedDescriptor;
  functionDebugInfo?: FunctionDebugInfo[];
}

export interface ProjectCompileResult {
  results: Map<string, CompileResult>;
  tsErrors: Map<string, CompileDiagnostic[]>;
}

const LIB_FILE = "/lib/lib.mindcraft.d.ts";

const checkerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2016,
  module: ts.ModuleKind.ES2020,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};

const TESTED_TS_VERSION = "5.9";

let versionChecked = false;

function checkTypeScriptVersion(): void {
  if (versionChecked) return;
  const actual = ts.version;
  const [eMajor, eMinor] = TESTED_TS_VERSION.split(".");
  const [aMajor, aMinor] = actual.split(".");
  if (aMajor !== eMajor || aMinor !== eMinor) {
    throw new Error(
      `TypeScript version mismatch: package was built and tested against ${eMajor}.${eMinor}.x but found ${actual}`
    );
  }
  versionChecked = true;
}

function toCompilerPath(vfsPath: string): string {
  if (vfsPath.startsWith("/")) return vfsPath;
  return `/${vfsPath}`;
}

function toVfsPath(compilerPath: string): string {
  if (compilerPath.startsWith("/")) return compilerPath.slice(1);
  return compilerPath;
}

function isUserTsFile(path: string): boolean {
  return path.endsWith(".ts") && !path.endsWith(".d.ts");
}

export class UserTileProject {
  private _files = new Map<string, string>();
  private _ambientSource: string;

  constructor(options?: CompileOptions) {
    this._ambientSource = options?.ambientSource ?? buildAmbientDeclarations();
  }

  setFiles(files: ReadonlyMap<string, string>): void {
    this._files.clear();
    for (const [path, content] of files) {
      this._files.set(path, content);
    }
  }

  updateFile(path: string, content: string): void {
    this._files.set(path, content);
  }

  deleteFile(path: string): void {
    this._files.delete(path);
  }

  renameFile(oldPath: string, newPath: string): void {
    const content = this._files.get(oldPath);
    if (content !== undefined) {
      this._files.delete(oldPath);
      this._files.set(newPath, content);
    }
  }

  compileAll(): ProjectCompileResult {
    return this._compile();
  }

  compileAffected(): ProjectCompileResult {
    return this._compile();
  }

  private _compile(): ProjectCompileResult {
    checkTypeScriptVersion();

    const compilerFiles = new Map<string, string>();

    const userRootFiles: string[] = [];
    for (const [vfsPath, content] of this._files) {
      if (vfsPath === "mindcraft.d.ts" || vfsPath === "/mindcraft.d.ts") {
        compilerFiles.set(LIB_FILE, content);
        continue;
      }
      const cp = toCompilerPath(vfsPath);
      compilerFiles.set(cp, content);
      if (isUserTsFile(vfsPath)) {
        userRootFiles.push(cp);
      }
    }

    if (!compilerFiles.has(LIB_FILE)) {
      compilerFiles.set(LIB_FILE, this._ambientSource);
    }

    if (userRootFiles.length === 0) {
      return { results: new Map(), tsErrors: new Map() };
    }

    const host = createVirtualCompilerHost(compilerFiles, checkerOptions);
    const tsProgram = ts.createProgram(userRootFiles, checkerOptions, host);
    const tsDiagnostics = ts.getPreEmitDiagnostics(tsProgram);

    const tsErrors = new Map<string, CompileDiagnostic[]>();
    for (const d of tsDiagnostics) {
      const fileName = d.file?.fileName;
      if (fileName === LIB_FILE) continue;
      const vfsKey = fileName ? toVfsPath(fileName) : "<global>";
      const severity =
        d.category === ts.DiagnosticCategory.Warning
          ? ("warning" as const)
          : d.category === ts.DiagnosticCategory.Message || d.category === ts.DiagnosticCategory.Suggestion
            ? ("info" as const)
            : ("error" as const);
      const diag: CompileDiagnostic = {
        code: CompileDiagCode.TypeScriptError,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        severity,
      };
      if (d.file && d.start !== undefined) {
        const start = d.file.getLineAndCharacterOfPosition(d.start);
        diag.line = start.line + 1;
        diag.column = start.character + 1;
        if (d.length !== undefined) {
          const end = d.file.getLineAndCharacterOfPosition(d.start + d.length);
          diag.endLine = end.line + 1;
          diag.endColumn = end.character + 1;
        }
      }
      let arr = tsErrors.get(vfsKey);
      if (!arr) {
        arr = [];
        tsErrors.set(vfsKey, arr);
      }
      arr.push(diag);
    }

    if (tsErrors.size > 0) {
      return { results: new Map(), tsErrors };
    }

    const checker = tsProgram.getTypeChecker();
    const results = new Map<string, CompileResult>();

    getBrainServices().types.removeUserTypes();

    for (const compilerPath of userRootFiles) {
      const sourceFile = tsProgram.getSourceFile(compilerPath);
      if (!sourceFile) continue;

      if (!hasDefaultExport(sourceFile)) continue;

      const extractionResult = extractDescriptor(sourceFile);
      if (!extractionResult.descriptor) {
        const vfsPath = toVfsPath(compilerPath);
        results.set(vfsPath, { diagnostics: extractionResult.diagnostics });
        continue;
      }

      const vfsPath = toVfsPath(compilerPath);
      const result = this._compileEntryPoint(
        sourceFile,
        extractionResult.descriptor,
        checker,
        tsProgram,
        compilerFiles
      );
      results.set(vfsPath, result);
    }

    return { results, tsErrors };
  }

  private _compileEntryPoint(
    sourceFile: ts.SourceFile,
    descriptor: ExtractedDescriptor,
    checker: ts.TypeChecker,
    tsProgram: ts.Program,
    compilerFiles: Map<string, string>
  ): CompileResult {
    const validationDiags = validateAst(sourceFile);
    if (validationDiags.length > 0) {
      return { diagnostics: validationDiags };
    }

    const imported = collectImports(sourceFile, checker, tsProgram, compilerFiles);
    if (imported.diagnostics.length > 0) {
      return { diagnostics: imported.diagnostics };
    }

    const programResult = lowerProgram(
      sourceFile,
      descriptor,
      checker,
      imported.functions,
      imported.variables,
      imported.moduleInitOrder,
      imported.classes
    );
    if (programResult.diagnostics.length > 0) {
      return { diagnostics: programResult.diagnostics };
    }

    const pool = new compiler.ConstantPool();
    const emittedFunctions: ReturnType<typeof emitFunction>["bytecode"][] = [];
    const functionDebugInfo: FunctionDebugInfo[] = [];

    for (let funcIdx = 0; funcIdx < programResult.functions.length; funcIdx++) {
      const func = programResult.functions[funcIdx];
      const emitResult = emitFunction(
        func.ir,
        func.numParams,
        func.numLocals,
        func.name,
        pool,
        programResult.functionTable,
        func.injectCtxTypeId,
        func.scopeMetadata,
        func.localMetadata
      );
      if (emitResult.diagnostics.length > 0) {
        return { diagnostics: emitResult.diagnostics };
      }
      emittedFunctions.push(emitResult.bytecode);
      functionDebugInfo.push({
        funcIndex: funcIdx,
        name: func.name,
        spans: emitResult.spans,
        pcToSpanIndex: emitResult.pcToSpanIndex,
        scopes: emitResult.scopes,
        locals: emitResult.locals,
        callSites: emitResult.callSites,
        suspendSites: emitResult.suspendSites,
      });
    }

    const qualifiedParams = qualifyDescriptorParams(descriptor.params, sourceFile);
    const qualifiedOutputType = descriptor.outputType
      ? qualifyDescriptorType(descriptor.outputType, sourceFile)
      : undefined;

    const callDef = buildCallDef(descriptor.name, qualifiedParams);
    const outputType = qualifiedOutputType ? getBrainServices().types.resolveByName(qualifiedOutputType) : undefined;
    if (qualifiedOutputType && !outputType) {
      return {
        diagnostics: [
          {
            code: CompileDiagCode.UnknownOutputType,
            message: `Unknown output type: "${descriptor.outputType}"`,
            severity: "error",
          },
        ],
      };
    }

    const funcs = programResult.functions;
    for (const func of funcs) {
      if (!func.sourceFileName) {
        func.sourceFileName = sourceFile.fileName;
      }
    }

    const debugMetadata = assembleDebugMetadata(funcs, functionDebugInfo, compilerFiles);

    const program: UserAuthoredProgram = {
      version: 1,
      functions: List.from(emittedFunctions),
      constants: pool.getConstants(),
      variableNames: List.empty(),
      entryPoint: programResult.entryFuncId,
      kind: descriptor.kind,
      name: descriptor.name,
      callDef,
      outputType,
      numStateSlots: programResult.numStateSlots,
      entryFuncId: programResult.entryFuncId,
      initFuncId: programResult.initFuncId,
      execIsAsync: descriptor.execIsAsync,
      lifecycleFuncIds: {
        onPageEntered: programResult.onPageEnteredWrapperId,
      },
      programRevisionId: generateRevisionId(),
      params: qualifiedParams,
      debugMetadata,
    };

    return { diagnostics: [], program, descriptor, functionDebugInfo };
  }
}

function qualifyDescriptorType(typeName: string, sourceFile: ts.SourceFile): string {
  const types = getBrainServices().types;
  if (types.resolveByName(typeName)) return typeName;
  const qualified = qualifiedClassName(sourceFile.fileName, typeName);
  if (types.resolveByName(qualified)) return qualified;
  return typeName;
}

function qualifyDescriptorParams(params: ExtractedParam[], sourceFile: ts.SourceFile): ExtractedParam[] {
  return params.map((p) => {
    const qualifiedType = qualifyDescriptorType(p.type, sourceFile);
    if (qualifiedType === p.type) return p;
    return { ...p, type: qualifiedType };
  });
}

function assembleDebugMetadata(
  functions: FunctionEntry[],
  debugInfos: FunctionDebugInfo[],
  compilerFiles: Map<string, string>
): DebugMetadata {
  const fileMap = new Map<string, number>();
  const debugFiles: DebugFileInfo[] = [];

  for (const func of functions) {
    const fn = func.sourceFileName;
    if (fn && !fileMap.has(fn)) {
      const fileIndex = fileMap.size;
      fileMap.set(fn, fileIndex);
      const content = compilerFiles.get(fn) ?? "";
      debugFiles.push({
        fileIndex,
        path: toVfsPath(fn),
        sourceHash: simpleHash(content),
      });
    }
  }

  const debugFunctions: DebugFunctionInfo[] = [];
  for (let i = 0; i < functions.length; i++) {
    const func = functions[i];
    const fdi = debugInfos[i];
    const fileIndex = func.sourceFileName ? (fileMap.get(func.sourceFileName) ?? 0) : 0;
    const filePath = func.sourceFileName ? toVfsPath(func.sourceFileName) : "";
    const debugFunctionId = buildDebugFunctionId(filePath, func);
    const sourceSpan = functionSourceSpan(func, fdi);

    debugFunctions.push({
      debugFunctionId,
      compiledFuncId: i,
      fileIndex,
      prettyName: func.name,
      isGenerated: func.isGenerated ?? false,
      sourceSpan,
      spans: fdi.spans,
      pcToSpanIndex: fdi.pcToSpanIndex,
      scopes: fdi.scopes,
      locals: fdi.locals,
      callSites: fdi.callSites,
      suspendSites: fdi.suspendSites,
    });
  }

  return { files: debugFiles, functions: debugFunctions };
}

function buildDebugFunctionId(filePath: string, func: FunctionEntry): string {
  const name = func.name;
  if (name === "<module-init>") return `${filePath}/<init>`;
  if (name.endsWith(".<onPageEntered-wrapper>")) return `${filePath}/<onPageEntered-wrapper>`;
  if (name.startsWith("<closure#")) {
    if (func.parentName) {
      return `${filePath}/${func.parentName}/${name}`;
    }
    return `${filePath}/${name}`;
  }
  if (name.endsWith("$new")) {
    const className = name.slice(0, -4);
    return `${filePath}/${className}.constructor`;
  }
  return `${filePath}/${name}`;
}

function functionSourceSpan(func: FunctionEntry, fdi: FunctionDebugInfo): DebugSpan {
  if (func.functionSpan) {
    return {
      spanId: 0,
      startLine: func.functionSpan.startLine,
      startColumn: func.functionSpan.startColumn,
      endLine: func.functionSpan.endLine,
      endColumn: func.functionSpan.endColumn,
      isStatementBoundary: false,
    };
  }
  if (fdi.spans.length > 0) {
    return fdi.spans[0];
  }
  return { spanId: 0, startLine: 0, startColumn: 0, endLine: 0, endColumn: 0, isStatementBoundary: false };
}

function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

interface CollectResult {
  functions: ImportedFunction[];
  variables: ImportedVariable[];
  classes: ImportedClass[];
  moduleInitOrder: string[];
  diagnostics: CompileDiagnostic[];
}

function collectImports(
  entryFile: ts.SourceFile,
  checker: ts.TypeChecker,
  tsProgram: ts.Program,
  compilerFiles: Map<string, string>
): CollectResult {
  const functions: ImportedFunction[] = [];
  const variables: ImportedVariable[] = [];
  const classes: ImportedClass[] = [];
  const diagnostics: CompileDiagnostic[] = [];
  const visitedFiles = new Set<string>();
  const moduleInitOrder: string[] = [];
  visitedFiles.add(entryFile.fileName);

  function visitFile(sourceFile: ts.SourceFile): void {
    if (visitedFiles.has(sourceFile.fileName)) return;
    visitedFiles.add(sourceFile.fileName);

    for (const stmt of sourceFile.statements) {
      if (ts.isImportDeclaration(stmt)) {
        const importedFile = resolveImportedSourceFile(stmt, sourceFile, tsProgram, compilerFiles);
        if (importedFile) {
          visitFile(importedFile);
        }
      }
    }

    for (const stmt of sourceFile.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name && hasExportModifier(stmt)) {
        functions.push({ localName: stmt.name.text, node: stmt });
      }
      if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            variables.push({
              name: decl.name.text,
              initializer: decl.initializer,
              sourceModule: sourceFile.fileName,
            });
          }
        }
      }
      if (ts.isClassDeclaration(stmt) && stmt.name && hasExportModifier(stmt)) {
        classes.push({ node: stmt, name: stmt.name.text, sourceFile });
      }
    }

    moduleInitOrder.push(sourceFile.fileName);
  }

  for (const stmt of entryFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const importClause = stmt.importClause;
    if (!importClause) continue;

    const importedFile = resolveImportedSourceFile(stmt, entryFile, tsProgram, compilerFiles);
    if (importedFile) {
      visitFile(importedFile);
    }

    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const specifier of importClause.namedBindings.elements) {
        const localName = specifier.name.text;
        const sym = checker.getSymbolAtLocation(specifier.name);
        if (!sym) continue;
        const aliased = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
        if (!(aliased.flags & ts.SymbolFlags.Function)) continue;

        const decls = aliased.getDeclarations();
        if (!decls || decls.length === 0) continue;
        const funcDecl = decls[0];
        if (!ts.isFunctionDeclaration(funcDecl)) continue;

        const declaredName = funcDecl.name?.text;
        if (declaredName && localName !== declaredName) {
          const existing = functions.find((f) => f.node === funcDecl);
          if (existing) {
            functions.push({ localName, node: funcDecl });
          }
        }
      }
    }
  }

  const funcSources = new Map<string, string>();
  for (const fn of functions) {
    const source = fn.node.getSourceFile().fileName;
    const existing = funcSources.get(fn.localName);
    if (existing && existing !== source) {
      diagnostics.push({
        code: CompileDiagCode.DuplicateImportedSymbol,
        message: `Duplicate imported symbol '${fn.localName}' from '${existing}' and '${source}'`,
        severity: "error",
      });
    } else {
      funcSources.set(fn.localName, source);
    }
  }

  const varSources = new Map<string, string>();
  for (const v of variables) {
    const existing = varSources.get(v.name);
    if (existing && existing !== v.sourceModule) {
      diagnostics.push({
        code: CompileDiagCode.DuplicateImportedSymbol,
        message: `Duplicate imported symbol '${v.name}' from '${existing}' and '${v.sourceModule}'`,
        severity: "error",
      });
    } else {
      varSources.set(v.name, v.sourceModule);
    }
  }

  const classSources = new Map<string, string>();
  for (const c of classes) {
    const source = c.sourceFile.fileName;
    const existing = classSources.get(c.name);
    if (existing && existing !== source) {
      diagnostics.push({
        code: CompileDiagCode.DuplicateImportedSymbol,
        message: `Duplicate imported symbol '${c.name}' from '${existing}' and '${source}'`,
        severity: "error",
      });
    } else {
      classSources.set(c.name, source);
    }
  }

  return { functions, variables, classes, moduleInitOrder, diagnostics };
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function resolveImportedSourceFile(
  importDecl: ts.ImportDeclaration,
  containingFile: ts.SourceFile,
  tsProgram: ts.Program,
  compilerFiles: Map<string, string>
): ts.SourceFile | undefined {
  if (!ts.isStringLiteral(importDecl.moduleSpecifier)) return undefined;
  const specifier = importDecl.moduleSpecifier.text;

  let resolvedPath: string | undefined;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const containingDir = containingFile.fileName.substring(0, containingFile.fileName.lastIndexOf("/"));
    const base = resolvePath(containingDir, specifier);
    const candidates = [`${base}.ts`, `${base}.d.ts`, `${base}/index.ts`, `${base}/index.d.ts`];
    for (const c of candidates) {
      if (compilerFiles.has(c)) {
        resolvedPath = c;
        break;
      }
    }
  }

  if (!resolvedPath) return undefined;
  return tsProgram.getSourceFile(resolvedPath);
}

function resolvePath(base: string, relative: string): string {
  const segments = base.split("/").filter((s) => s.length > 0);
  for (const part of relative.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return `/${segments.join("/")}`;
}

function hasDefaultExport(sourceFile: ts.SourceFile): boolean {
  for (const stmt of sourceFile.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      return true;
    }
  }
  return false;
}

function generateRevisionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
