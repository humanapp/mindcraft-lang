import type { AcceleratorContribution, AcceleratorPlatform } from "@wendoo/ui/brain-editor/accelerators";
import { acceleratorChips, acceleratorPlatform, liveAcceleratorSection } from "@wendoo/ui/brain-editor/accelerators";
import type { EditorMode } from "@wendoo/ui/brain-editor/editor-mode";
import { useEffect, useMemo, useState } from "react";
import { useDocsSidebar } from "./DocsSidebarContext";

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

/** The platform whose modifier names this page draws, read from the browser it renders in. */
function currentPlatform(): AcceleratorPlatform {
  if (typeof navigator === "undefined") return "other";
  return acceleratorPlatform(navigator.userAgent);
}

/** Every word a search matches a contribution on, on `platform`. */
function searchableText(contribution: AcceleratorContribution, platform: AcceleratorPlatform): string[] {
  const words = [contribution.label, contribution.note ?? ""];
  for (const binding of contribution.bindings) {
    words.push(...acceleratorChips(binding, platform));
    if (binding.kind === "chord") {
      words.push(...binding.keys, ...(binding.modifiers ?? []));
    }
  }
  return words;
}

/** The contributions of `contributions` that `search` keeps. An empty search keeps them all. */
function filterContributions(
  contributions: readonly AcceleratorContribution[],
  search: string,
  platform: AcceleratorPlatform
): readonly AcceleratorContribution[] {
  const query = search.trim().toLowerCase();
  if (query === "") return contributions;
  return contributions.filter((contribution) =>
    searchableText(contribution, platform).some((word) => word.toLowerCase().includes(query))
  );
}

/** One key drawn as its own bordered box. */
function KeyChip({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded border border-border bg-muted text-[11px] leading-none font-medium text-foreground font-sans whitespace-nowrap">
      {children}
    </kbd>
  );
}

/** One contribution as a row: what it does on the left, the keys that do it on the right. */
function AcceleratorRow({
  contribution,
  platform,
}: {
  contribution: AcceleratorContribution;
  platform: AcceleratorPlatform;
}) {
  return (
    <li data-accelerator-row={contribution.id} className="border-b border-border/40 last:border-b-0 py-0.5">
      <div className="flex items-center justify-between gap-3 min-h-8">
        <span className="text-sm text-foreground leading-snug min-w-0">{contribution.label}</span>
        <span className="flex flex-wrap justify-end items-center gap-x-3 gap-y-1 shrink-0 max-w-[55%]">
          {contribution.bindings.map((binding, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a binding's only identity is its position
              key={index}
              className="flex items-center gap-1"
            >
              {acceleratorChips(binding, platform).map((chip) => (
                <KeyChip key={chip}>{chip}</KeyChip>
              ))}
            </span>
          ))}
        </span>
      </div>
    </li>
  );
}

/** Props for {@link AcceleratorHelp}. */
export interface AcceleratorHelpProps {
  /** Narrows the list to the rows whose words contain it. Empty keeps every row. */
  search?: string;
}

/**
 * The shortcuts the editor acts on right now, and only those, so nothing shown
 * is inert where it is shown. It follows the editor while this page is open,
 * waiting for the editor to settle before it swaps.
 *
 * The page renders nothing while no editor stands. Its docs tab is withdrawn in
 * that case, so the empty render is reachable only for as long as a closing
 * editor takes to withdraw it.
 */
export function AcceleratorHelp({ search = "" }: AcceleratorHelpProps) {
  const { editorMode } = useDocsSidebar();
  const settledMode = useSettledMode(editorMode, kSettleDelayMs);
  const platform = useMemo(currentPlatform, []);
  const live = useMemo(() => liveAcceleratorSection(settledMode), [settledMode]);
  const rows = useMemo(
    () => (live === undefined ? undefined : filterContributions(live.contributions, search, platform)),
    [live, search, platform]
  );

  if (live === undefined || rows === undefined) return null;

  return (
    <div data-accelerator-help="" data-accelerator-mode={live.mode}>
      <div data-accelerator-live="">
        <h2 className="text-base font-semibold text-foreground mb-0.5">Keyboard Shortcuts</h2>
        <p className="text-xs text-muted-foreground mb-2">{kModeNames[live.mode]}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No shortcuts match your search.</p>
        ) : (
          <ul className="list-none pl-0 m-0">
            {rows.map((contribution) => (
              <AcceleratorRow key={contribution.id} contribution={contribution} platform={platform} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
