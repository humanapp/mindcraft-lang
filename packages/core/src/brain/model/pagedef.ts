import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import { type IReadStream, type IWriteStream, MemoryStream } from "../../platform/stream";
import { StringUtils as SU } from "../../platform/string";
import { fourCC } from "../../primitives";
import { EventEmitter, type EventEmitterConsumer } from "../../util";
import type { BrainPageDefEvents, IBrainDef, IBrainPageDef, IBrainRuleDef } from "../interfaces";
import { BrainRuleDef } from "./ruledef";

// Maximum allowed length for brain page names.
// WARNING: This value must never be lowered, as it could invalidate existing saves. It may be safely increased.
export const kMaxPageNameLength = 100; // never reduce this value!

// Serialization tags
const STags = {
  PAGE: fourCC("PAGE"), // Brain page chunk
  NAME: fourCC("NAME"), // Page name
  PGID: fourCC("PGID"), // Stable page ID (UUID)
  RLCT: fourCC("RLCT"), // Rule count
};

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
    const stream = new MemoryStream();
    this.serialize(stream);
    const newPage = new BrainPageDef();
    newPage.deserialize(stream);
    // Note: new page is unbrained (brain_ is undefined)
    return newPage;
  }

  serialize(stream: IWriteStream): void {
    stream.writeTaggedU8(STags.PAGE, 2); // version 2: added pageId
    stream.writeTaggedString(STags.NAME, this.name_);
    stream.writeTaggedString(STags.PGID, this.pageId_);
    stream.writeTaggedU32(STags.RLCT, this.children_.size());
    this.children_.forEach((child) => {
      child.serialize(stream);
    });
  }

  deserialize(stream: IReadStream): void {
    const version = stream.readTaggedU8(STags.PAGE);
    if (version < 1 || version > 2) {
      throw new Error(`Unsupported BrainPageDef version: ${version}`);
    }
    this.name_ = stream.readTaggedString(STags.NAME);
    if (version >= 2) {
      // Version 2+: read the stable page ID. Overwrite the constructor-generated one.
      (this as unknown as { pageId_: string }).pageId_ = stream.readTaggedString(STags.PGID);
    }
    // Version 1 pages keep the constructor-generated pageId_ (new UUID)
    const childCount = stream.readTaggedU32(STags.RLCT);
    for (let i = 0; i < childCount; i++) {
      const child = new BrainRuleDef();
      child.setPage(this); // set page before deserializing so rule can read brain's local catalog
      child.deserialize(stream);
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

  private subscribeToRule_(rule: BrainRuleDef): void {
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

  private unsubscribeFromRule_(rule: BrainRuleDef): void {
    const unsubscribe = this.ruleSubscriptions_.get(rule);
    if (unsubscribe) {
      unsubscribe();
      this.ruleSubscriptions_.delete(rule);
    }
  }
}
