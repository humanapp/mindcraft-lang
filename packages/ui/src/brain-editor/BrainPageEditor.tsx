import type { ReadonlyList } from "@mindcraft-lang/core";
import { task, type thread } from "@mindcraft-lang/core";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { BrainCommand, BrainCommandHistory, BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  AddRuleCommand,
  IndentRuleCommand,
  MoveRuleDownCommand,
  MoveRuleUpCommand,
  OutdentRuleCommand,
} from "@mindcraft-lang/core/brain/model";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { keyboardIsUnheld, kStripPopupAttribute } from "./BrainCandidateStrip";
import { BrainRuleEditor, kAddButtonClasses } from "./BrainRuleEditor";
import { kOfferingLayer, kRuleContentLayer } from "./editor-layers";
import { useRuleDrag } from "./hooks/useRuleDrag";
import { PageGridProvider } from "./PageGridContext";
import {
  decidePageGridOperation,
  decidePageKey,
  kAppendRuleCell,
  kPageGridCellAttribute,
  type PageGridCell,
  type PageGridCursor,
  pageGridCellKey,
  pageGridCellPosition,
  pageGridRows,
  type RuleCellDescriptor,
  type RuleMoveDirection,
  resolvePageGridCursor,
  ruleMoveDirections,
} from "./page-grid-model";
import { pageGridSelectionProps, ruleSelectionCell } from "./page-grid-selection";
import { RuleDragProvider } from "./RuleDragContext";
import { useRulePickup } from "./RulePickupContext";
import { RuleSelectionProvider } from "./RuleSelectionContext";
import { type RevisionRuleNode, ruleRevisions } from "./rule-revision";

interface BrainPageEditorProps {
  pageDef: BrainPageDef;
  commandHistory: BrainCommandHistory;
  zoom?: number;
}

type FlattenedRule = {
  ruleDef: BrainRuleDef;
  depth: number;
  lineNumber: number;
};

/**
 * Flatten a hierarchical rule structure into a linear list with depth information.
 */
function flattenRules(rules: BrainRuleDef[], depth: number = 0, startLineNumber: number = 1): FlattenedRule[] {
  const result: FlattenedRule[] = [];
  let currentLineNumber = startLineNumber;

  rules.forEach((ruleDef) => {
    result.push({
      ruleDef,
      depth,
      lineNumber: currentLineNumber,
    });
    currentLineNumber++;

    if (ruleDef.children().size() > 0) {
      const childRules = flattenRules(ruleDef.children().toArray() as BrainRuleDef[], depth + 1, currentLineNumber);
      result.push(...childRules);
      currentLineNumber += childRules.length;
    }
  });

  return result;
}

/** The ids of `tiles`, in the order they stand. */
function tileIdsOf(tiles: ReadonlyList<IBrainTileDef>): string[] {
  const ids: string[] = [];
  for (let i = 0; i < tiles.size(); i++) ids.push(tiles.get(i).tileId);
  return ids;
}

/**
 * `rules` and the trees under them read as revision nodes. Walks children in the
 * order they stand, so {@link ruleRevisions} reads the same rules in the same
 * order {@link flattenRules} lists them, and the two line up index for index.
 */
function revisionNodes(rules: BrainRuleDef[]): RevisionRuleNode[] {
  return rules.map((ruleDef) => ({
    whenTileIds: tileIdsOf(ruleDef.when().tiles()),
    doTileIds: tileIdsOf(ruleDef.do().tiles()),
    children: revisionNodes(ruleDef.children().toArray() as BrainRuleDef[]),
  }));
}

/**
 * Whether giving the keyboard to a cell may move the scrollports it sits in.
 * `keep-scroll` leaves the view exactly where the user left it, which handing
 * the keyboard back to the selection does; `reveal` lets the browser bring the
 * cell into view, which a step the user asked for does.
 */
type CellFocusScroll = "keep-scroll" | "reveal";

/** The element standing for the cell `key`, or null while nothing in `container` does. */
function cellElement(container: HTMLElement | null, key: string): HTMLElement | null {
  if (container === null) return null;
  for (const element of container.querySelectorAll<HTMLElement>(`[${kPageGridCellAttribute}]`)) {
    if (element.getAttribute(kPageGridCellAttribute) === key) return element;
  }
  return null;
}

/** The cell `target` stands for or stands inside, or null for an element outside every cell. */
function cellOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(`[${kPageGridCellAttribute}]`) : null;
}

/**
 * True when the keyboard passing to `gaining` keeps it in the rules `container`
 * holds: an element the container contains, or one inside a popup a control of
 * the rules opened, which a portal renders outside the container's subtree. A
 * `gaining` of null is the keyboard landing on the document body, which no
 * element holds.
 */
function keyboardStaysInGrid(container: HTMLElement | null, gaining: Element | null): boolean {
  if (gaining === null) return false;
  return container?.contains(gaining) === true || gaining.closest(`[${kStripPopupAttribute}]`) !== null;
}

/** The command that takes `ruleDef` one step in `direction`. */
function ruleMoveCommand(ruleDef: BrainRuleDef, direction: RuleMoveDirection): BrainCommand {
  switch (direction) {
    case "up":
      return new MoveRuleUpCommand(ruleDef);
    case "down":
      return new MoveRuleDownCommand(ruleDef);
    case "indent":
      return new IndentRuleCommand(ruleDef);
    case "outdent":
      return new OutdentRuleCommand(ruleDef);
  }
}

/** The steps `ruleDef` can take from where it stands right now. */
function currentMoveDirections(ruleDef: BrainRuleDef): RuleMoveDirection[] {
  return ruleMoveDirections({
    canMoveUp: ruleDef.canMoveUp(),
    canMoveDown: ruleDef.canMoveDown(),
    canIndent: ruleDef.canIndent(),
    canOutdent: ruleDef.canOutdent(),
  });
}

/** Where `ruleDef` stands among the rules it shares a parent with, counting from one. */
function siblingPlace(ruleDef: BrainRuleDef, pageDef: BrainPageDef): { position: number; count: number } {
  const ancestor = ruleDef.ancestor() as BrainRuleDef | undefined;
  const siblings = ancestor ? ancestor.children() : pageDef.children();
  return { position: siblings.indexOf(ruleDef) + 1, count: siblings.size() };
}

/** How the page reads out where `ruleDef` of `pageDef` came to rest after a step in `direction`. */
function restingPlace(ruleDef: BrainRuleDef, direction: RuleMoveDirection, pageDef: BrainPageDef): string {
  if (direction === "up" || direction === "down") {
    const place = siblingPlace(ruleDef, pageDef);
    return `Moved to position ${place.position} of ${place.count}`;
  }
  const ancestor = ruleDef.ancestor() as BrainRuleDef | undefined;
  const verb = direction === "indent" ? "Indented" : "Outdented";
  if (ancestor === undefined) return `${verb} to the top level`;
  const parentLine = flattenRules(pageDef.children().toArray() as BrainRuleDef[]).find(
    (flatRule) => flatRule.ruleDef === ancestor
  )?.lineNumber;
  return parentLine === undefined ? `${verb} to the top level` : `${verb} under rule ${parentLine}`;
}

/** Renders the rules of a single brain page as a flattened, indented list of {@link BrainRuleEditor} rows. */
export function BrainPageEditor({ pageDef, commandHistory, zoom = 1 }: BrainPageEditorProps) {
  // Bumped by every change the page can see, which re-reads the rules the page
  // holds and the revision each of them stands at. The count itself is read for
  // nothing; a rule recomputes from its own revision, not from this.
  const [, rereadPage] = useState(0);
  const parseTimerRef = useRef<thread | null>(null);
  const PARSE_DEBOUNCE_SECS = 0.3;

  // Every change the page hears re-reads its rules and schedules one typecheck
  // of the whole page. A rule typechecks against the rule above it at its own
  // level, so a rule joining or leaving the page changes what its neighbours
  // check to while dirtying none of them; a change that dirties nothing is
  // still a reason to check. The check skips the rules it finds unchanged, and
  // the delay coalesces a burst of changes into one check.
  useEffect(() => {
    const cancelParseTimer = () => {
      if (parseTimerRef.current) {
        task.cancel(parseTimerRef.current);
        parseTimerRef.current = null;
      }
    };

    const onPageChanged = () => {
      rereadPage((prev) => prev + 1);
      cancelParseTimer();
      parseTimerRef.current = task.delay(PARSE_DEBOUNCE_SECS, () => {
        parseTimerRef.current = null;
        pageDef.typecheck();
      });
    };

    const unsub = pageDef.events().on("page_changed", onPageChanged);
    return () => {
      unsub();
      cancelParseTimer();
    };
  }, [pageDef]);

  const topLevelRules = pageDef.children().toArray() as BrainRuleDef[];
  const flattenedRules = flattenRules(topLevelRules);
  // What each rule derives its reading, its capabilities and its offering from,
  // listed in the order `flattenedRules` lists the rules themselves. A rule
  // whose revision is unchanged has nothing to recompute.
  const revisions = ruleRevisions(revisionNodes(topLevelRules));

  const containerRef = useRef<HTMLDivElement | null>(null);
  // The rail the armed rule stands its offering in, held as state so the rule
  // renders into it on the commit that mounts it.
  const [offeringRail, setOfferingRail] = useState<HTMLDivElement | null>(null);

  const dragController = useRuleDrag({ pageDef, commandHistory, containerRef, zoom });
  const dragContextValue = useMemo(
    () => ({ draggingRuleId: dragController.draggingRuleId, beginDrag: dragController.beginDrag }),
    [dragController.draggingRuleId, dragController.beginDrag]
  );

  // The cells each rule stands, keyed by rule id.
  const [ruleCells, setRuleCells] = useState<ReadonlyMap<string, RuleCellDescriptor>>(() => new Map());
  const [cursor, setCursor] = useState<PageGridCursor | undefined>(undefined);
  // The rule waiting to be composed, which the insertion that made it names.
  const [ruleToCompose, setRuleToCompose] = useState<string | undefined>(undefined);
  // The rows the selection was last settled against, which name the place its
  // cell stood in before the page's cells changed.
  const settledRowsRef = useRef<readonly (readonly PageGridCell[])[] | undefined>(undefined);

  const registerRule = useCallback((descriptor: RuleCellDescriptor) => {
    setRuleCells((current) => new Map(current).set(descriptor.ruleId, descriptor));
    return () => {
      setRuleCells((current) => {
        const next = new Map(current);
        next.delete(descriptor.ruleId);
        return next;
      });
    };
  }, []);

  const descriptors = flattenedRules
    .map((flatRule) => ruleCells.get(flatRule.ruleDef.ruleId()))
    .filter((descriptor): descriptor is RuleCellDescriptor => descriptor !== undefined);
  const rows = pageGridRows(descriptors);
  // True once every rule the page renders has registered the cells it stands,
  // so the grid reads the whole page.
  const gridIsWhole = descriptors.length === flattenedRules.length;
  // Every cell the page holds, in order, as one value that changes exactly when
  // the grid does.
  const gridSignature = rows.map((row) => row.map(pageGridCellKey).join(" ")).join("|");

  /** Gives the keyboard to `cell`, or returns false while the page stands no element for it. */
  const focusCell = (cell: PageGridCell, scroll: CellFocusScroll): boolean => {
    const element = cellElement(containerRef.current, pageGridCellKey(cell));
    if (element === null) return false;
    element.focus({ preventScroll: scroll === "keep-scroll" });
    return true;
  };

  // The cell the selection currently rests on.
  const cursorRef = useRef<PageGridCursor | undefined>(undefined);
  cursorRef.current = cursor;
  const focusCellRef = useRef(focusCell);
  focusCellRef.current = focusCell;
  // True while the rules hold the keyboard: it rests somewhere in them,
  // including inside the offering a rule has open, or a press has just landed
  // in them.
  const heldKeyboardRef = useRef(false);

  // The keyboard is given back to the selected cell whenever it lands outside
  // the rules with nothing holding it: the control that held it stopped
  // rendering, or a press landed on the page's empty ground, either of which
  // drops it on the dialog's own container. Taking it back never moves the
  // view, so a selection standing off the fold is not scrolled to.
  useEffect(() => {
    const reclaim = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target !== null && containerRef.current?.contains(target) === true) {
        heldKeyboardRef.current = true;
        return;
      }
      if (!heldKeyboardRef.current) return;
      if (!keyboardIsUnheld()) {
        heldKeyboardRef.current = false;
        return;
      }
      const cell = cursorRef.current?.cell;
      if (cell !== undefined) focusCellRef.current(cell, "keep-scroll");
    };
    document.addEventListener("focusin", reclaim);
    return () => document.removeEventListener("focusin", reclaim);
  }, []);

  // The selection always addresses a cell the page still holds: it opens on the
  // first rule's handle, or on the add-rule control for a page holding no rules,
  // and hands a vanished cell on to whatever now stands in the place that cell
  // last held. The keyboard is only taken back where nothing else has claimed
  // it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: gridSignature stands for the rows it is built from
  useEffect(() => {
    if (cursor === undefined && !gridIsWhole) return;
    const settled = settledRowsRef.current;
    const landing =
      cursor === undefined || settled === undefined ? undefined : pageGridCellPosition(settled, cursor.cell);
    const anchored = resolvePageGridCursor(rows, cursor?.cell, landing);
    settledRowsRef.current = rows;
    if (cursor !== undefined && pageGridCellKey(anchored.cell) === pageGridCellKey(cursor.cell)) return;
    if (cursor !== undefined && keyboardIsUnheld()) focusCell(anchored.cell, "keep-scroll");
    setCursor(anchored);
  }, [gridSignature, cursor, gridIsWhole]);

  // The page lands the keyboard on the cell its selection opens on -- the first
  // rule's handle -- as soon as that selection has a cell to rest on, and one
  // time only. The page is rendered afresh for every page the editor moves to,
  // so the landing takes the keyboard from the control that moved here.
  const hasTakenKeyboardRef = useRef(false);
  useEffect(() => {
    if (hasTakenKeyboardRef.current || cursor === undefined) return;
    hasTakenKeyboardRef.current = focusCellRef.current(cursor.cell, "keep-scroll");
  }, [cursor]);

  // A press landing anywhere in the rules is the rules taking the keyboard,
  // whether or not what it landed on can hold it. It runs before the press moves
  // the keyboard, so a press landing on ground no control stands on drops the
  // keyboard on the dialog around the rules and is given straight back to the
  // selection.
  const handleGridPointerDown = () => {
    heldKeyboardRef.current = true;
  };

  // The keyboard landing anywhere in a cell makes that cell the selected one,
  // whether it landed on the cell or on a control the cell holds.
  const handleGridFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const element = cellOf(event.target);
    const key = element?.getAttribute(kPageGridCellAttribute);
    if (!key) return;
    setCursor((current) => {
      if (current !== undefined && pageGridCellKey(current.cell) === key) return current;
      const landed = rows.flat().find((cell) => pageGridCellKey(cell) === key);
      return landed === undefined ? current : resolvePageGridCursor(rows, landed);
    });
  };

  // The rule the page holds picked up, whose moves gather into one history
  // entry, and the line a screen reader is told about each step a rule takes,
  // whether it was picked up or stepped where it stands.
  const rulePickup = useRulePickup();
  const pickup = rulePickup.pickup;
  const [moveAnnouncement, setMoveAnnouncement] = useState("");

  const setPickup = rulePickup.setPickup;
  const flattenedRulesRef = useRef(flattenedRules);
  flattenedRulesRef.current = flattenedRules;

  /** The rule `ruleId` names, or undefined once the page no longer holds it. */
  const ruleById = useCallback(
    (ruleId: string): BrainRuleDef | undefined =>
      flattenedRulesRef.current.find((flatRule) => flatRule.ruleDef.ruleId() === ruleId)?.ruleDef,
    []
  );

  /** Picks `ruleId` up, opening the batch its moves gather into. */
  const grabRule = useCallback(
    (ruleId: string) => {
      if (commandHistory.isBatchOpen()) return;
      const ruleDef = ruleById(ruleId);
      if (ruleDef === undefined) return;
      commandHistory.beginBatch("Move rule");
      setPickup({ ruleId, directions: currentMoveDirections(ruleDef) });
      const place = siblingPlace(ruleDef, pageDef);
      setMoveAnnouncement(`Grabbed rule, position ${place.position} of ${place.count}`);
    },
    [commandHistory, ruleById, setPickup, pageDef]
  );

  // How many steps a rule has taken, and the rule that took the last of them.
  const [stepCount, setStepCount] = useState(0);
  const steppedRuleIdRef = useRef<string | undefined>(undefined);
  const heldRuleIdRef = useRef<string | undefined>(undefined);
  heldRuleIdRef.current = pickup?.ruleId;

  // Brings the handle of a rule that has just taken a step back into view, in
  // one step and moving nothing where the handle already stands in view.
  useLayoutEffect(() => {
    if (stepCount === 0 || steppedRuleIdRef.current === undefined) return;
    const handle = containerRef.current?.querySelector<HTMLElement>(`[data-rule-handle="${steppedRuleIdRef.current}"]`);
    handle?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [stepCount]);

  /**
   * Takes `ruleId` one step in `direction` and reads out where it came to rest,
   * leaving it where it stands when the model refuses that step or the page no
   * longer holds it. A step of the rule the page has picked up joins the batch
   * that pick-up opened; every other step is a history entry of its own.
   */
  const moveRule = useCallback(
    (ruleId: string, direction: RuleMoveDirection) => {
      const ruleDef = ruleById(ruleId);
      if (ruleDef === undefined || !currentMoveDirections(ruleDef).includes(direction)) return;
      commandHistory.executeCommand(ruleMoveCommand(ruleDef, direction));
      if (heldRuleIdRef.current === ruleId) setPickup({ ruleId, directions: currentMoveDirections(ruleDef) });
      steppedRuleIdRef.current = ruleId;
      setMoveAnnouncement(restingPlace(ruleDef, direction, pageDef));
      setStepCount((count) => count + 1);
    },
    [commandHistory, ruleById, setPickup, pageDef]
  );

  /** Sets the held rule down, closing its batch into one history entry. */
  const dropHeldRule = () => {
    if (pickup === null) return;
    commandHistory.endBatch();
    setPickup(null);
    setMoveAnnouncement("Dropped");
  };

  /** Gives the held rule back to where it was picked up from, leaving no history entry. */
  const cancelHeldRule = () => {
    if (pickup === null) return;
    commandHistory.abortBatch();
    setPickup(null);
    setMoveAnnouncement("Cancelled");
  };

  // A press is never part of the grab, so any press sets the held rule down
  // where it stands. It runs before anything the press itself does, so the
  // batch is already closed and no command the press goes on to issue can join
  // the entry the pick-up makes; the press is then left to do its own work.
  const dropHeldRuleRef = useRef(dropHeldRule);
  dropHeldRuleRef.current = dropHeldRule;
  const isHoldingRule = pickup !== null;
  useEffect(() => {
    if (!isHoldingRule) return;
    const drop = () => dropHeldRuleRef.current();
    document.addEventListener("pointerdown", drop, true);
    return () => document.removeEventListener("pointerdown", drop, true);
  }, [isHoldingRule]);

  /** Puts an empty rule at the end of the page and asks for it to be composed. */
  const appendRule = () => {
    commandHistory.executeCommand(new AddRuleCommand(pageDef));
    const children = pageDef.children();
    const appended = children.get(children.size() - 1) as BrainRuleDef | undefined;
    if (appended !== undefined) setRuleToCompose(appended.ruleId());
  };

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const element = cellOf(event.target);
    if (element === null) return;
    const press = {
      key: event.key,
      withCommand: event.metaKey || event.ctrlKey,
      placement: element === event.target ? "on-cell" : "inside-cell",
    } as const;
    // The add-rule control is the page's own cell, which no rule card serves.
    if (element.getAttribute(kPageGridCellAttribute) === pageGridCellKey(kAppendRuleCell)) {
      if (decidePageGridOperation(kAppendRuleCell, press)?.verb === "insert-rule") {
        event.preventDefault();
        appendRule();
        return;
      }
    }
    const result = decidePageKey(rows, cursor, press, pickup?.ruleId);
    switch (result.kind) {
      case "inert":
        return;
      case "consume":
        event.preventDefault();
        return;
      case "select":
        if (!focusCell(result.cursor.cell, "reveal")) return;
        event.preventDefault();
        setCursor(result.cursor);
        return;
      case "move-rule":
        event.preventDefault();
        moveRule(result.ruleId, result.direction);
        return;
      case "drop":
        event.preventDefault();
        dropHeldRule();
        return;
      case "cancel":
        event.preventDefault();
        cancelHeldRule();
        return;
    }
  };

  // The keyboard leaving the rules for anything else the document holds sets a
  // held rule down where it stands, closing its batch into the one history entry
  // the whole pick-up makes. Steps within the grid, and a popup a control of the
  // rules opens, keep the keyboard here and leave the rule held.
  const handleGridBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (pickup === null || keyboardStaysInGrid(containerRef.current, event.relatedTarget)) return;
    dropHeldRule();
  };

  const appendRuleSelected = cursor !== undefined && cursor.cell.kind === "append-rule";

  const gridBinding = useMemo(
    () => ({
      registerRule,
      ruleToCompose,
      composeRule: setRuleToCompose,
      grabRule,
      moveRule,
      offeringRail,
    }),
    [registerRule, ruleToCompose, grabRule, moveRule, offeringRail]
  );

  // A page that stops rendering gives back any rule it holds and closes its
  // open batch.
  const rulePickupRef = useRef(rulePickup);
  rulePickupRef.current = rulePickup;
  useEffect(() => {
    return () => {
      if (commandHistory.isBatchOpen()) commandHistory.abortBatch();
      rulePickupRef.current.setPickup(null);
    };
  }, [commandHistory]);

  return (
    <RuleDragProvider value={dragContextValue}>
      <PageGridProvider value={gridBinding}>
        {/* The frame the rules stand inside. It does not scroll, and the ring
            it wears while the rules hold the keyboard lies on its border,
            outside the box the scrolling rules are clipped to. */}
        <div className="brain-page-frame h-full">
          {/* biome-ignore lint/a11y/useSemanticElements: changing to ul/li requires restructuring BrainRuleEditor */}
          <div
            ref={containerRef}
            className="h-full overflow-auto"
            role="list"
            aria-label="Brain rules"
            onPointerDown={handleGridPointerDown}
            onFocus={handleGridFocus}
            onBlur={handleGridBlur}
            onKeyDown={handleGridKeyDown}
          >
            {/* The rail the armed rule's offering stands in. It takes no space
                and lays out at the top of the scroller's content, so an
                offering placed against it scrolls with the rules up and down;
                sticking it to the left edge holds it against the scrollport
                sideways, on the compositor and with no measurement of the
                scroll. It stands outside the transform below, so what it holds
                keeps its own size whatever the rules are zoomed to. */}
            <div ref={setOfferingRail} className={`sticky left-0 h-0 w-full ${kOfferingLayer}`} />
            {/* The column the rule cards lay out in. */}
            <div
              className="p-2 sm:p-4"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                width: `${100 / zoom}%`,
                minHeight: `${100 / zoom}%`,
              }}
            >
              {flattenedRules.map((flatRule, index) => (
                <RuleSelectionProvider
                  key={flatRule.ruleDef.ruleId()}
                  value={ruleSelectionCell(cursor?.cell, flatRule.ruleDef.ruleId())}
                >
                  <BrainRuleEditor
                    ruleDef={flatRule.ruleDef}
                    depth={flatRule.depth}
                    lineNumber={flatRule.lineNumber}
                    ruleCount={flattenedRules.length}
                    revision={revisions[index]}
                    commandHistory={commandHistory}
                  />
                </RuleSelectionProvider>
              ))}
              {/* The box carries a rule card's own border and padding, which
                  puts the control in the column a root rule's handle stands
                  in. */}
              <div className="w-fit border border-transparent p-2 sm:p-3">
                <button
                  type="button"
                  className={kAddButtonClasses}
                  onClick={appendRule}
                  aria-label="Add rule at the end of the page"
                  {...{ [kPageGridCellAttribute]: pageGridCellKey(kAppendRuleCell) }}
                  {...pageGridSelectionProps("circle", appendRuleSelected)}
                  tabIndex={appendRuleSelected ? 0 : -1}
                >
                  <Plus className={`h-4 w-4 relative ${kRuleContentLayer}`} aria-hidden="true" />
                </button>
              </div>
            </div>
            <output aria-live="polite" className="sr-only">
              {moveAnnouncement}
            </output>
          </div>
        </div>
      </PageGridProvider>
    </RuleDragProvider>
  );
}
