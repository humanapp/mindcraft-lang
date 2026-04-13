import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { Vector2 } from "@mindcraft-lang/core/app";
import type { BrainEditorConfig, CustomLiteralType } from "@mindcraft-lang/ui";
import type { ReactNode } from "react";
import type { Archetype } from "@/brain/actor";
import { SimTypeIds } from "@/brain/type-system";
import { getDefaultBrain } from "@/services/brain-persistence";
import { dataTypeIconMap, dataTypeNameMap } from "./data-type-icons";
import { genVisualForTile } from "./visual-provider";

const inputClass =
  "col-span-3 flex h-10 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50";

const vector2LiteralType: CustomLiteralType = {
  typeId: SimTypeIds.Vector2,
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

interface BuildBrainEditorConfigOptions {
  environment: MindcraftEnvironment;
  archetype?: Archetype;
  vfsRevision?: number;
  onTileHelp?: BrainEditorConfig["onTileHelp"];
  docsIntegration?: BrainEditorConfig["docsIntegration"];
}

export function buildBrainEditorConfig(options: BuildBrainEditorConfigOptions): BrainEditorConfig {
  const { environment, archetype, vfsRevision, onTileHelp, docsIntegration } = options;
  const resolveTileVisual =
    vfsRevision !== undefined
      ? (tileDef: Parameters<typeof genVisualForTile>[0]) => {
          const visual = genVisualForTile(tileDef);
          if (visual.iconUrl?.startsWith("/vfs/")) {
            return { ...visual, iconUrl: `${visual.iconUrl}?_v=${vfsRevision}` };
          }
          return visual;
        }
      : genVisualForTile;

  return {
    dataTypeIcons: dataTypeIconMap,
    dataTypeNames: dataTypeNameMap,
    resolveTileVisual,
    customLiteralTypes: [vector2LiteralType],
    getDefaultBrain: archetype ? () => getDefaultBrain(archetype) : undefined,
    brainServices: environment.brainServices,
    tileCatalogs: environment.tileCatalogs(),
    onTileHelp,
    docsIntegration,
  };
}
