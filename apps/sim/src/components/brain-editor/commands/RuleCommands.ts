import { type BrainDef, type BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { deserializeRuleFromClipboard } from "../rule-clipboard";
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
    // Rule is nested under another rule
    const index = ancestor.children().indexOf(rule);
    return {
      rule,
      parentRule: ancestor,
      index,
    };
  } else {
    // Rule is at page level
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
 * Command to add a new rule.
 */
export class AddRuleCommand implements BrainCommand {
  private addedRule?: BrainRuleDef;

  constructor(private pageDef: BrainPageDef) {}

  execute(): void {
    this.addedRule = this.pageDef.appendNewRule() as BrainRuleDef;
  }

  undo(): void {
    if (this.addedRule) {
      this.addedRule.delete();
    }
  }

  getDescription(): string {
    return "Add rule";
  }
}

/**
 * Command to insert a new rule before an existing rule at the same indent level.
 */
export class InsertRuleBeforeCommand implements BrainCommand {
  private insertedRule?: BrainRuleDef;

  constructor(private targetRule: BrainRuleDef) {}

  execute(): void {
    const state = getRuleState(this.targetRule);
    const newRule = new BrainRuleDef();

    if (state.parentRule) {
      state.parentRule.addRuleAtIndex(state.index, newRule);
    } else if (state.pageDef) {
      state.pageDef.addRuleAtIndex(state.index, newRule);
    }

    this.insertedRule = newRule;
  }

  undo(): void {
    if (this.insertedRule) {
      this.insertedRule.delete();
    }
  }

  getDescription(): string {
    return "Add rule above";
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
    // Save the state before deletion
    this.savedState = getRuleState(this.ruleToDelete);
    this.clonedRule = this.ruleToDelete.clone();
    this.ruleToDelete.delete();
  }

  undo(): void {
    if (!this.savedState || !this.clonedRule) return;

    const { parentRule, pageDef, index } = this.savedState;

    if (parentRule) {
      // Re-insert into parent rule
      parentRule.addRuleAtIndex(index, this.clonedRule);
    } else if (pageDef) {
      // Re-insert into page
      pageDef.addRuleAtIndex(index, this.clonedRule);
    }

    // Update ruleToDelete to point to the newly inserted rule for potential redo
    this.ruleToDelete = this.clonedRule;
  }

  getDescription(): string {
    return "Delete rule";
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

/**
 * Command to indent a rule.
 */
export class IndentRuleCommand implements BrainCommand {
  constructor(private rule: BrainRuleDef) {}

  execute(): void {
    this.rule.indent();
  }

  undo(): void {
    this.rule.outdent();
  }

  getDescription(): string {
    return "Indent rule";
  }
}

/**
 * Command to outdent a rule.
 */
export class OutdentRuleCommand implements BrainCommand {
  constructor(private rule: BrainRuleDef) {}

  execute(): void {
    this.rule.outdent();
  }

  undo(): void {
    this.rule.indent();
  }

  getDescription(): string {
    return "Outdent rule";
  }
}

/**
 * Command to paste a rule from the clipboard above an existing rule.
 *
 * Deserializes the clipboard contents into the destination brain, importing
 * any missing catalog entries (literals, variables) and substituting
 * missing-tile placeholders for unresolvable page references.
 */
export class PasteRuleAboveCommand implements BrainCommand {
  private pastedRule?: BrainRuleDef;

  constructor(private targetRule: BrainRuleDef) {}

  execute(): void {
    const brain = this.targetRule.brain() as BrainDef | undefined;
    if (!brain) return;

    const newRule = deserializeRuleFromClipboard(brain);
    if (!newRule) return;

    const state = getRuleState(this.targetRule);
    if (state.parentRule) {
      (state.parentRule as BrainRuleDef).addRuleAtIndex(state.index, newRule);
    } else if (state.pageDef) {
      state.pageDef.addRuleAtIndex(state.index, newRule);
    }

    this.pastedRule = newRule;
  }

  undo(): void {
    if (this.pastedRule) {
      this.pastedRule.delete();
    }
  }

  getDescription(): string {
    return "Paste rule above";
  }
}
