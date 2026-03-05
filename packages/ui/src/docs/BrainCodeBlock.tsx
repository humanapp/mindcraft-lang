import { getBrainServices } from "@mindcraft-lang/core/brain";
import { ClipboardCopy } from "lucide-react";
import { useMemo, useState } from "react";
import { setClipboardFromJson } from "../brain-editor/rule-clipboard";
import { DocsRuleBlock, type DocsRuleData } from "./DocsRule";

// ---------------------------------------------------------------------------
// Plain-JSON -> DocsRuleData conversion
// ---------------------------------------------------------------------------

interface PlainRule {
  version?: number;
  when?: string[];
  do?: string[];
  children?: PlainRule[];
}

function resolveTiles(tileIds: string[]) {
  const catalog = getBrainServices().tiles;
  return tileIds.map((id) => catalog.get(id)).filter(Boolean) as ReturnType<typeof catalog.get>[] as NonNullable<
    ReturnType<typeof catalog.get>
  >[];
}

function convertRule(plain: PlainRule, depth = 0): DocsRuleData {
  return {
    whenTiles: resolveTiles(plain.when ?? []),
    doTiles: resolveTiles(plain.do ?? []),
    depth,
    children: (plain.children ?? []).map((c) => convertRule(c, depth + 1)),
  };
}

function parseRules(jsonStr: string): PlainRule[] | null {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return null;
    return parsed as PlainRule[];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BrainCodeBlock component
// ---------------------------------------------------------------------------

interface BrainCodeBlockProps {
  /** Raw JSON string from inside the brain fence. */
  content: string;
}

export function BrainCodeBlock({ content }: BrainCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const rules = useMemo(() => {
    const plain = parseRules(content);
    if (!plain) return null;
    return plain.map((r) => convertRule(r));
  }, [content]);

  const handleInsert = () => {
    const plain = parseRules(content);
    if (!plain) return;
    setClipboardFromJson(plain);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!rules) {
    return (
      <pre className="rounded bg-slate-800 border border-slate-700 p-3 text-xs text-red-400 overflow-x-auto my-2">
        {content}
      </pre>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-slate-700 overflow-hidden">
      {/* Rendered tiles */}
      <div className="p-2 bg-slate-900/50">
        <DocsRuleBlock rules={rules} />
      </div>

      {/* Insert button */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-t border-slate-700">
        <span className="text-xs text-slate-500">
          {rules.length} {rules.length === 1 ? "rule" : "rules"}
        </span>
        <button
          type="button"
          onClick={handleInsert}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 hover:text-white transition-colors border border-slate-600 pointer-events-auto"
        >
          <ClipboardCopy className="w-3 h-3" aria-hidden="true" />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
