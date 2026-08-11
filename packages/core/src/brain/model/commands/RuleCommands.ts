import { Error } from "../../../platform/error";
import { List, type ReadonlyList } from "../../../platform/list";
import type { BrainDef } from "../braindef";
import type { BrainPageDef } from "../pagedef";
import { BrainRuleDef } from "../ruledef";
import type { BrainCommand } from "./BrainCommand";

/**
 * Helper to capture the full state of a rule for undo/redo.
 */
interface RuleState {
  rule: BrainRuleDef;
  parentRule?: BrainRuleDef;
  pageDef?: BrainPageDef;
  index: number;
}

/**
 * Helper to capture where a rule is located in the tree.
 */
function getRuleState(rule: BrainRuleDef): RuleState {
  const ancestor = rule.ancestor() as BrainRuleDef | undefined;

  if (ancestor) {
    const index = ancestor.children().indexOf(rule);
    return {
      rule,
      parentRule: ancestor,
      index,
    };
  } else {
    const page = rule.page() as BrainPageDef | undefined;
    if (page) {
      const index = page.children().indexOf(rule);
      return {
        rule,
        pageDef: page,
        index,
      };
    }
  }

  throw new Error("Rule has no parent or page");
}

/**
 * Command to add a new rule at the end of a page.
 *
 * The rule the first execute appends is the rule every later execute puts back,
 * at the index it was taken from, so its id and everything under it survive an
 * undo/redo round trip.
 */
export class AddRuleCommand implements BrainCommand {
  private addedRule?: BrainRuleDef;
  private removedFrom = 0;

  constructor(private pageDef: BrainPageDef) {}

  execute(): void {
    const added = this.addedRule;
    if (added) {
      this.pageDef.addRuleAtIndex(this.removedFrom, added);
      return;
    }
    this.addedRule = this.pageDef.appendNewRule() as BrainRuleDef;
  }

  undo(): void {
    if (!this.addedRule) return;
    const index = this.pageDef.children().indexOf(this.addedRule);
    if (index < 0) return;
    this.removedFrom = index;
    this.pageDef.removeRuleAtIndex(index);
  }

  getDescription(): string {
    return "Add rule";
  }
}

/**
 * Which side of the target rule an insertion or a paste lands on. `after` puts
 * the new rules past the target and past every rule nested under it.
 */
export type RulePlacement = "before" | "after";

/** The index in the target's own list that `placement` puts a new rule at. */
function placementIndex(state: RuleState, placement: RulePlacement): number {
  return placement === "after" ? state.index + 1 : state.index;
}

/** Put `rule` into the list `location` names, at the index it names. */
function addRuleAt(location: RuleLocation, rule: BrainRuleDef): void {
  if (location.parentRule) {
    location.parentRule.addRuleAtIndex(location.index, rule);
  } else if (location.pageDef) {
    location.pageDef.addRuleAtIndex(location.index, rule);
  }
}

/**
 * Take `rule` out of the list holding it, without disposing it, and report
 * where it stood so {@link addRuleAt} can put it back.
 */
function takeRuleOut(rule: BrainRuleDef): RuleLocation {
  const state = getRuleState(rule);
  if (state.parentRule) {
    state.parentRule.removeRuleAtIndex(state.index);
  } else if (state.pageDef) {
    state.pageDef.removeRuleAtIndex(state.index);
  }
  return { parentRule: state.parentRule, pageDef: state.pageDef, index: state.index };
}

/**
 * Command to insert a new empty rule beside an existing rule, at the same
 * indent level and on the side `placement` names.
 *
 * The rule the first execute inserts is the rule every later execute puts back,
 * in the list and at the index it was taken from, so its id and everything
 * under it survive an undo/redo round trip.
 */
export class InsertRuleCommand implements BrainCommand {
  private insertedRule_?: BrainRuleDef;
  private removedFrom?: RuleLocation;

  constructor(
    private targetRule: BrainRuleDef,
    private readonly placement: RulePlacement
  ) {}

  execute(): void {
    const inserted = this.insertedRule_;
    if (inserted && this.removedFrom) {
      addRuleAt(this.removedFrom, inserted);
      return;
    }

    const brain = this.targetRule.brain();
    if (!brain) return;

    const state = getRuleState(this.targetRule);
    const newRule = new BrainRuleDef(brain.servicesRng());
    addRuleAt(
      { parentRule: state.parentRule, pageDef: state.pageDef, index: placementIndex(state, this.placement) },
      newRule
    );
    this.insertedRule_ = newRule;
  }

  undo(): void {
    if (!this.insertedRule_) return;
    this.removedFrom = takeRuleOut(this.insertedRule_);
  }

  /** The rule this command inserts, or undefined before it has run. */
  insertedRule(): BrainRuleDef | undefined {
    return this.insertedRule_;
  }

  getDescription(): string {
    return this.placement === "after" ? "Add rule below" : "Add rule above";
  }
}

/**
 * Command to delete a rule.
 */
export class DeleteRuleCommand implements BrainCommand {
  private savedState?: RuleState;
  private clonedRule?: BrainRuleDef;
  private ruleToDelete: BrainRuleDef;

  constructor(rule: BrainRuleDef) {
    this.ruleToDelete = rule;
  }

  execute(): void {
    this.savedState = getRuleState(this.ruleToDelete);
    this.clonedRule = this.ruleToDelete.clone();
    this.ruleToDelete.delete();
  }

  undo(): void {
    if (!this.savedState || !this.clonedRule) return;

    const { parentRule, pageDef, index } = this.savedState;

    if (parentRule) {
      parentRule.addRuleAtIndex(index, this.clonedRule);
    } else if (pageDef) {
      pageDef.addRuleAtIndex(index, this.clonedRule);
    }

    this.ruleToDelete = this.clonedRule;
  }

  getDescription(): string {
    return "Delete rule";
  }
}

/**
 * Snapshot of where a rule lives within a brain page tree.
 */
export interface RuleLocation {
  parentRule?: BrainRuleDef;
  pageDef?: BrainPageDef;
  index: number;
}

/**
 * Command to move a rule from one location to another within its page.
 *
 * The rule must already exist in the page; both `from` and `to` are captured
 * by the drag controller. Using `recordCommand` (not `executeCommand`) is
 * appropriate when the model has already been mutated to the `to` state.
 */
export class MoveRuleCommand implements BrainCommand {
  constructor(
    private rule: BrainRuleDef,
    private from: RuleLocation,
    private to: RuleLocation
  ) {}

  execute(): void {
    this.rule.moveTo(this.to.parentRule, this.to.pageDef, this.to.index);
  }

  undo(): void {
    this.rule.moveTo(this.from.parentRule, this.from.pageDef, this.from.index);
  }

  getDescription(): string {
    return "Move rule";
  }
}

/**
 * Command to move a rule up.
 */
export class MoveRuleUpCommand implements BrainCommand {
  constructor(private rule: BrainRuleDef) {}

  execute(): void {
    this.rule.moveUp();
  }

  undo(): void {
    this.rule.moveDown();
  }

  getDescription(): string {
    return "Move rule up";
  }
}

/**
 * Command to move a rule down.
 */
export class MoveRuleDownCommand implements BrainCommand {
  constructor(private rule: BrainRuleDef) {}

  execute(): void {
    this.rule.moveDown();
  }

  undo(): void {
    this.rule.moveUp();
  }

  getDescription(): string {
    return "Move rule down";
  }
}

/** Where `rule` sits now, as a location {@link BrainRuleDef.moveTo} can be given back. */
function ruleLocation(rule: BrainRuleDef): RuleLocation {
  const state = getRuleState(rule);
  return { parentRule: state.parentRule, pageDef: state.pageDef, index: state.index };
}

/**
 * Command to indent a rule, making it the last child of the sibling above it.
 * Undo returns the rule to the exact list and index it was taken from, and does
 * nothing when the rule could not be indented.
 */
export class IndentRuleCommand implements BrainCommand {
  private origin?: RuleLocation;

  constructor(private rule: BrainRuleDef) {}

  execute(): void {
    const origin = ruleLocation(this.rule);
    if (!this.rule.indent()) return;
    this.origin = origin;
  }

  undo(): void {
    if (this.origin === undefined) return;
    this.rule.moveTo(this.origin.parentRule, this.origin.pageDef, this.origin.index);
  }

  getDescription(): string {
    return "Indent rule";
  }
}

/**
 * Command to outdent a rule, moving it out of its parent to sit just past it.
 * Undo returns the rule to the exact list and index it was taken from, and does
 * nothing when the rule could not be outdented.
 */
export class OutdentRuleCommand implements BrainCommand {
  private origin?: RuleLocation;

  constructor(private rule: BrainRuleDef) {}

  execute(): void {
    const origin = ruleLocation(this.rule);
    if (!this.rule.outdent()) return;
    this.origin = origin;
  }

  undo(): void {
    if (this.origin === undefined) return;
    this.rule.moveTo(this.origin.parentRule, this.origin.pageDef, this.origin.index);
  }

  getDescription(): string {
    return "Outdent rule";
  }
}

/**
 * Command to paste rules beside an existing rule, on the side `placement`
 * names.
 *
 * The rules are produced by `deserializeRules`, which is invoked with the
 * destination brain on every execute (including redo) so the paste reflects
 * its source at execution time. The caller's producer is expected to import
 * any missing catalog entries (literals, variables) into the destination
 * brain as part of deserialization.
 *
 * Supports multi-rule producers: all rules are inserted sequentially, keeping
 * the order they were copied in.
 */
export class PasteRulesCommand implements BrainCommand {
  private pastedRules: ReadonlyList<BrainRuleDef> = List.empty<BrainRuleDef>();

  constructor(
    private targetRule: BrainRuleDef,
    private readonly placement: RulePlacement,
    private readonly deserializeRules: (destBrain: BrainDef) => ReadonlyList<BrainRuleDef>
  ) {}

  execute(): void {
    const brain = this.targetRule.brain() as BrainDef | undefined;
    if (!brain) return;

    const newRules = this.deserializeRules(brain);
    if (newRules.size() === 0) return;

    const state = getRuleState(this.targetRule);
    const base = placementIndex(state, this.placement);

    for (let i = 0; i < newRules.size(); i++) {
      if (state.parentRule) {
        state.parentRule.addRuleAtIndex(base + i, newRules.get(i));
      } else if (state.pageDef) {
        state.pageDef.addRuleAtIndex(base + i, newRules.get(i));
      }
    }

    this.pastedRules = newRules;
  }

  undo(): void {
    // Delete in reverse order to maintain stable indices
    for (let i = this.pastedRules.size() - 1; i >= 0; i--) {
      this.pastedRules.get(i).delete();
    }
    this.pastedRules = List.empty<BrainRuleDef>();
  }

  getDescription(): string {
    const count = this.pastedRules.size();
    const where = this.placement === "after" ? "below" : "above";
    return count <= 1 ? `Paste rule ${where}` : `Paste ${count} rules ${where}`;
  }
}
