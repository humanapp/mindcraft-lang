import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@wendoo/ui";
import { useEffect, useRef, useState } from "react";

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => void;
  defaultName: string;
}

export function NewProjectDialog({ open, onOpenChange, onConfirm, defaultName }: NewProjectDialogProps) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open, defaultName]);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (trimmed) {
      onConfirm(trimmed);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm rounded-2xl">
        <DialogHeader className="border-b border-border pb-3">
          <DialogTitle className="text-lg font-semibold">New Project</DialogTitle>
          <DialogDescription className="text-sm">Enter a name for your new project.</DialogDescription>
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
            placeholder="Project name"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="cancel" onClick={() => onOpenChange(false)} className="rounded-lg">
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!name.trim()} className="rounded-lg">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
