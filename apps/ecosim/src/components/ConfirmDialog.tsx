import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "@wendoo-lang/ui";
import { type ReactNode, useState } from "react";

interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  /** Styles the confirm button as a destructive action. */
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

/** Modal that asks the user to confirm an action before it runs. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  async function confirm(): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">{message}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" data-testid="confirm-cancel-button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant={destructive ? "destructive" : "default"}
            data-testid="confirm-button"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
