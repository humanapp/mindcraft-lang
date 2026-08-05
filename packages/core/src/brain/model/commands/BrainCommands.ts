import type { ReadonlyList } from "../../../platform/list";
import type { ITileCatalog } from "../../interfaces";
import type { BrainDef, BrainJson } from "../braindef";
import type { BrainCommand } from "./BrainCommand";

/**
 * Command to replace the entire brain content with a new brain from the
 * brain clipboard. Participates in the undo stack: undo restores the
 * brain to its state immediately before the paste.
 */
export class ReplaceBrainCommand implements BrainCommand {
  private readonly beforeJson: BrainJson;

  constructor(
    private readonly brainDef: BrainDef,
    private readonly afterJson: BrainJson,
    private readonly extraCatalogs?: ReadonlyList<ITileCatalog>
  ) {
    this.beforeJson = brainDef.toJson();
  }

  execute(): void {
    this.brainDef.replaceContentFromJson(this.afterJson, this.extraCatalogs);
  }

  undo(): void {
    this.brainDef.replaceContentFromJson(this.beforeJson, this.extraCatalogs);
  }

  getDescription(): string {
    return "Paste brain";
  }
}
