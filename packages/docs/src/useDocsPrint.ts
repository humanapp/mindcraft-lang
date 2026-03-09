import { useCallback, useRef, useState } from "react";

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

    // Allow React to render the portal, then print
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
