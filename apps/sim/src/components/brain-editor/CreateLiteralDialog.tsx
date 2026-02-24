import { Vector2 } from "@mindcraft-lang/core";
import { CoreTypeIds } from "@mindcraft-lang/core/brain";
import { useState } from "react";
import { MyTypeIds } from "@/brain/type-system";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CreateLiteralDialogProps {
  isOpen: boolean;
  title: string;
  literalType: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: unknown) => void;
}

export function CreateLiteralDialog({ isOpen, title, literalType, onOpenChange, onSubmit }: CreateLiteralDialogProps) {
  const [stringValue, setStringValue] = useState("");
  const [numberValue, setNumberValue] = useState("");
  const [vector2X, setVector2X] = useState("");
  const [vector2Y, setVector2Y] = useState("");

  const handleSubmit = () => {
    let value: unknown;

    if (literalType === CoreTypeIds.String) {
      value = stringValue;
    } else if (literalType === CoreTypeIds.Number) {
      const num = Number.parseFloat(numberValue);
      if (Number.isNaN(num)) return;
      value = num;
    } else if (literalType === MyTypeIds.Vector2) {
      const x = Number.parseFloat(vector2X);
      const y = Number.parseFloat(vector2Y);
      if (Number.isNaN(x) || Number.isNaN(y)) return;
      value = new Vector2(x, y);
    } else {
      return;
    }

    onSubmit(value);
    resetForm();
  };

  const resetForm = () => {
    setStringValue("");
    setNumberValue("");
    setVector2X("");
    setVector2Y("");
  };

  const handleCancel = () => {
    resetForm();
    onOpenChange(false);
  };

  const isValid = () => {
    if (literalType === CoreTypeIds.String) {
      return true; // Any string is valid, even empty
    } else if (literalType === CoreTypeIds.Number) {
      return numberValue !== "" && !Number.isNaN(Number.parseFloat(numberValue));
    } else if (literalType === MyTypeIds.Vector2) {
      return (
        vector2X !== "" &&
        vector2Y !== "" &&
        !Number.isNaN(Number.parseFloat(vector2X)) &&
        !Number.isNaN(Number.parseFloat(vector2Y))
      );
    }
    return false;
  };

  const renderInputFields = () => {
    if (literalType === CoreTypeIds.String) {
      return (
        <div className="grid grid-cols-4 items-center gap-4">
          <label htmlFor="stringValue" className="text-right text-slate-700 font-medium">
            Value
          </label>
          <input
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
            className="col-span-3 flex h-10 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Enter string value"
            autoComplete="off"
            // biome-ignore lint/a11y/noAutofocus: dialog input should focus immediately for keyboard users
            autoFocus
          />
        </div>
      );
    } else if (literalType === CoreTypeIds.Number) {
      return (
        <div className="grid grid-cols-4 items-center gap-4">
          <label htmlFor="numberValue" className="text-right text-slate-700 font-medium">
            Value
          </label>
          <input
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
            className="col-span-3 flex h-10 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="0"
            autoComplete="off"
            // biome-ignore lint/a11y/noAutofocus: dialog input should focus immediately for keyboard users
            autoFocus
          />
        </div>
      );
    } else if (literalType === MyTypeIds.Vector2) {
      return (
        <div className="grid gap-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="vector2X" className="text-right text-slate-700 font-medium">
              X
            </label>
            <input
              id="vector2X"
              type="number"
              value={vector2X}
              onChange={(e) => setVector2X(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className="col-span-3 flex h-10 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="0"
              autoComplete="off"
              // biome-ignore lint/a11y/noAutofocus: dialog input should focus immediately for keyboard users
              autoFocus
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="vector2Y" className="text-right text-slate-700 font-medium">
              Y
            </label>
            <input
              id="vector2Y"
              type="number"
              value={vector2Y}
              onChange={(e) => setVector2Y(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className="col-span-3 flex h-10 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="0"
              autoComplete="off"
            />
          </div>
        </div>
      );
    }
    return null;
  };

  const getDescription = () => {
    if (literalType === CoreTypeIds.String) {
      return "Enter a string value.";
    } else if (literalType === CoreTypeIds.Number) {
      return "Enter a numeric value.";
    } else if (literalType === MyTypeIds.Vector2) {
      return "Enter X and Y coordinates for the vector.";
    }
    return "Enter a value for the literal.";
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-106.25 bg-slate-50 border-2 border-slate-300 rounded-2xl">
        <DialogHeader className="border-b border-slate-200 pb-4">
          <DialogTitle className="text-slate-800 font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-slate-600">{getDescription()}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">{renderInputFields()}</div>
        <DialogFooter className="gap-2 pt-4 border-t border-slate-200">
          <Button variant="cancel" className="rounded-lg" onClick={handleCancel} aria-label="Cancel creating literal">
            Cancel
          </Button>
          <Button
            className="rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white"
            onClick={handleSubmit}
            disabled={!isValid()}
            aria-label="Create literal value"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
