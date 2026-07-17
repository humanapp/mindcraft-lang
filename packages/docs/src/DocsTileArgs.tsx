import { cn } from "@mindcraft-lang/ui";
import type { ActionArgTypeEntry } from "@mindcraft-lang/ui/brain-editor/action-arg-tiles";
import { getActionArgEntries, resolveTypeDisplayName } from "@mindcraft-lang/ui/brain-editor/action-arg-tiles";
import { useMemo } from "react";
import { InlineTileIcon } from "./DocsRule";
import { useDocsResolveTileVisual, useDocsSidebar } from "./DocsSidebarContext";

/** Concept page id the anonymous value-type chips link to. */
const DATA_TYPES_CONCEPT_ID = "data-types";

const kTypeChipColor = "#475569";

interface DocsTileArgsSectionProps {
  /** Tile id of the doc page being shown. */
  tileId: string;
}

/** Chip rendering of an anonymous value type: the app's type icon (when mapped) plus the display name. */
function InlineTypeIcon({
  name,
  iconUrl,
  className,
}: {
  name: string;
  iconUrl: string | undefined;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 min-w-max items-center gap-0.5 align-middle px-1 py-0.5 rounded border text-xs font-mono font-normal text-nowrap",
        className
      )}
      style={{ borderColor: kTypeChipColor, backgroundColor: "rgba(71,85,105,0.15)", color: "#e2e8f0" }}
      title={name}
    >
      {iconUrl && <img src={iconUrl} alt="" className="w-3.5 h-3.5 mr-px inline-block" aria-hidden="true" />}
      {name}
    </span>
  );
}

/**
 * Muted qualifier half of a split pill, joined to the right edge of the chip
 * of an entry whose slot takes its value directly, without the tile being
 * placed.
 */
function AnonymousTag() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-r border border-l-0 border-border bg-muted px-1 text-[10px] text-muted-foreground">
      anonymous
    </span>
  );
}

/**
 * Chip for one anonymous value type an action accepts; links to the data-types
 * concept page when registered. Rendered with a squared right edge as the chip
 * half of a split pill, joined to an {@link AnonymousTag}.
 */
function TypeEntryChip({ entry }: { entry: ActionArgTypeEntry }) {
  const { registry, tileCatalog, brainServices, dataTypeNames, dataTypeIcons, navigateToEntry } = useDocsSidebar();
  const typeRegistry = brainServices?.runtime.types;
  const name = resolveTypeDisplayName(entry.typeId, {
    dataTypeNames,
    getTileDef: (argTileId) => tileCatalog?.get(argTileId),
    getTypeName: (typeId) => typeRegistry?.get(typeId)?.name,
  });
  const iconUrl = dataTypeIcons?.get(entry.typeId);

  if (!registry.concepts.has(DATA_TYPES_CONCEPT_ID)) {
    return <InlineTypeIcon name={name} iconUrl={iconUrl} className="rounded-r-none" />;
  }
  return (
    <button
      type="button"
      onClick={() => navigateToEntry("concepts", DATA_TYPES_CONCEPT_ID)}
      className="inline-flex shrink-0 cursor-pointer hover:brightness-125 transition-[filter]"
      aria-label={`View docs for the ${name} data type`}
    >
      <InlineTypeIcon name={name} iconUrl={iconUrl} className="rounded-r-none" />
    </button>
  );
}

/**
 * Bottom-of-page section on a sensor or actuator doc page listing the
 * parameter and modifier surface the action's call spec places, in
 * declaration order. Parameter and modifier tiles render as chips linking to
 * their doc pages; anonymous value slots render as type chips linking to the
 * data-types concept page. An entry whose slot fills anonymously renders as a
 * split pill: the chip joined to a muted "anonymous" tag. Renders nothing
 * when the tile is not an action or places no parameters, modifiers, or
 * anonymous values.
 */
export function DocsTileArgsSection({ tileId }: DocsTileArgsSectionProps) {
  const { tileCatalog, navigateToEntry } = useDocsSidebar();
  const resolveTileVisual = useDocsResolveTileVisual();

  const entries = useMemo(
    () => getActionArgEntries(tileCatalog?.get(tileId), (argTileId) => tileCatalog?.get(argTileId)),
    [tileId, tileCatalog]
  );

  if (entries.length === 0) {
    return null;
  }

  return (
    <section data-testid="docs-tile-args">
      <h2 className="text-sm font-semibold text-foreground mt-3 mb-1.5 border-b border-border pb-1">
        Parameters &amp; Modifiers
      </h2>
      <div className="flex flex-wrap items-center gap-1.5">
        {entries.map((entry) => {
          if (entry.kind === "type") {
            return (
              <span key={`type:${entry.typeId}`} className="inline-flex shrink-0 items-stretch">
                <TypeEntryChip entry={entry} />
                <AnonymousTag />
              </span>
            );
          }
          const label = resolveTileVisual(entry.tileDef)?.label ?? entry.tileDef.tileId;
          return (
            <span key={`tile:${entry.tileDef.tileId}`} className="inline-flex shrink-0 items-stretch">
              <button
                type="button"
                onClick={() => navigateToEntry("tiles", entry.tileDef.tileId)}
                className="inline-flex shrink-0 cursor-pointer hover:brightness-125 transition-[filter]"
                aria-label={`View docs for ${label}`}
              >
                <InlineTileIcon tileDef={entry.tileDef} className={entry.anonymous ? "rounded-r-none" : undefined} />
              </button>
              {entry.anonymous && <AnonymousTag />}
            </span>
          );
        })}
      </div>
    </section>
  );
}
