import { task, type thread } from "@mindcraft-lang/core";
import type { BrainCommandHistory, BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrainRuleEditor } from "./BrainRuleEditor";
import { useRuleDrag } from "./hooks/useRuleDrag";
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
  // The page keeps an empty rule at its end; that rule carries the sentence
  // composer's entry point.
  const lastTopLevelRule = topLevelRules.length > 0 ? topLevelRules[topLevelRules.length - 1] : undefined;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragController = useRuleDrag({ pageDef, commandHistory, containerRef, zoom });
  const dragContextValue = useMemo(
    () => ({ draggingRuleId: dragController.draggingRuleId, beginDrag: dragController.beginDrag }),
    [dragController.draggingRuleId, dragController.beginDrag]
  );

  return (
    <RuleDragProvider value={dragContextValue}>
      {/* biome-ignore lint/a11y/useSemanticElements: changing to ul/li requires restructuring BrainRuleEditor */}
      <div ref={containerRef} className="h-full overflow-auto" role="list" aria-label="Brain rules">
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
              updateCounter={updateCounter}
              commandHistory={commandHistory}
              isLastRule={flatRule.ruleDef === lastTopLevelRule}
            />
          ))}
        </div>
      </div>
    </RuleDragProvider>
  );
}
