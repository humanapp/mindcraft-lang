import { task, type thread } from "@mindcraft-lang/core";
import type { BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { useEffect, useRef, useState } from "react";
import { BrainRuleEditor } from "./BrainRuleEditor";
import type { BrainCommandHistory } from "./commands";

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

export function BrainPageEditor({ pageDef, pageNumber, commandHistory, zoom = 1 }: BrainPageEditorProps) {
  const [ruleCount, setRuleCount] = useState(pageDef.children().size());
  const [updateCounter, setUpdateCounter] = useState(0);
  const parseTimerRef = useRef<thread | null>(null);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: ruleCount and updateCounter are intentional trigger signals
  useEffect(() => {
    const children = pageDef.children();
    if (children.size() === 0) {
      // No rules exist, append one
      pageDef.appendNewRule();
    } else {
      // Check if the last outermost rule is empty
      const lastRule = children.get(children.size() - 1);
      if (lastRule && !lastRule.isEmpty(true)) {
        // Last rule is not empty, append a new empty one
        pageDef.appendNewRule();
      }
    }
  }, [pageDef, ruleCount, updateCounter]);

  const flattenedRules = flattenRules(pageDef.children().toArray() as BrainRuleDef[]);

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: changing to ul/li requires restructuring BrainRuleEditor */}
      <div className="h-full overflow-auto" role="list" aria-label="Brain rules">
        <div
          className="p-3 sm:p-6"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            width: `${100 / zoom}%`,
            minHeight: `${100 / zoom}%`,
          }}
        >
          {flattenedRules.map((flatRule, idx) => (
            <BrainRuleEditor
              key={flatRule.lineNumber}
              ruleDef={flatRule.ruleDef}
              index={flatRule.index}
              pageDef={pageDef}
              depth={flatRule.depth}
              lineNumber={flatRule.lineNumber}
              updateCounter={updateCounter}
              commandHistory={commandHistory}
            />
          ))}
        </div>
      </div>
    </>
  );
}
