import { task, type thread } from "@mindcraft-lang/core";
import type { BrainCommandHistory, BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keyboardIsUnheld } from "./BrainCandidateStrip";
import { BrainRuleEditor } from "./BrainRuleEditor";
import { useRuleDrag } from "./hooks/useRuleDrag";
import { PageGridProvider } from "./PageGridContext";
import {
  decidePageGridKey,
  kPageGridCellAttribute,
  type PageGridCell,
  type PageGridCursor,
  type PageGridPosition,
  pageGridCellKey,
  pageGridCellPosition,
  pageGridRows,
  type RuleCellDescriptor,
  resolvePageGridCursor,
} from "./page-grid-model";
import { RuleDragProvider } from "./RuleDragContext";
import { decideTrailingEmptyRule } from "./trailing-empty-rule";

interface BrainPageEditorProps {
  pageDef: BrainPageDef;
  pageNumber?: number;
  commandHistory: BrainCommandHistory;
  zoom?: number;
}

type FlattenedRule = {
  ruleDef: BrainRuleDef;
  index: number;
  depth: number;
  lineNumber: number;
};

/**
 * Flatten a hierarchical rule structure into a linear list with depth information.
 */
function flattenRules(rules: BrainRuleDef[], depth: number = 0, startLineNumber: number = 1): FlattenedRule[] {
  const result: FlattenedRule[] = [];
  let currentLineNumber = startLineNumber;

  rules.forEach((ruleDef, index) => {
    result.push({
      ruleDef,
      index,
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

/** Renders the rules of a single brain page as a flattened, indented list of {@link BrainRuleEditor} rows. */
export function BrainPageEditor({ pageDef, pageNumber, commandHistory, zoom = 1 }: BrainPageEditorProps) {
  const [ruleCount, setRuleCount] = useState(pageDef.children().size());
  const [updateCounter, setUpdateCounter] = useState(0);
  const parseTimerRef = useRef<thread | null>(null);
  // The trailing empty rules this editor appended, which are the only ones it
  // ever takes back.
  const appendedRulesRef = useRef<WeakSet<BrainRuleDef>>(new WeakSet());
  const PARSE_DEBOUNCE_SECS = 0.3;

  useEffect(() => {
    const onPageChanged = ({ what }: { what: string; ruleWhat?: unknown }) => {
      if (what === "rule_added" || what === "rule_removed") {
        setRuleCount(pageDef.children().size());
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

  // The page ends with exactly one empty rule: one is appended once the last
  // rule carries tiles, and a rule this editor appended is given back once
  // another empty rule stands ahead of it -- which is what undoing composed
  // words leaves behind. Each pass takes one step and re-runs on the change it
  // makes, so the page settles.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ruleCount and updateCounter are intentional trigger signals
  useEffect(() => {
    const children = pageDef.children();
    const isEmpty: boolean[] = [];
    const isAppended: boolean[] = [];
    for (let i = 0; i < children.size(); i++) {
      const ruleDef = children.get(i) as BrainRuleDef;
      isEmpty.push(ruleDef.isEmpty(true));
      isAppended.push(appendedRulesRef.current.has(ruleDef));
    }
    const action = decideTrailingEmptyRule({ isEmpty, isAppended });
    if (action.kind === "append") appendedRulesRef.current.add(pageDef.appendNewRule());
    else if (action.kind === "remove") pageDef.removeRuleAtIndex(action.index);
  }, [pageDef, ruleCount, updateCounter]);

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
  // The place the selection is to take once the cell it rests on leaves.
  const landingRef = useRef<PageGridPosition | undefined>(undefined);

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
  // Every cell the page holds, in order, as one value that changes exactly when
  // the grid does.
  const gridSignature = rows.map((row) => row.map(pageGridCellKey).join(" ")).join("|");

  const focusCell = (cell: PageGridCell): boolean => {
    const element = cellElement(containerRef.current, pageGridCellKey(cell));
    if (element === null) return false;
    element.focus();
    return true;
  };

  // The cell the selection currently rests on, and the rows it stands in.
  const cursorRef = useRef<PageGridCursor | undefined>(undefined);
  cursorRef.current = cursor;
  const rowsRef = useRef<readonly (readonly PageGridCell[])[]>(rows);
  rowsRef.current = rows;
  const focusCellRef = useRef(focusCell);
  focusCellRef.current = focusCell;
  // True while the keyboard is somewhere in the rules, including inside the
  // offering a rule has open.
  const heldKeyboardRef = useRef(false);

  // The keyboard is given back to the selected cell when the control holding it
  // stops rendering, which drops it on the dialog's own container.
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
      if (cell !== undefined) focusCellRef.current(cell);
    };
    document.addEventListener("focusin", reclaim);
    return () => document.removeEventListener("focusin", reclaim);
  }, []);

  // The selection always addresses a cell the page still holds: it opens on the
  // first rule's handle, and follows a vanished cell to a surviving one. The
  // keyboard is only taken back where nothing else has claimed it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: gridSignature stands for the rows it is built from
  useEffect(() => {
    const landing = landingRef.current;
    landingRef.current = undefined;
    const anchored = resolvePageGridCursor(rows, cursor?.cell, landing);
    if (anchored === undefined) {
      if (cursor !== undefined) setCursor(undefined);
      return;
    }
    if (cursor !== undefined && pageGridCellKey(anchored.cell) === pageGridCellKey(cursor.cell)) return;
    if (cursor !== undefined && keyboardIsUnheld()) focusCell(anchored.cell);
    setCursor(anchored);
  }, [gridSignature, cursor]);

  // True once the page has taken the keyboard onto its selection, which it does
  // one time, as soon as the selection has a cell to rest on and nothing else
  // holds the keyboard.
  const hasTakenKeyboardRef = useRef(false);
  useEffect(() => {
    if (hasTakenKeyboardRef.current || cursor === undefined || !keyboardIsUnheld()) return;
    hasTakenKeyboardRef.current = focusCellRef.current(cursor.cell);
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

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const element = cellOf(event.target);
    if (element === null) return;
    const result = decidePageGridKey(rows, cursor, event.key, element === event.target ? "on-cell" : "inside-cell");
    if (result.kind !== "move" || !focusCell(result.cursor.cell)) return;
    event.preventDefault();
    setCursor(result.cursor);
  };

  // The place the selection stands in now, held for the cell that is about to
  // leave the page.
  const holdSelectionPlace = useCallback(() => {
    landingRef.current =
      cursorRef.current === undefined ? undefined : pageGridCellPosition(rowsRef.current, cursorRef.current.cell);
  }, []);

  const gridBinding = useMemo(
    () => ({
      registerRule,
      currentCell: cursor?.cell,
      holdSelectionPlace,
      ruleToCompose,
      composeRule: setRuleToCompose,
    }),
    [registerRule, cursor, holdSelectionPlace, ruleToCompose]
  );

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
                index={flatRule.index}
                pageDef={pageDef}
                depth={flatRule.depth}
                lineNumber={flatRule.lineNumber}
                ruleCount={flattenedRules.length}
                updateCounter={updateCounter}
                commandHistory={commandHistory}
              />
            ))}
          </div>
        </div>
      </PageGridProvider>
    </RuleDragProvider>
  );
}
