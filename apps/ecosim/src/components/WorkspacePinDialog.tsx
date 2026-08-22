import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@wendoo/ui";
import { useEffect, useState } from "react";
import { WorkspacePinInput } from "./WorkspacePinInput";

/** PIN prompt behavior selected by the caller. */
export type WorkspacePinDialogMode = "set" | "change" | "unlock";

interface WorkspacePinDialogProps {
  open: boolean;
  mode: WorkspacePinDialogMode;
  workspaceName: string;
  busy: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (pin: string) => void;
  onInputChange?: () => void;
}

function getDialogText(
  mode: WorkspacePinDialogMode,
  workspaceName: string
): { title: string; description: string; action: string } {
  if (mode === "unlock") {
    return {
      title: "Unlock Workspace",
      description: `Enter the PIN for ${workspaceName}.`,
      action: "Unlock",
    };
  }
  if (mode === "change") {
    return {
      title: "Change Workspace PIN",
      description: `Set a new PIN for ${workspaceName}.`,
      action: "Change PIN",
    };
  }
  return {
    title: "Set Workspace PIN",
    description: `Protect ${workspaceName} with a PIN.`,
    action: "Set PIN",
  };
}

/** Dialog that collects a workspace PIN for setup, change, or unlock flows. */
export function WorkspacePinDialog({
  open,
  mode,
  workspaceName,
  busy,
  error,
  onOpenChange,
  onSubmit,
  onInputChange,
}: WorkspacePinDialogProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const needsConfirmation = mode !== "unlock";
  const text = getDialogText(mode, workspaceName);
  const confirmationError = needsConfirmation && pin.length > 0 && confirmPin.length > 0 && pin !== confirmPin;
  const canSubmit = pin.length > 0 && (!needsConfirmation || (confirmPin.length > 0 && pin === confirmPin)) && !busy;

  useEffect(() => {
    if (open) {
      setPin("");
      setConfirmPin("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              onSubmit(pin);
            }
          }}
        >
          <WorkspacePinInput
            label="PIN"
            value={pin}
            disabled={busy}
            autoFocus
            resetVisibilityKey={open}
            onValueChange={(value) => {
              setPin(value);
              onInputChange?.();
            }}
          />
          {needsConfirmation && (
            <WorkspacePinInput
              label="Confirm PIN"
              value={confirmPin}
              disabled={busy}
              showButtonLabel="Show confirmation PIN"
              hideButtonLabel="Hide confirmation PIN"
              resetVisibilityKey={open}
              onValueChange={(value) => {
                setConfirmPin(value);
                onInputChange?.();
              }}
            />
          )}
          {(error || confirmationError) && (
            <p className="text-sm text-destructive" role="alert">
              {confirmationError ? "PIN values do not match." : error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="cancel" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? "Working..." : text.action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
