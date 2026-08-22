import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@wendoo-lang/ui";
import { useEffect, useRef, useState } from "react";

interface NewWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => void;
}

export function NewWorkspaceDialog({ open, onOpenChange, onConfirm }: NewWorkspaceDialogProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleConfirm = () => {
    onConfirm(name);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm rounded-lg">
        <DialogHeader className="border-b border-border pb-3">
          <DialogTitle className="text-lg font-semibold">New Workspace</DialogTitle>
          <DialogDescription className="text-sm">Name the workspace before choosing a project.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleConfirm();
              }
            }}
            placeholder="Workspace name"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="cancel" onClick={() => onOpenChange(false)} className="rounded-lg">
            Cancel
          </Button>
          <Button onClick={handleConfirm} className="rounded-lg">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
