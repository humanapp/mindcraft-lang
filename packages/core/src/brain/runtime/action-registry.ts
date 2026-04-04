import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import type { ActionDescriptor, ActionKey, IBrainActionRegistry, ResolvedAction } from "../interfaces";

export class BrainActionRegistry implements IBrainActionRegistry {
  private readonly actions = new Dict<ActionKey, ResolvedAction>();

  register(action: ResolvedAction): ResolvedAction {
    const key = action.descriptor.key;
    if (this.actions.has(key)) {
      throw new Error(`BrainActionRegistry.register: action '${key}' is already registered`);
    }
    this.actions.set(key, action);
    return action;
  }

  getByKey(key: ActionKey): ResolvedAction | undefined {
    return this.actions.get(key);
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
