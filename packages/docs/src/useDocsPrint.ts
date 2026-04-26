import { useCallback, useRef, useState } from "react";

/**
 * Hook that renders markdown content into a hidden portal and triggers the
 * browser's print dialog. Returns `triggerPrint` together with the current
 * `printContent` (to render via portal) and `printRootRef`.
 */
export function useDocsPrint() {
  const printRootRef = useRef<HTMLDivElement | null>(null);
  const [printContent, setPrintContent] = useState<string | null>(null);

  const triggerPrint = useCallback((content: string) => {
    let printRoot = document.getElementById("docs-print-root") as HTMLDivElement | null;
    if (!printRoot) {
      printRoot = document.createElement("div");
      printRoot.id = "docs-print-root";
      printRoot.style.display = "none";
      document.body.appendChild(printRoot);
    }
    printRootRef.current = printRoot;
    setPrintContent(content);

    // Two nested requestAnimationFrame calls are needed for reliable print timing:
    // 1st RAF: React renders the portal content into the now-visible root.
    // 2nd RAF: the browser paints the rendered content, then we trigger print.
    // A single RAF would race with React's render cycle.
    requestAnimationFrame(() => {
      const root = document.getElementById("docs-print-root");
      if (root) root.style.display = "block";
      requestAnimationFrame(() => {
        window.print();
        const r = document.getElementById("docs-print-root");
        if (r) r.style.display = "none";
        setPrintContent(null);
      });
    });
  }, []);

  const getPrintRoot = useCallback((): HTMLDivElement => {
    let printRoot = document.getElementById("docs-print-root") as HTMLDivElement | null;
    if (!printRoot) {
      printRoot = document.createElement("div");
      printRoot.id = "docs-print-root";
      printRoot.style.display = "none";
      document.body.appendChild(printRoot);
    }
    return printRoot;
  }, []);

  return { printContent, triggerPrint, getPrintRoot };
}
