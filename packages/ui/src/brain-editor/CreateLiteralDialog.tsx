import type { LiteralDisplayFormat } from "@mindcraft-lang/core/brain";
import { CoreTypeIds } from "@mindcraft-lang/core/runtime";
import { useState } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { kStripPopupAttribute } from "./BrainCandidateStrip";
import { useBrainEditorConfig } from "./BrainEditorContext";
import { DisplayFormatPicker } from "./DisplayFormatPicker";

interface CreateLiteralDialogProps {
  isOpen: boolean;
  title: string;
  literalType: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: unknown, displayFormat?: LiteralDisplayFormat) => void;
}

/**
 * Dialog that creates a new literal tile. Renders inputs appropriate for the
 * given `literalType`: built-in string/number forms, or fields from the matching
 * `customLiteralTypes` entry in {@link BrainEditorConfig}. Its content carries
 * {@link kStripPopupAttribute}, so the keyboard landing in it counts as staying
 * in the candidate strip the literal was minted from.
 */
export function CreateLiteralDialog({ isOpen, title, literalType, onOpenChange, onSubmit }: CreateLiteralDialogProps) {
  const { customLiteralTypes } = useBrainEditorConfig();
  const [stringValue, setStringValue] = useState("");
  const [numberValue, setNumberValue] = useState("");
  const [displayFormat, setDisplayFormat] = useState<LiteralDisplayFormat>("default");
  const [customState, setCustomState] = useState<Record<string, string>>({});

  const customType = customLiteralTypes.find((t) => t.typeId === literalType);

  const handleCustomStateChange = (key: string, value: string) => {
    setCustomState((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    let value: unknown;

    if (literalType === CoreTypeIds.String) {
      value = stringValue;
    } else if (literalType === CoreTypeIds.Number) {
      const num = Number.parseFloat(numberValue);
      if (Number.isNaN(num)) return;
      value = num;
    } else if (customType) {
      if (!customType.isValid(customState)) return;
      value = customType.parseValue(customState);
    } else {
      return;
    }

    const fmt = literalType === CoreTypeIds.Number && displayFormat !== "default" ? displayFormat : undefined;
    onSubmit(value, fmt);
    resetForm();
  };

  const resetForm = () => {
    setStringValue("");
    setNumberValue("");
    setDisplayFormat("default");
    setCustomState({});
  };

  const handleCancel = () => {
    resetForm();
    onOpenChange(false);
  };

  const isValid = () => {
    if (literalType === CoreTypeIds.String) {
      return true;
    } else if (literalType === CoreTypeIds.Number) {
      return numberValue !== "" && !Number.isNaN(Number.parseFloat(numberValue));
    } else if (customType) {
      return customType.isValid(customState);
    }
    return false;
  };

  const renderInputFields = () => {
    if (literalType === CoreTypeIds.String) {
      return (
        <div className="grid grid-cols-4 items-center gap-4">
          <label htmlFor="stringValue" className="text-right text-foreground font-medium">
            Value
          </label>
          <Input
            id="stringValue"
            type="text"
            value={stringValue}
            onChange={(e) => setStringValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            className="col-span-3"
            placeholder="Enter string value"
            autoComplete="off"
            autoFocus
          />
        </div>
      );
    } else if (literalType === CoreTypeIds.Number) {
      return (
        <>
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="numberValue" className="text-right text-foreground font-medium">
              Value
            </label>
            <Input
              id="numberValue"
              type="number"
              value={numberValue}
              onChange={(e) => setNumberValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className="col-span-3"
              placeholder="0"
              autoComplete="off"
              autoFocus
            />
          </div>
          <DisplayFormatPicker value={displayFormat} onChange={setDisplayFormat} />
        </>
      );
    } else if (customType) {
      return customType.renderInputFields(customState, handleCustomStateChange, handleSubmit);
    }
    return null;
  };

  const getDescription = () => {
    if (literalType === CoreTypeIds.String) {
      return "Enter a string value.";
    } else if (literalType === CoreTypeIds.Number) {
      return "Enter a numeric value.";
    } else if (customType) {
      return customType.description;
    }
    return "Enter a value for the literal.";
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-106.25 bg-popover border-2 border-border rounded-2xl"
        {...{ [kStripPopupAttribute]: "" }}
      >
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="text-foreground font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{getDescription()}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">{renderInputFields()}</div>
        <DialogFooter className="gap-2 pt-4 border-t border-border">
          <Button variant="cancel" className="rounded-lg" onClick={handleCancel} aria-label="Cancel creating literal">
            Cancel
          </Button>
          <Button className="rounded-lg" onClick={handleSubmit} disabled={!isValid()} aria-label="Create literal value">
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
