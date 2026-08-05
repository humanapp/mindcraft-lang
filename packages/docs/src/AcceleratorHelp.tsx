import type { AcceleratorContribution, AcceleratorPlatform } from "@mindcraft-lang/ui/brain-editor/accelerators";
import {
  acceleratorPlatform,
  acceleratorsForMode,
  kAcceleratorContributions,
} from "@mindcraft-lang/ui/brain-editor/accelerators";
import type { EditorMode } from "@mindcraft-lang/ui/brain-editor/editor-mode";
import { kEditorModes } from "@mindcraft-lang/ui/brain-editor/editor-mode";
import { useEffect, useMemo, useState } from "react";
import { DocMarkdown } from "./DocMarkdown";
import { useDocsSidebar } from "./DocsSidebarContext";

/**
 * Key of the documentation concept the keyboard help page stands as. Navigate
 * the docs panel or the docs page to this concept to open it.
 */
export const kAcceleratorHelpConceptId = "keyboard";

/** How long the page waits for the editor to settle before it swaps its live list, in milliseconds. */
const kSettleDelayMs = 250;

/** How each mode reads at the head of its section. */
const kModeNames: Record<EditorMode, string> = {
  "grid-selection": "Moving around the rules",
  "rule-held": "Holding a rule",
  "tray-armed": "Picking a tile",
  "tray-filtering": "Searching for a tile",
  composing: "Writing a rule",
  "text-literal": "Writing a piece of text",
};

/**
 * `mode` once it has stopped changing for `delayMs`. The previous value stands
 * for the whole wait, so a run of fast changes shows the last settled list
 * throughout and swaps once.
 */
function useSettledMode(mode: EditorMode | undefined, delayMs: number): EditorMode | undefined {
  const [settled, setSettled] = useState(mode);
  useEffect(() => {
    if (mode === settled) return;
    const timer = setTimeout(() => setSettled(mode), delayMs);
    return () => clearTimeout(timer);
  }, [mode, settled, delayMs]);
  return settled;
}

/** The platform whose modifier names this page writes, read from the browser it renders in. */
function currentPlatform(): AcceleratorPlatform {
  if (typeof navigator === "undefined") return "other";
  return acceleratorPlatform(navigator.userAgent);
}

/** One contribution's markdown, rendered as a row of the list. */
function AcceleratorRow({
  contribution,
  platform,
}: {
  contribution: AcceleratorContribution;
  platform: AcceleratorPlatform;
}) {
  return (
    <li className="text-sm leading-relaxed">
      <DocMarkdown>{contribution.markdown(platform)}</DocMarkdown>
    </li>
  );
}

/** The contributions of one mode, under that mode's heading. */
function AcceleratorSection({
  mode,
  contributions,
  platform,
}: {
  mode: EditorMode;
  contributions: readonly AcceleratorContribution[];
  platform: AcceleratorPlatform;
}) {
  if (contributions.length === 0) return null;
  return (
    <section className="mb-5">
      <h3 className="text-sm font-semibold text-foreground mb-1.5">{kModeNames[mode]}</h3>
      <ul className="space-y-1.5 list-none pl-0">
        {contributions.map((contribution) => (
          <AcceleratorRow key={contribution.id} contribution={contribution} platform={platform} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The keyboard help page: the shortcuts live in the editor right now, followed
 * by every shortcut the editor has.
 *
 * The live list holds only what the editor's current mode acts on, so nothing
 * shown there is inert where it is shown. It follows the editor while this page
 * is open, waiting for the editor to settle before it swaps, and stands no live
 * list at all while no editor does.
 */
export function AcceleratorHelp() {
  const { editorMode } = useDocsSidebar();
  const settledMode = useSettledMode(editorMode, kSettleDelayMs);
  const platform = useMemo(currentPlatform, []);
  const live = useMemo(() => acceleratorsForMode(settledMode), [settledMode]);

  return (
    <div data-accelerator-help="" data-accelerator-mode={settledMode ?? ""}>
      <h2 className="text-base font-semibold text-foreground mb-1">Right now</h2>
      {settledMode === undefined ? (
        <p className="text-sm text-muted-foreground mb-5">
          Open a brain to see what the keys do where you are standing. Everything the editor knows is listed below.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3">{kModeNames[settledMode]}</p>
          <ul className="space-y-1.5 list-none pl-0 mb-6">
            {live.map((contribution) => (
              <AcceleratorRow key={contribution.id} contribution={contribution} platform={platform} />
            ))}
          </ul>
        </>
      )}

      <h2 className="text-base font-semibold text-foreground mb-2 pt-2 border-t border-border">Everywhere else</h2>
      {kEditorModes.map((mode) => (
        <AcceleratorSection
          key={mode}
          mode={mode}
          contributions={acceleratorsForMode(mode, kAcceleratorContributions)}
          platform={platform}
        />
      ))}
    </div>
  );
}
