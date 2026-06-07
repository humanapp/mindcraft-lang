import { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import { List } from "../platform/list";
import type { ActionDescriptor, ActionKey } from "./function-defs";
import type { IBrainActionRegistry, ResolvedAction } from "./host-bindings";

/** In-memory {@link IBrainActionRegistry}: keyed registry of {@link ResolvedAction}s used during brain linking. */
export class BrainActionRegistry implements IBrainActionRegistry {
  private readonly actions = new Dict<ActionKey, ResolvedAction>();
  private readonly actionsById = new List<ResolvedAction>();

  register(action: ResolvedAction): ResolvedAction {
    const key = action.descriptor.key;
    if (this.actions.has(key)) {
      throw new Error(`BrainActionRegistry.register: action '${key}' is already registered`);
    }
    const id = this.actionsById.size();
    if (action.binding === "host") {
      action.id = id;
    }
    this.actions.set(key, action);
    this.actionsById.push(action);
    return action;
  }

  getByKey(key: ActionKey): ResolvedAction | undefined {
    return this.actions.get(key);
  }

  getById(id: number): ResolvedAction | undefined {
    return this.actionsById.get(id);
  }

  resolveAction(descriptor: ActionDescriptor): ResolvedAction | undefined {
    const resolved = this.actions.get(descriptor.key);
    if (!resolved) {
      return undefined;
    }
    if (resolved.descriptor.kind !== descriptor.kind) {
      return undefined;
    }
    if (resolved.descriptor.isAsync !== descriptor.isAsync) {
      return undefined;
    }
    return resolved;
  }

  size(): number {
    return this.actions.size();
  }
}
