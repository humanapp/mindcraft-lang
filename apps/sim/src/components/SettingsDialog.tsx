import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@mindcraft-lang/ui";
import { useEffect, useState } from "react";
import { type AppSettings, getAppSettings, updateAppSettings } from "@/services/app-settings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [draft, setDraft] = useState<AppSettings>(getAppSettings);

  useEffect(() => {
    if (open) {
      setDraft(getAppSettings());
    }
  }, [open]);

  const save = () => {
    updateAppSettings(draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-slate-100 border-2 border-slate-300 rounded-2xl text-slate-900">
        <DialogHeader className="border-b border-slate-200 pb-3">
          <DialogTitle className="text-slate-900">Settings</DialogTitle>
          <DialogDescription className="text-slate-500">Configure application settings</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label htmlFor="vscode-bridge-url" className="text-sm font-medium text-slate-700">
              VS Code Bridge URL
            </label>
            <Input
              id="vscode-bridge-url"
              className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
              value={draft.vscodeBridgeUrl}
              onChange={(e) => setDraft((prev) => ({ ...prev, vscodeBridgeUrl: e.target.value }))}
              placeholder="localhost:6464"
            />
          </div>
        </div>
        <DialogFooter className="border-t border-slate-200 pt-3">
          <Button variant="cancel" className="rounded-lg" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white" onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
