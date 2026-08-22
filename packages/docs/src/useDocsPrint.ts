import { type PrintTransport, printPortalViaTransport } from "@wendoo/ui/print/standalone-print-document";
import { useCallback, useRef, useState } from "react";

/**
 * Hook that renders markdown content into a hidden portal and prints it.
 * Without a `printTransport` it triggers the browser's print dialog via
 * `window.print()`. With one -- for a host that cannot open the browser print
 * dialog -- it serializes the print portal into a self-contained HTML document
 * and hands it to the transport. Returns `triggerPrint` together with the
 * current `printContent` (to render via portal) and `getPrintRoot`.
 */
export function useDocsPrint(printTransport?: PrintTransport) {
  const printRootRef = useRef<HTMLDivElement | null>(null);
  const [printContent, setPrintContent] = useState<string | null>(null);

  const triggerPrint = useCallback(
    (content: string) => {
      let printRoot = document.getElementById("docs-print-root") as HTMLDivElement | null;
      if (!printRoot) {
        printRoot = document.createElement("div");
        printRoot.id = "docs-print-root";
        printRoot.style.display = "none";
        document.body.appendChild(printRoot);
      }
      printRootRef.current = printRoot;
      setPrintContent(content);
      const root = printRoot;

      // Two nested requestAnimationFrame calls are needed for reliable print timing:
      // 1st RAF: React renders the portal content into the now-visible root.
      // 2nd RAF: the browser paints the rendered content, then we print.
      // A single RAF would race with React's render cycle.
      requestAnimationFrame(() => {
        root.style.display = "block";
        requestAnimationFrame(() => {
          const finish = () => {
            root.style.display = "none";
            setPrintContent(null);
          };
          if (printTransport) {
            void printPortalViaTransport(root, "docs-print-root", "Wendoo Docs", printTransport)
              .catch(() => undefined)
              .finally(finish);
            return;
          }
          window.print();
          finish();
        });
      });
    },
    [printTransport]
  );

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
