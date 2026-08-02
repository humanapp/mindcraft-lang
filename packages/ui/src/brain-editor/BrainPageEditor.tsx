import { task, type thread } from "@mindcraft-lang/core";
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
import { keyboardIsUnheld } from "./BrainCandidateStrip";
import { BrainRuleEditor, kAddButtonClasses } from "./BrainRuleEditor";
import { kRuleContentLayer } from "./editor-layers";
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
import { RuleDragProvider } from "./RuleDragContext";
import { useRulePickup } from "./RulePickupContext";

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

/**
 * Whether giving the keyboard to a cell may move the scrollports it sits in.
 * `keep-scroll` leaves the view exactly where the user left it, which handing
 * the keyboard back to the selection does; `reveal` lets the browser bring the
 * cell into view, which a step the user asked for does.
 */
type CellFocusScroll = "keep-scroll" | "reveal";

/**
 * `FocusOptions` plus `focusVisible`, which asks the browser to mark the newly
 * focused element as keyboard-focused so `:focus-visible` matches it. The DOM
 * typings this package builds against do not carry the member yet.
 */
type CellFocusOptions = FocusOptions & { focusVisible?: boolean };

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

/** Renders the rules of a single brain page as a flattened, indented list of {@link BrainRuleEditor} rows. */
export function BrainPageEditor({ pageDef, commandHistory, zoom = 1 }: BrainPageEditorProps) {
  const [updateCounter, setUpdateCounter] = useState(0);
  const parseTimerRef = useRef<thread | null>(null);
  const PARSE_DEBOUNCE_SECS = 0.3;

  useEffect(() => {
    const onPageChanged = ({ what }: { what: string; ruleWhat?: unknown }) => {
      if (what === "rule_added" || what === "rule_removed") {
        setUpdateCounter((prev) => prev + 1);
      }
      // Force re-render for rule changes (moves, indents, outdents trigger rule_dirtyChanged, deletes trigger ruleDeleted)
      if (what === "rule_dirtyChanged" || what === "rule_deleted") {
        setUpdateCounter((prev) => prev + 1);
      }
    };

    const unsub = pageDef.events().on("page_changed", onPageChanged);
    return () => {
      unsub();
    };
  }, [pageDef]);

  // Debounced reparsing for all dirty rules
  useEffect(() => {
    const cancelParseTimer = () => {
      if (parseTimerRef.current) {
        task.cancel(parseTimerRef.current);
        parseTimerRef.current = null;
      }
    };

    const scheduleParsing = () => {
      cancelParseTimer();

      parseTimerRef.current = task.delay(PARSE_DEBOUNCE_SECS, () => {
        pageDef.typecheck();
        parseTimerRef.current = null;
      });
    };

    const onPageChanged = ({ what, ruleWhat }: { what: unknown; ruleWhat?: unknown }) => {
      if (
        what === "rule_dirtyChanged" &&
        ruleWhat !== null &&
        typeof ruleWhat === "object" &&
        "isDirty" in ruleWhat &&
        (ruleWhat as Record<string, unknown>).isDirty
      ) {
        scheduleParsing();
      }
    };

    const unsub = pageDef.events().on("page_changed", onPageChanged);
    return () => {
      unsub();
      if (parseTimerRef.current) {
        task.cancel(parseTimerRef.current);
        parseTimerRef.current = null;
      }
    };
  }, [pageDef]);

  const topLevelRules = pageDef.children().toArray() as BrainRuleDef[];
  const flattenedRules = flattenRules(topLevelRules);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragController = useRuleDrag({ pageDef, commandHistory, containerRef, zoom });
  const dragContextValue = useMemo(
    () => ({ draggingRuleId: dragController.draggingRuleId, beginDrag: dragController.beginDrag }),
    [dragController.draggingRuleId, dragController.beginDrag]
  );

  // The cells each rule stands, keyed by rule id.
  const [ruleCells, setRuleCells] = useState<ReadonlyMap<number, RuleCellDescriptor>>(() => new Map());
  const [cursor, setCursor] = useState<PageGridCursor | undefined>(undefined);
  // The rule waiting to be composed, which the insertion that made it names.
  const [ruleToCompose, setRuleToCompose] = useState<number | undefined>(undefined);
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
    .map((flatRule) => ruleCells.get(flatRule.ruleDef.id()))
    .filter((descriptor): descriptor is RuleCellDescriptor => descriptor !== undefined);
  const rows = pageGridRows(descriptors);
  // True once every rule the page renders has registered the cells it stands,
  // so the grid reads the whole page.
  const gridIsWhole = descriptors.length === flattenedRules.length;
  // Every cell the page holds, in order, as one value that changes exactly when
  // the grid does.
  const gridSignature = rows.map((row) => row.map(pageGridCellKey).join(" ")).join("|");

  // Every move the grid makes is the keyboard's, so each one asks for the mark a
  // keyboard focus paints: the browser reads a bare programmatic focus as
  // whatever modality last moved the keyboard, which leaves the cell unmarked
  // after a press elsewhere.
  const focusCell = (cell: PageGridCell, scroll: CellFocusScroll): boolean => {
    const element = cellElement(containerRef.current, pageGridCellKey(cell));
    if (element === null) return false;
    const options: CellFocusOptions = { preventScroll: scroll === "keep-scroll", focusVisible: true };
    element.focus(options);
    return true;
  };

  // The cell the selection currently rests on.
  const cursorRef = useRef<PageGridCursor | undefined>(undefined);
  cursorRef.current = cursor;
  const focusCellRef = useRef(focusCell);
  focusCellRef.current = focusCell;
  // True while the keyboard is somewhere in the rules, including inside the
  // offering a rule has open.
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

  // True once the page has taken the keyboard onto its selection, which it does
  // one time, as soon as the selection has a cell to rest on and nothing else
  // holds the keyboard.
  const hasTakenKeyboardRef = useRef(false);
  useEffect(() => {
    if (hasTakenKeyboardRef.current || cursor === undefined || !keyboardIsUnheld()) return;
    hasTakenKeyboardRef.current = focusCellRef.current(cursor.cell, "keep-scroll");
  }, [cursor]);

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
  // entry, and the line a screen reader is told about each step it takes.
  const rulePickup = useRulePickup();
  const pickup = rulePickup.pickup;
  const [pickupAnnouncement, setPickupAnnouncement] = useState("");

  const setPickup = rulePickup.setPickup;
  const flattenedRulesRef = useRef(flattenedRules);
  flattenedRulesRef.current = flattenedRules;

  /** The rule `ruleId` names, or undefined once the page no longer holds it. */
  const ruleById = useCallback(
    (ruleId: number): BrainRuleDef | undefined =>
      flattenedRulesRef.current.find((flatRule) => flatRule.ruleDef.id() === ruleId)?.ruleDef,
    []
  );

  /** How the page reads out where `ruleDef` came to rest after a step in `direction`. */
  const restingPlace = (ruleDef: BrainRuleDef, direction: RuleMoveDirection): string => {
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
  };

  /** Picks `ruleId` up, opening the batch its moves gather into. */
  const grabRule = useCallback(
    (ruleId: number) => {
      if (commandHistory.isBatchOpen()) return;
      const ruleDef = ruleById(ruleId);
      if (ruleDef === undefined) return;
      commandHistory.beginBatch("Move rule");
      setPickup({ ruleId, directions: currentMoveDirections(ruleDef) });
      const place = siblingPlace(ruleDef, pageDef);
      setPickupAnnouncement(`Grabbed rule, position ${place.position} of ${place.count}`);
    },
    [commandHistory, ruleById, setPickup, pageDef]
  );

  // How many steps the held rule has taken.
  const [stepCount, setStepCount] = useState(0);
  const heldRuleIdRef = useRef<number | undefined>(undefined);
  heldRuleIdRef.current = pickup?.ruleId;

  // Brings the handle of a rule that has just taken a step back into view, in
  // one step and moving nothing where the handle already stands in view.
  useLayoutEffect(() => {
    if (stepCount === 0 || heldRuleIdRef.current === undefined) return;
    const handle = containerRef.current?.querySelector<HTMLElement>(`[data-rule-handle="${heldRuleIdRef.current}"]`);
    handle?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [stepCount]);

  /** Takes the held rule one step in `direction`, or leaves it where it is when the model refuses that step. */
  const moveHeldRule = (direction: RuleMoveDirection) => {
    if (pickup === null || !pickup.directions.includes(direction)) return;
    const ruleDef = ruleById(pickup.ruleId);
    if (ruleDef === undefined) return;
    commandHistory.executeCommand(ruleMoveCommand(ruleDef, direction));
    setPickup({ ruleId: pickup.ruleId, directions: currentMoveDirections(ruleDef) });
    setPickupAnnouncement(restingPlace(ruleDef, direction));
    setStepCount((count) => count + 1);
  };

  /** Sets the held rule down, closing its batch into one history entry. */
  const dropHeldRule = () => {
    if (pickup === null) return;
    commandHistory.endBatch();
    setPickup(null);
    setPickupAnnouncement("Dropped");
  };

  /** Gives the held rule back to where it was picked up from, leaving no history entry. */
  const cancelHeldRule = () => {
    if (pickup === null) return;
    commandHistory.abortBatch();
    setPickup(null);
    setPickupAnnouncement("Cancelled");
  };

  /** Puts an empty rule at the end of the page and asks for it to be composed. */
  const appendRule = () => {
    commandHistory.executeCommand(new AddRuleCommand(pageDef));
    const children = pageDef.children();
    const appended = children.get(children.size() - 1) as BrainRuleDef | undefined;
    if (appended !== undefined) setRuleToCompose(appended.id());
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
    const result = decidePageKey(rows, cursor, press, pickup !== null);
    switch (result.kind) {
      case "inert":
        return;
      case "select":
        if (!focusCell(result.cursor.cell, "reveal")) return;
        event.preventDefault();
        setCursor(result.cursor);
        return;
      case "move-rule":
        event.preventDefault();
        moveHeldRule(result.direction);
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

  const gridBinding = useMemo(
    () => ({
      registerRule,
      currentCell: cursor?.cell,
      ruleToCompose,
      composeRule: setRuleToCompose,
      grabRule,
    }),
    [registerRule, cursor, ruleToCompose, grabRule]
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
        {/* biome-ignore lint/a11y/useSemanticElements: changing to ul/li requires restructuring BrainRuleEditor */}
        <div
          ref={containerRef}
          className="h-full overflow-auto"
          role="list"
          aria-label="Brain rules"
          onFocus={handleGridFocus}
          onKeyDown={handleGridKeyDown}
        >
          <div
            className="p-3 sm:p-6"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              width: `${100 / zoom}%`,
              minHeight: `${100 / zoom}%`,
            }}
          >
            {flattenedRules.map((flatRule) => (
              <BrainRuleEditor
                key={flatRule.ruleDef.id()}
                ruleDef={flatRule.ruleDef}
                depth={flatRule.depth}
                lineNumber={flatRule.lineNumber}
                ruleCount={flattenedRules.length}
                updateCounter={updateCounter}
                commandHistory={commandHistory}
              />
            ))}
            {/* The box carries a rule card's own border and padding, which puts
                the control in the column a root rule's handle stands in. */}
            <div className="w-fit border border-transparent p-2 sm:p-3">
              <button
                type="button"
                className={kAddButtonClasses}
                onClick={appendRule}
                aria-label="Add rule at the end of the page"
                {...{ [kPageGridCellAttribute]: pageGridCellKey(kAppendRuleCell) }}
                tabIndex={cursor !== undefined && cursor.cell.kind === "append-rule" ? 0 : -1}
              >
                <Plus className={`h-4 w-4 relative ${kRuleContentLayer}`} aria-hidden="true" />
              </button>
            </div>
          </div>
          <output aria-live="polite" className="sr-only">
            {pickupAnnouncement}
          </output>
        </div>
      </PageGridProvider>
    </RuleDragProvider>
  );
}
