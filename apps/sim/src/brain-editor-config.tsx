import { Vector2 } from "@mindcraft-lang/core";
import type { BrainEditorConfig, CustomLiteralType } from "@mindcraft-lang/ui";
import type { ReactNode } from "react";
import type { Archetype } from "./brain/actor";
import { dataTypeIconMap, dataTypeNameMap } from "./brain/tiles/data-type-icons";
import { isAppVariableFactoryTileId } from "./brain/tiles/variables";
import { MyTypeIds } from "./brain/type-system";
import { getDefaultBrain } from "./services/brain-persistence";

const inputClass =
  "col-span-3 flex h-10 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50";

const vector2LiteralType: CustomLiteralType = {
  typeId: MyTypeIds.Vector2,
  description: "Enter X and Y coordinates for the vector.",

  isValid(state: Record<string, string>): boolean {
    return (
      state.x !== "" &&
      state.y !== "" &&
      !Number.isNaN(Number.parseFloat(state.x ?? "")) &&
      !Number.isNaN(Number.parseFloat(state.y ?? ""))
    );
  },

  parseValue(state: Record<string, string>): unknown {
    const x = Number.parseFloat(state.x ?? "");
    const y = Number.parseFloat(state.y ?? "");
    if (Number.isNaN(x) || Number.isNaN(y)) return undefined;
    return new Vector2(x, y);
  },

  renderInputFields(
    state: Record<string, string>,
    onChange: (key: string, value: string) => void,
    onSubmit: () => void
  ): ReactNode {
    const handleKeyDown = (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        onSubmit();
      }
    };

    return (
      <div className="grid gap-4">
        <div className="grid grid-cols-4 items-center gap-4">
          <label htmlFor="vector2X" className="text-right text-slate-700 font-medium">
            X
          </label>
          <input
            id="vector2X"
            type="number"
            value={state.x ?? ""}
            onChange={(e) => onChange("x", e.target.value)}
            onKeyDown={handleKeyDown}
            className={inputClass}
            placeholder="0"
            autoComplete="off"
            // biome-ignore lint/a11y/noAutofocus: dialog input should focus immediately for keyboard users
            autoFocus
          />
        </div>
        <div className="grid grid-cols-4 items-center gap-4">
          <label htmlFor="vector2Y" className="text-right text-slate-700 font-medium">
            Y
          </label>
          <input
            id="vector2Y"
            type="number"
            value={state.y ?? ""}
            onChange={(e) => onChange("y", e.target.value)}
            onKeyDown={handleKeyDown}
            className={inputClass}
            placeholder="0"
            autoComplete="off"
          />
        </div>
      </div>
    );
  },

  formatValue(value: unknown): string {
    if (value && typeof value === "object" && "X" in value && "Y" in value) {
      const v = value as { X: number; Y: number };
      return `(${v.X}, ${v.Y})`;
    }
    return String(value);
  },
};

/**
 * Build the BrainEditorConfig for the sim app, scoped to the given archetype
 * for the "Load Default Brain" feature.
 */
export function buildBrainEditorConfig(archetype?: Archetype): BrainEditorConfig {
  return {
    dataTypeIcons: new Map(dataTypeIconMap.entries()),
    dataTypeNames: new Map(dataTypeNameMap.entries()),
    isAppVariableFactoryTileId,
    customLiteralTypes: [vector2LiteralType],
    getDefaultBrain: archetype ? () => getDefaultBrain(archetype) : undefined,
  };
}
