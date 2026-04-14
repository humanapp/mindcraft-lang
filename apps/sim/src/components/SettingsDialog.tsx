import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
} from "@mindcraft-lang/ui";
import { useEffect, useState } from "react";
import { useSimEnvironment } from "@/contexts/sim-environment";
import type { AppSettings } from "@/services/sim-environment-store";
import { clearBindingToken, hasBindingToken } from "@/services/vscode-bridge";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBridgeDisabled?: () => void;
}

export function SettingsDialog({ open, onOpenChange, onBridgeDisabled }: SettingsDialogProps) {
  const store = useSimEnvironment();
  const [draft, setDraft] = useState<AppSettings>(() => store.getAppSettings());
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(store.getAppSettings());
      setHasToken(hasBindingToken());
    }
  }, [open, store]);

  const save = () => {
    const wasShowingBridge = store.getAppSettings().showBridgePanel;
    store.updateAppSettings(draft);
    if (wasShowingBridge && !draft.showBridgePanel && store.getUiPreferences().bridgeEnabled) {
      store.updateUiPreferences({ bridgeEnabled: false });
      store.disconnectBridge();
      clearBindingToken();
      onBridgeDisabled?.();
    }
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
          <div className="flex items-center justify-between">
            <label htmlFor="show-bridge-panel" className="text-sm font-medium text-slate-700">
              Show VS Code Bridge Panel
            </label>
            <Switch
              id="show-bridge-panel"
              checked={draft.showBridgePanel}
              onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, showBridgePanel: checked }))}
            />
          </div>
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
