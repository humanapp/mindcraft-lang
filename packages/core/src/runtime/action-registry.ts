import { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import { MathOps } from "../platform/math";
import { TARGET_ACTION_ID_BASE } from "./abi-ids";
import type { ActionDescriptor, ActionKey } from "./function-defs";
import type { IBrainActionRegistry, ResolvedAction } from "./host-bindings";

/** Owner of a host-action registration scope: core or the active target. */
export type ActionIdOwner = "core" | "target";

/** In-memory {@link IBrainActionRegistry}: keyed registry of {@link ResolvedAction}s used during brain linking. */
export class BrainActionRegistry implements IBrainActionRegistry {
  private readonly actions = new Dict<ActionKey, ResolvedAction>();
  private readonly actionsById = new Dict<number, ResolvedAction>();
  private owner: ActionIdOwner = "target";

  withOwner<T>(owner: ActionIdOwner, body: () => T): T {
    const previous = this.owner;
    this.owner = owner;
    try {
      return body();
    } finally {
      this.owner = previous;
    }
  }

  register(action: ResolvedAction): ResolvedAction {
    const key = action.descriptor.key;
    if (this.actions.has(key)) {
      throw new Error(`BrainActionRegistry.register: action '${key}' is already registered`);
    }
    if (action.binding === "host") {
      this.validateId(action.id, key);
      this.actionsById.set(action.id, action);
    }
    this.actions.set(key, action);
    return action;
  }

  private validateId(id: number, key: ActionKey): void {
    if (id < 0 || MathOps.floor(id) !== id) {
      throw new Error(
        `BrainActionRegistry.register: action '${key}' has invalid id ${id}: must be a non-negative integer`
      );
    }
    const existing = this.actionsById.get(id);
    if (existing) {
      throw new Error(
        `BrainActionRegistry.register: action '${key}' reuses id ${id} already assigned to '${existing.descriptor.key}'`
      );
    }
    if (this.owner === "core" && id >= TARGET_ACTION_ID_BASE) {
      throw new Error(
        `BrainActionRegistry.register: core action '${key}' has id ${id} outside the core range [0, ${TARGET_ACTION_ID_BASE})`
      );
    }
    if (this.owner === "target" && id < TARGET_ACTION_ID_BASE) {
      throw new Error(
        `BrainActionRegistry.register: target action '${key}' has id ${id} below the target range base ${TARGET_ACTION_ID_BASE}`
      );
    }
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
