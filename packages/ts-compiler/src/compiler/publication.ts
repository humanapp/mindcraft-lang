/**
 * Entry-module publication: a project's public symbol surface. The name-keyed
 * declarations (StructType, System, classes, interfaces, type aliases, enums)
 * a project's entry module (`index.ts`) exports are published under public
 * `<namespace>::<name>` keys -- added aliases of their private registrations,
 * so one declaration keeps one type id however it is referenced. Publication
 * enforces two rules: a declaration is published under exactly one name, and
 * the published surface's type closure is itself published (a published type
 * or tile may not reference an unpublished name-keyed type).
 */

import type { BrainServices } from "@mindcraft-lang/core/brain";
import type {
  FunctionTypeDef,
  ListTypeDef,
  MapTypeDef,
  NullableTypeDef,
  StructTypeDef,
  TypeDef,
  TypeId,
  UnionTypeDef,
} from "@mindcraft-lang/core/runtime";
import { NativeType } from "@mindcraft-lang/core/runtime";
import ts from "typescript";
import { collectParams } from "./arg-spec-utils.js";
import { CompileDiagCode } from "./diag-codes.js";
import { qualifiedDeclarationName } from "./extension-mounts.js";
import { type GatheredNamedDeclarations, registerGatheredNamedDeclarations, systemConfigObject } from "./lowering.js";
import { parseQualifiedClassName, publicSymbolKey } from "./symbol-keys.js";
import { structTypeCallExpression } from "./type-ref.js";
import type { CompileDiagnostic, UserAuthoredProgram } from "./types.js";

/** Compiler path of a project's entry module. A project without one publishes nothing. */
export const ENTRY_MODULE_COMPILER_PATH = "/index.ts";

const ENTRY_MODULE_WORKSPACE_PATH = "index.ts";

/** Inputs to {@link publishEntryModule}. */
export interface PublishEntryArgs {
  tsProgram: ts.Program;
  checker: ts.TypeChecker;
  services: BrainServices;
  projectNamespace: string;
  /** Compiled tile programs keyed by workspace path, for the tile-surface closure check. */
  programsByFile: ReadonlyMap<string, UserAuthoredProgram>;
  /** Type ids published by roots compiled earlier in the session. */
  sessionPublishedTypeIds?: ReadonlySet<TypeId>;
  /** Gathers the name-keyed declarations reachable from the entry module. */
  gatherEntryDeclarations: (entry: ts.SourceFile) => GatheredNamedDeclarations;
}

/** Result of {@link publishEntryModule}. */
export interface PublicationResult {
  /** Public key -> the published declaration's type id, for every published symbol with a registered type. */
  publishedTypes: Map<string, TypeId>;
  /** Publication diagnostics keyed by workspace path. */
  diagnosticsByFile: Map<string, CompileDiagnostic[]>;
}

interface PublishedDecl {
  exportedName: string;
  decl: ts.Declaration;
  bindingName: string;
  /** The `System({...})` config when the declaration is a System binding. */
  systemConfig?: ts.ObjectLiteralExpression;
}

/**
 * Publish the project's entry-module surface into the live registry: classify
 * the entry's exports, register the reachable name-keyed declarations, add a
 * public-key alias for each published declaration's type, and run the
 * single-published-name and type-closure checks. A project with no entry
 * module publishes nothing and is untouched.
 */
export function publishEntryModule(args: PublishEntryArgs): PublicationResult {
  const result: PublicationResult = { publishedTypes: new Map(), diagnosticsByFile: new Map() };
  const entry = args.tsProgram.getSourceFile(ENTRY_MODULE_COMPILER_PATH);
  if (!entry) return result;
  const moduleSymbol = args.checker.getSymbolAtLocation(entry);
  if (!moduleSymbol) return result;

  const pushDiag = (workspacePath: string, diag: CompileDiagnostic): void => {
    let diags = result.diagnosticsByFile.get(workspacePath);
    if (!diags) {
      diags = [];
      result.diagnosticsByFile.set(workspacePath, diags);
    }
    diags.push(diag);
  };

  const published = classifyEntryExports(moduleSymbol, args.checker);

  const namesByDecl = new Map<ts.Declaration, string[]>();
  for (const p of published) {
    const names = namesByDecl.get(p.decl);
    if (names) {
      names.push(p.exportedName);
    } else {
      namesByDecl.set(p.decl, [p.exportedName]);
    }
  }
  const multiNamed = new Set<ts.Declaration>();
  for (const [decl, names] of namesByDecl) {
    if (names.length < 2) continue;
    multiNamed.add(decl);
    pushDiag(ENTRY_MODULE_WORKSPACE_PATH, {
      code: CompileDiagCode.MultiplePublishedNames,
      message: `'${declBindingName(decl) ?? names[0]}' is exported from the entry module under ${names.length} names (${names.map((n) => `"${n}"`).join(", ")}). A declaration is published under exactly one name; export it once.`,
      severity: "error",
    });
  }

  const registrationDiags: CompileDiagnostic[] = [];
  const gathered = args.gatherEntryDeclarations(entry);
  const registration = registerGatheredNamedDeclarations(
    gathered,
    args.checker,
    args.services,
    args.projectNamespace,
    registrationDiags
  );
  for (const diag of registrationDiags) {
    pushDiag(ENTRY_MODULE_WORKSPACE_PATH, diag);
  }

  const types = args.services.runtime.types;
  const ownPublished = new Set<TypeId>();
  for (const p of published) {
    if (multiNamed.has(p.decl)) continue;
    const typeId = p.systemConfig
      ? registration.systemStateTypes.get(p.systemConfig)
      : types.resolveByName(
          qualifiedDeclarationName(args.projectNamespace, p.decl.getSourceFile().fileName, p.bindingName)
        );
    if (typeId === undefined) continue;
    ownPublished.add(typeId);
    if (p.systemConfig) continue;
    const key = publicSymbolKey(args.projectNamespace, p.exportedName);
    types.addTypeNameAlias(key, typeId);
    result.publishedTypes.set(key, typeId);
  }

  const closure = new ClosureChecker(
    args.services,
    args.projectNamespace,
    ownPublished,
    args.sessionPublishedTypeIds ?? new Set()
  );
  for (const p of published) {
    if (multiNamed.has(p.decl)) continue;
    const typeId = p.systemConfig
      ? registration.systemStateTypes.get(p.systemConfig)
      : types.resolveByName(
          qualifiedDeclarationName(args.projectNamespace, p.decl.getSourceFile().fileName, p.bindingName)
        );
    if (typeId === undefined) continue;
    for (const violation of closure.referencedViolations(typeId)) {
      pushDiag(ENTRY_MODULE_WORKSPACE_PATH, closureDiagnostic(`published type '${p.exportedName}'`, violation));
    }
  }

  for (const [workspacePath, program] of args.programsByFile) {
    for (const typeId of tileSurfaceTypes(program, args.services)) {
      for (const violation of closure.violations(typeId)) {
        pushDiag(workspacePath, closureDiagnostic(`tile '${program.name}'`, violation));
      }
    }
  }

  return result;
}

function declBindingName(decl: ts.Declaration): string | undefined {
  if (
    (ts.isClassDeclaration(decl) ||
      ts.isEnumDeclaration(decl) ||
      ts.isInterfaceDeclaration(decl) ||
      ts.isTypeAliasDeclaration(decl) ||
      ts.isVariableDeclaration(decl)) &&
    decl.name &&
    ts.isIdentifier(decl.name)
  ) {
    return decl.name.text;
  }
  return undefined;
}

/** The entry module's exports that are name-keyed declarations, under their entry-exported names. */
function classifyEntryExports(moduleSymbol: ts.Symbol, checker: ts.TypeChecker): PublishedDecl[] {
  const published: PublishedDecl[] = [];
  for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
    const exportedName = exportSymbol.getName();
    if (exportedName === "default") continue;
    const target = exportSymbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exportSymbol) : exportSymbol;
    const decl = target.getDeclarations()?.[0];
    if (!decl || decl.getSourceFile().isDeclarationFile) continue;
    const bindingName = declBindingName(decl);
    if (bindingName === undefined) continue;
    if (
      ts.isClassDeclaration(decl) ||
      ts.isEnumDeclaration(decl) ||
      ts.isInterfaceDeclaration(decl) ||
      ts.isTypeAliasDeclaration(decl)
    ) {
      published.push({ exportedName, decl, bindingName });
      continue;
    }
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      if (structTypeCallExpression(decl.initializer)) {
        published.push({ exportedName, decl, bindingName });
        continue;
      }
      const systemConfig = systemConfigObject(decl.initializer);
      if (systemConfig) {
        published.push({ exportedName, decl, bindingName, systemConfig });
      }
    }
  }
  return published;
}

/** A name-keyed type reached by a closure walk that its declaring project does not publish. */
interface ClosureViolation {
  namespace: string;
  fileName: string;
  binding: string;
  foreign: boolean;
}

/**
 * Walks the types a registered type's shape references (struct fields, union
 * members, list elements, map keys and values, function signatures, nullable
 * bases) and yields every name-keyed type that is not published: an own-
 * namespace type missing from the published set, or another root's type
 * missing from the session's published set.
 */
class ClosureChecker {
  constructor(
    private readonly services: BrainServices,
    private readonly namespace: string,
    private readonly ownPublished: ReadonlySet<TypeId>,
    private readonly sessionPublished: ReadonlySet<TypeId>
  ) {}

  /** Violations for a type standing on a surface directly (a tile's return, param, or output type). */
  violations(typeId: TypeId): ClosureViolation[] {
    const found: ClosureViolation[] = [];
    this.check(typeId, new Set(), found);
    return found;
  }

  /** Violations among the types a published type's own shape references. */
  referencedViolations(typeId: TypeId): ClosureViolation[] {
    const found: ClosureViolation[] = [];
    const def = this.services.runtime.types.get(typeId);
    if (def) {
      this.walkReferenced(def, new Set([typeId]), found);
    }
    return found;
  }

  private check(typeId: TypeId, visited: Set<TypeId>, found: ClosureViolation[]): void {
    if (visited.has(typeId)) return;
    visited.add(typeId);
    const def = this.services.runtime.types.get(typeId);
    if (!def) return;
    if (def.nullable) {
      this.check((def as NullableTypeDef).baseTypeId, visited, found);
      return;
    }
    const parts = parseQualifiedClassName(def.name);
    if (parts) {
      const published =
        parts.namespace === this.namespace ? this.ownPublished.has(typeId) : this.sessionPublished.has(typeId);
      if (!published) {
        found.push({ ...parts, foreign: parts.namespace !== this.namespace });
      }
      return;
    }
    this.walkReferenced(def, visited, found);
  }

  private walkReferenced(def: TypeDef, visited: Set<TypeId>, found: ClosureViolation[]): void {
    if (def.nullable) {
      this.check((def as NullableTypeDef).baseTypeId, visited, found);
      return;
    }
    switch (def.coreType) {
      case NativeType.Struct:
        (def as StructTypeDef).fields.forEach((field) => {
          this.check(field.typeId, visited, found);
        });
        return;
      case NativeType.Union:
        (def as UnionTypeDef).memberTypeIds.forEach((member) => {
          this.check(member, visited, found);
        });
        return;
      case NativeType.List:
        this.check((def as ListTypeDef).elementTypeId, visited, found);
        return;
      case NativeType.Map:
        this.check((def as MapTypeDef).keyTypeId, visited, found);
        this.check((def as MapTypeDef).valueTypeId, visited, found);
        return;
      case NativeType.Function: {
        const fn = def as FunctionTypeDef;
        if (fn.paramTypeIds) {
          fn.paramTypeIds.forEach((param) => {
            this.check(param, visited, found);
          });
          this.check(fn.returnTypeId, visited, found);
        }
        return;
      }
      default:
        return;
    }
  }
}

function closureDiagnostic(subject: string, violation: ClosureViolation): CompileDiagnostic {
  const message = violation.foreign
    ? `The ${subject} references type '${violation.binding}' from "${violation.namespace}", which that project does not publish.`
    : `The ${subject} references type '${violation.binding}' (declared in ${violation.fileName}), which is not exported from the entry module. Export it from the entry module to publish it.`;
  return { code: CompileDiagCode.UnpublishedTypeReference, message, severity: "error" };
}

/** The registered type ids standing on a compiled tile's surface: return, WHEN-result, conversion pair, params, and outputs. */
function tileSurfaceTypes(program: UserAuthoredProgram, services: BrainServices): TypeId[] {
  const types = services.runtime.types;
  const surface: TypeId[] = [];
  if (program.outputType !== undefined) surface.push(program.outputType);
  if (program.consumesWhenResult !== undefined) surface.push(program.consumesWhenResult);
  if (program.conversion) {
    surface.push(program.conversion.fromType, program.conversion.toType);
  }
  for (const param of collectParams(program.args)) {
    const typeId = types.resolveByName(param.type);
    if (typeId !== undefined) surface.push(typeId);
  }
  for (const output of program.outputs ?? []) {
    const typeId = output.type !== undefined ? types.resolveByName(output.type) : undefined;
    if (typeId !== undefined) surface.push(typeId);
  }
  return surface;
}
