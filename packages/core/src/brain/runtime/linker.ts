import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import type {
  ActionDescriptor,
  ExecutableAction,
  ExecutableBrainProgram,
  IBrainActionTileDef,
  IBrainDef,
  IBrainRuleDef,
  IBrainTileDef,
  ITileCatalog,
  ResolvedAction,
  UnlinkedBrainProgram,
} from "../interfaces";
import type { BrainActionResolver } from "../interfaces/runtime";

function isActionTileDef(tileDef: IBrainTileDef): tileDef is IBrainActionTileDef {
  return tileDef.kind === "sensor" || tileDef.kind === "actuator";
}

function addDescriptor(descriptors: Dict<string, ActionDescriptor>, descriptor: ActionDescriptor): void {
  if (!descriptors.has(descriptor.key)) {
    descriptors.set(descriptor.key, descriptor);
  }
}

function collectTileDescriptors(
  tileDefs: ReadonlyList<IBrainTileDef>,
  descriptors: Dict<string, ActionDescriptor>
): void {
  for (let i = 0; i < tileDefs.size(); i++) {
    const tileDef = tileDefs.get(i)!;
    if (isActionTileDef(tileDef)) {
      addDescriptor(descriptors, tileDef.action);
    }
  }
}

function collectRuleDescriptors(ruleDef: IBrainRuleDef, descriptors: Dict<string, ActionDescriptor>): void {
  collectTileDescriptors(ruleDef.when().tiles(), descriptors);
  collectTileDescriptors(ruleDef.do().tiles(), descriptors);

  const children = ruleDef.children();
  for (let i = 0; i < children.size(); i++) {
    collectRuleDescriptors(children.get(i)!, descriptors);
  }
}

function buildActionDescriptorIndex(
  brainDef: IBrainDef,
  catalogs: ReadonlyList<ITileCatalog>
): Dict<string, ActionDescriptor> {
  const descriptors = new Dict<string, ActionDescriptor>();

  const pages = brainDef.pages();
  for (let i = 0; i < pages.size(); i++) {
    const rules = pages.get(i)!.children();
    for (let j = 0; j < rules.size(); j++) {
      collectRuleDescriptors(rules.get(j)!, descriptors);
    }
  }

  for (let i = 0; i < catalogs.size(); i++) {
    const catalog = catalogs.get(i)!;
    const tileDefs = catalog.getAll();

    for (let j = 0; j < tileDefs.size(); j++) {
      const tileDef = tileDefs.get(j)!;
      if (!isActionTileDef(tileDef)) {
        continue;
      }
      addDescriptor(descriptors, tileDef.action);
    }
  }

  return descriptors;
}

function validateResolvedAction(descriptor: ActionDescriptor, resolved: ResolvedAction): void {
  if (resolved.descriptor.key !== descriptor.key) {
    throw new Error(
      `linkBrainProgram: resolver returned action '${resolved.descriptor.key}' for descriptor '${descriptor.key}'`
    );
  }
  if (resolved.descriptor.kind !== descriptor.kind) {
    throw new Error(`linkBrainProgram: action kind mismatch for '${descriptor.key}'`);
  }
  if (resolved.descriptor.isAsync !== descriptor.isAsync) {
    throw new Error(`linkBrainProgram: action async flag mismatch for '${descriptor.key}'`);
  }

  if (resolved.binding === "host") {
    if (descriptor.isAsync) {
      if (!resolved.execAsync) {
        throw new Error(`linkBrainProgram: async host action '${descriptor.key}' is missing execAsync`);
      }
      return;
    }
    if (!resolved.execSync) {
      throw new Error(`linkBrainProgram: sync host action '${descriptor.key}' is missing execSync`);
    }
  }
}

function toExecutableAction(resolved: ResolvedAction): ExecutableAction {
  if (resolved.binding === "host") {
    return resolved;
  }

  throw new Error(`linkBrainProgram: bytecode action linking is not implemented for '${resolved.descriptor.key}'`);
}

export function linkBrainProgram(
  program: UnlinkedBrainProgram,
  brainDef: IBrainDef,
  catalogs: ReadonlyList<ITileCatalog>,
  resolver: BrainActionResolver
): ExecutableBrainProgram {
  const descriptorIndex = buildActionDescriptorIndex(brainDef, catalogs);
  const actions = List.empty<ExecutableAction>();

  for (let i = 0; i < program.actionRefs.size(); i++) {
    const actionRef = program.actionRefs.get(i)!;
    const descriptor = descriptorIndex.get(actionRef.key);
    if (!descriptor) {
      throw new Error(`linkBrainProgram: missing action descriptor for '${actionRef.key}'`);
    }

    const resolved = resolver.resolveAction(descriptor);
    if (!resolved) {
      throw new Error(`linkBrainProgram: missing action binding for '${descriptor.key}'`);
    }

    validateResolvedAction(descriptor, resolved);
    actions.push(toExecutableAction(resolved));
  }

  return {
    version: program.version,
    functions: program.functions,
    constants: program.constants,
    variableNames: program.variableNames,
    entryPoint: program.entryPoint,
    ruleIndex: program.ruleIndex,
    pages: program.pages,
    actions,
  };
}
