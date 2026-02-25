import type { BrainDef } from "@mindcraft-lang/core/brain/model";
import { FileText, Form, Printer } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { BrainPrintTextView } from "./BrainPrintTextView";
import { BrainPrintView } from "./BrainPrintView";

type PrintMode = "visual" | "text";

interface BrainPrintDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  brainDef: BrainDef;
}

export function BrainPrintDialog({ isOpen, onOpenChange, brainDef }: BrainPrintDialogProps) {
  const [mode, setMode] = useState<PrintMode>("visual");
  const printRootRef = useRef<HTMLDivElement | null>(null);

  const handlePrint = useCallback(() => {
    // Ensure the print root exists
    let printRoot = document.getElementById("brain-print-root");
    if (!printRoot) {
      printRoot = document.createElement("div");
      printRoot.id = "brain-print-root";
      printRoot.style.display = "none";
      document.body.appendChild(printRoot);
    }

    printRootRef.current = printRoot as HTMLDivElement;

    // Force the root visible before printing
    printRoot.style.display = "block";

    // Small delay to let React render the portal content
    requestAnimationFrame(() => {
      window.print();
      // Hide after print dialog closes
      const root = document.getElementById("brain-print-root");
      if (root) {
        root.style.display = "none";
      }
    });
  }, []);

  // Ensure the print root element exists in the DOM for the portal
  const getPrintRoot = useCallback((): HTMLDivElement => {
    let printRoot = document.getElementById("brain-print-root") as HTMLDivElement | null;
    if (!printRoot) {
      printRoot = document.createElement("div");
      printRoot.id = "brain-print-root";
      printRoot.style.display = "none";
      document.body.appendChild(printRoot);
    }
    return printRoot;
  }, []);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md bg-white border-2 border-slate-300 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-slate-800">Print: {brainDef.name()}</DialogTitle>
            <DialogDescription className="text-slate-500">Choose a print format and click Print.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <div className="flex gap-2" role="radiogroup" aria-label="Print mode">
                {/* biome-ignore lint/a11y/useSemanticElements: styled radio buttons; native radio would require excessive restyling */}
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "visual"}
                  className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-colors cursor-pointer ${
                    mode === "visual"
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  onClick={() => setMode("visual")}
                >
                  <Form className="h-4 w-4" aria-hidden="true" />
                  Visual
                </button>
                {/* biome-ignore lint/a11y/useSemanticElements: styled radio buttons; native radio would require excessive restyling */}
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === "text"}
                  className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-colors cursor-pointer ${
                    mode === "text"
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  onClick={() => setMode("text")}
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  Text Only
                </button>
              </div>
              <p className="text-xs text-slate-500">
                {mode === "visual"
                  ? "Prints with formatting faithful to what's shown in the editor."
                  : "Prints a compact text representation of the brain logic."}
              </p>
            </div>
          </div>
          <DialogFooter className="flex gap-2 pt-2">
            <Button variant="cancel" className="rounded-lg" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Portal for print content -- always rendered so it is ready when print fires */}
      {isOpen &&
        createPortal(
          mode === "visual" ? <BrainPrintView brainDef={brainDef} /> : <BrainPrintTextView brainDef={brainDef} />,
          getPrintRoot()
        )}
    </>
  );
}
