import type { BrainDef, BrainJson } from "@mindcraft-lang/core/brain/model";
import type { BrainServicesRunner } from "../brain-services";
import { runWithBrainServices } from "../brain-services";
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
    private readonly withBrainServices?: BrainServicesRunner
  ) {
    this.beforeJson = runWithBrainServices(this.withBrainServices, () => brainDef.toJson());
  }

  execute(): void {
    runWithBrainServices(this.withBrainServices, () => {
      this.brainDef.replaceContentFromJson(this.afterJson);
    });
  }

  undo(): void {
    runWithBrainServices(this.withBrainServices, () => {
      this.brainDef.replaceContentFromJson(this.beforeJson);
    });
  }

  getDescription(): string {
    return "Paste brain";
  }
}
