import type { IBrainTileDef, RuleSide } from "@wendoo-lang/core/brain";
import type { BrainCommandHistory, BrainRuleDef } from "@wendoo-lang/core/brain/model";
import { useId, useState } from "react";
import { type ArmedTileTarget, isTileTargetForTile } from "./ArmedTargetContext";
import { useBrainEditorConfig } from "./BrainEditorContext";
import { BrainTile } from "./BrainTile";
import { BrainTileMenu } from "./BrainTileMenu";
import type { EditPointPosition } from "./edit-point";
import { editPointPositionOf } from "./edit-point";
import { usePageGrid } from "./PageGridContext";
import { kPageGridCellAttribute, pageGridCellKey } from "./page-grid-model";
import { pageGridSelectionProps } from "./page-grid-selection";
import { useRuleSelection } from "./RuleSelectionContext";
import type { TileBadge } from "./tile-badges";
import { tileAccessibleName } from "./tile-visual-utils";

/** What the armed edit point on this tile is described as, by the position it sits at. */
const editPointHints: Record<EditPointPosition, string> = {
  before: "armed to insert a tile before it",
  replace: "armed to be replaced",
  after: "armed to insert a tile after it",
};

interface BrainTileEditorProps {
  tileDef: IBrainTileDef;
  tileIndex: number;
  side: RuleSide;
  ruleDef: BrainRuleDef;
  commandHistory: BrainCommandHistory;
  badge?: TileBadge;
  /**
   * The target armed on this tile's own rule, or null while the editor's arming
   * stands elsewhere. The tile reads its own arming out of it.
   */
  stripTarget: ArmedTileTarget | null;
  /** Arms the edit point on this tile at `position`, which the candidate strip then serves. */
  armEditPoint: (position: EditPointPosition) => void;
}

/**
 * A {@link BrainTile} carrying the gestures of a placed tile: a tap arms the
 * edit point in the tile's place, and a right-click or touch long-press opens
 * the tile's own menu of edit actions.
 */
export function BrainTileEditor({
  tileDef,
  tileIndex,
  side,
  ruleDef,
  commandHistory,
  badge,
  stripTarget,
  armEditPoint,
}: BrainTileEditorProps) {
  const tileTarget = isTileTargetForTile(stripTarget, ruleDef, side, tileIndex) ? stripTarget : null;
  const armedHintId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const editorConfig = useBrainEditorConfig();

  // The tile's place in the page's selection grid: one cell of its rule's
  // structural row, named by where it stands among the tiles of its side.
  const pageGrid = usePageGrid();
  const selectedCell = useRuleSelection();
  const cellKey = pageGridCellKey({ kind: "tile", ruleId: ruleDef.ruleId(), side, tileIndex });
  const cellName = `Tile ${tileIndex + 1} of ${ruleDef.side(side).tiles().size()}, ${tileAccessibleName(editorConfig, tileDef)}`;
  const isSelectedCell = selectedCell !== undefined && pageGridCellKey(selectedCell) === cellKey;
  const cellProps =
    pageGrid === undefined
      ? undefined
      : {
          [kPageGridCellAttribute]: cellKey,
          tabIndex: isSelectedCell ? 0 : -1,
          ...pageGridSelectionProps("chip", isSelectedCell),
        };

  // A long-press opens the menu and the touch still reports a click on release,
  // which must not also arm the edit point the tap arms.
  const handleTileTap = () => {
    if (menuOpen) return;
    armEditPoint("replace");
  };

  return (
    <>
      <BrainTileMenu
        tileDef={tileDef}
        side={side}
        tileIndex={tileIndex}
        ruleDef={ruleDef}
        commandHistory={commandHistory}
        onOpenChange={setMenuOpen}
      >
        <BrainTile
          tileDef={tileDef}
          side={side}
          badge={badge}
          aria-label={cellName}
          aria-describedby={tileTarget ? armedHintId : undefined}
          onClick={handleTileTap}
          // An armed tile carries its ring at the tile's edge, and stands the
          // selection's outline outside it.
          className={tileTarget ? "ring-[3px] ring-brain-armed outline-offset-[3px]" : ""}
          {...cellProps}
        />
      </BrainTileMenu>

      {tileTarget && (
        <span id={armedHintId} className="sr-only">
          {editPointHints[editPointPositionOf(tileTarget, tileIndex)]}
        </span>
      )}
    </>
  );
}
