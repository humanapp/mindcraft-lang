import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import { StringUtils as SU } from "../../platform/string";
import { EventEmitter, type EventEmitterConsumer } from "../../util";
import type { BrainPageDefEvents, IBrainDef, IBrainPageDef, IBrainRuleDef, ITileCatalog } from "../interfaces";
import { BrainRuleDef, type RuleJson } from "./ruledef";

export interface PageJson {
  version: number;
  pageId: string;
  name: string;
  rules: ReadonlyList<RuleJson>;
}

// Maximum allowed length for brain page names.
// WARNING: This value must never be lowered, as it could invalidate existing saves. It may be safely increased.
export const kMaxPageNameLength = 100; // never reduce this value!

// Current serialization version.
// v1: initial format (binary only, no pageId)
// v2: added stable pageId
const kVersion = 2;

export class BrainPageDef implements IBrainPageDef {
  private name_: string = "Unnamed Page"; // TODO: i18n
  private readonly pageId_: string;
  private brain_?: IBrainDef;
  private readonly children_ = new List<BrainRuleDef>();
  private readonly emitter_ = new EventEmitter<BrainPageDefEvents>();
  private readonly ruleSubscriptions_ = new Dict<BrainRuleDef, () => void>();

  constructor(pageId?: string) {
    this.pageId_ = pageId || SU.mkid();
  }

  pageId(): string {
    return this.pageId_;
  }

  children(): List<IBrainRuleDef> {
    return this.children_ as unknown as List<IBrainRuleDef>;
  }

  events(): EventEmitterConsumer<BrainPageDefEvents> {
    return this.emitter_.consumer();
  }

  setName(newName: string) {
    newName = newName || "Unnamed Page"; // TODO: i18n
    if (newName === this.name_) {
      return;
    }
    if (SU.length(newName) > kMaxPageNameLength) {
      newName = SU.substring(newName, 0, kMaxPageNameLength);
    }
    const oldName = this.name_;
    this.name_ = newName;
    this.emitter_.emit("name_changed", { oldName, newName });
  }

  name(): string {
    return this.name_;
  }

  setBrain(brain: IBrainDef | undefined) {
    this.brain_ = brain;
  }

  brain(): IBrainDef | undefined {
    return this.brain_;
  }

  clone(): BrainPageDef {
    const json = this.toJson();
    const newPage = new BrainPageDef();
    const brain = this.brain_;
    const catalogs = brain ? brain.deserializationCatalogs() : new List<ITileCatalog>();
    newPage.deserializeJson(json, catalogs);
    return newPage;
  }
  toJson(): PageJson {
    const rules = new List<RuleJson>();
    for (let i = 0; i < this.children_.size(); i++) {
      rules.push(this.children_.get(i).toJson());
    }
    return { version: kVersion, pageId: this.pageId_, name: this.name_, rules };
  }

  deserializeJson(json: PageJson, catalogs: List<ITileCatalog>): void {
    if (json.version !== kVersion) {
      throw new Error(`BrainPageDef.deserializeJson: unsupported version ${json.version}`);
    }
    this.name_ = json.name;
    for (let i = 0; i < json.rules.size(); i++) {
      const child = new BrainRuleDef();
      child.setPage(this);
      child.deserializeJson(json.rules.get(i), catalogs);
      this.children_.push(child);
      this.subscribeToRule_(child);
    }
  }

  appendNewRule(): BrainRuleDef {
    const rule = new BrainRuleDef();
    this.children_.push(rule);
    rule.setPage(this);
    this.subscribeToRule_(rule);
    this.emitter_.emit("page_changed", { what: "rule_added" });
    return rule;
  }

  addRuleAtIndex(index: number, rule: BrainRuleDef): void {
    this.children_.insert(index, rule);
    rule.setPage(this);
    this.subscribeToRule_(rule);
    this.emitter_.emit("page_changed", { what: "rule_added" });
  }

  removeRuleAtIndex(index: number): BrainRuleDef | undefined {
    const rule = this.children_.get(index);
    if (rule) {
      this.unsubscribeFromRule_(rule);
      this.children_.remove(index);
      rule.setPage(undefined);
      this.emitter_.emit("page_changed", { what: "rule_removed" });
      return rule;
    }
    return undefined;
  }

  containsTileId(tileId: string): boolean {
    for (let i = 0; i < this.children_.size(); i++) {
      const rule = this.children_.get(i);
      if (rule.containsTileId(tileId)) {
        return true;
      }
    }
    return false;
  }

  typecheck(): void {
    this.children_.forEach((child) => {
      child.typecheck();
    });
  }

  subscribeToRule_(rule: BrainRuleDef): void {
    // Unsubscribe first if already subscribed (safety)
    this.unsubscribeFromRule_(rule);

    const unsubRuleDeleted = rule.events().on("rule_deleted", (data) => {
      this.emitter_.emit("page_changed", { what: "rule_deleted" });
    });
    const unsubRuleDirtyChanged = rule.events().on("rule_dirtyChanged", (data) => {
      this.emitter_.emit("page_changed", { what: "rule_dirtyChanged", ruleWhat: data });
    });

    const unsubscribe = () => {
      unsubRuleDeleted();
      unsubRuleDirtyChanged();
    };
    this.ruleSubscriptions_.set(rule, unsubscribe);
  }

  unsubscribeFromRule_(rule: BrainRuleDef): void {
    const unsubscribe = this.ruleSubscriptions_.get(rule);
    if (unsubscribe) {
      unsubscribe();
      this.ruleSubscriptions_.delete(rule);
    }
  }
}
