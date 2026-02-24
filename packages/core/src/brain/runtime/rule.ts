import { Dict } from "../../platform/dict";
import { List } from "../../platform/list";
import type { IBrainPage, IBrainRule, IBrainRuleDef, Value } from "../interfaces";
import type { BrainPage } from "./page";

/**
 * BrainRule runtime instance.
 *
 * With the Option 1 architecture (Each Rule = One Function), the BrainRule
 * is now a lightweight reference rather than an execution engine.
 *
 * Key changes from the old architecture:
 * - The Brain owns the single VM and FiberScheduler
 * - Each rule is compiled as a function in the BrainProgram
 * - The BrainRule just holds metadata and references
 * - Child rules are CALLed by the parent function, not managed here
 *
 * The rule maintains:
 * - Reference to the BrainRuleDef it was compiled from
 * - Function ID in the compiled BrainProgram
 * - Child BrainRule instances (for reference, not execution)
 * - Reference to the parent page and ancestor rule
 *
 * Execution is driven by the Brain:
 * - Brain spawns fibers for active page's root rules
 * - VM executes rule functions which CALL child rules
 * - Variables are accessed via Brain's variable storage
 */
export class BrainRule implements IBrainRule {
  /**
   * Function ID in the compiled BrainProgram.
   * Assigned during compilation by BrainCompiler.
   */
  public funcId: number | undefined;

  /**
   * Child rule instances (for reference/metadata access).
   */
  private readonly rules_ = new List<BrainRule>();

  /**
   * Variable storage at the Brain level.
   *
   * Unlike brain vars, these variables are keyed by name, and are purely
   * internal to the rule execution context. They're not exposed to the user
   * and are not part of the Brain's public variable system. They're used for
   * things like storing intermediate values during rule exeecution. For
   * example, a "see" sensor might store the list of seen actors in a variable
   * for the rule's DO side to access. They are cleared on each
   * activate/deactivate cycle to ensure no stale data.
   */
  private readonly variables: Dict<string, Value> = new Dict<string, Value>();

  constructor(
    private readonly page_: BrainPage,
    private readonly ancestor_: BrainRule | undefined,
    ruleDef_: IBrainRuleDef
  ) {
    // Create child rule instances
    ruleDef_.children().forEach((childDef) => {
      const childRule = new BrainRule(this.page_, this, childDef);
      this.rules_.push(childRule);
    });
  }

  /**
   * Get a variable value by name. If not found in this rule, recursively check
   * ancestor rules.
   * @param varName - Name of the variable
   * @returns The variable's current value, or undefined if not found
   */
  getVariable<T extends Value>(varName: string): T | undefined {
    if (this.variables.has(varName)) {
      return this.variables.get(varName) as T | undefined;
    }
    if (this.ancestor_) {
      return this.ancestor_.getVariable<T>(varName);
    }
  }

  /**
   * Set a variable value by name.
   * @param varName - Name of the variable
   * @param value - The value to store
   */
  setVariable(varName: string, value: Value): void {
    this.variables.set(varName, value);
  }

  clearVariable(varName: string): void {
    this.variables.delete(varName);
  }

  clearVariables(): void {
    this.variables.clear();
  }

  page(): IBrainPage {
    return this.page_;
  }

  ancestor(): IBrainRule | undefined {
    return this.ancestor_;
  }

  /**
   * Get child rule instances.
   */
  children(): List<BrainRule> {
    return this.rules_;
  }

  /**
   * Set the function ID for this rule in the compiled program.
   * Called by Brain during initialization after compilation.
   *
   * @param funcId - Function ID in the BrainProgram
   */
  setFuncId(funcId: number): void {
    this.funcId = funcId;
  }

  /**
   * Get the function ID for this rule.
   */
  getFuncId(): number | undefined {
    return this.funcId;
  }

  /**
   * Recursively assign function IDs to this rule and its children.
   * Uses the rule index from the compiled BrainProgram.
   *
   * @param ruleIndex - Mapping from rule path to function ID
   * @param rulePath - Path to this rule (e.g., "0/1/2")
   */
  assignFuncIds(ruleIndex: Dict<string, number>, rulePath: string): void {
    const funcId = ruleIndex.get(rulePath);
    if (funcId !== undefined) {
      this.funcId = funcId;
    }

    // Assign to children
    for (let i = 0; i < this.rules_.size(); i++) {
      const child = this.rules_.get(i)!;
      child.assignFuncIds(ruleIndex, `${rulePath}/${i}`);
    }
  }

  activate(): void {
    this.variables.clear();
    this.rules_.forEach((rule) => {
      rule.activate();
    });
  }

  deactivate(): void {
    this.variables.clear();
    this.rules_.forEach((rule) => {
      rule.deactivate();
    });
  }
}
