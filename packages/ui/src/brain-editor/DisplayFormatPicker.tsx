import type { LiteralDisplayFormat } from "@mindcraft-lang/core/brain";
import { useState } from "react";

const FORMAT_OPTIONS: { value: LiteralDisplayFormat; label: string; description: string }[] = [
  { value: "default", label: "Default", description: "No formatting" },
  { value: "percent", label: "Percent", description: "Multiply by 100, append %" },
  { value: "percent:1", label: "Percent (1 dp)", description: "e.g., 42.5%" },
  { value: "percent:2", label: "Percent (2 dp)", description: "e.g., 42.50%" },
  { value: "fixed:0", label: "Integer", description: "No decimal places" },
  { value: "fixed:1", label: "1 decimal", description: "e.g., 3.1" },
  { value: "fixed:2", label: "2 decimals", description: "e.g., 3.14" },
  { value: "fixed:3", label: "3 decimals", description: "e.g., 3.142" },
  { value: "thousands", label: "Thousands", description: "e.g., 1,000,000" },
];

interface DisplayFormatPickerProps {
  value: LiteralDisplayFormat;
  onChange: (format: LiteralDisplayFormat) => void;
}

export function DisplayFormatPicker({ value, onChange }: DisplayFormatPickerProps) {
  const [isExpanded, setIsExpanded] = useState(value !== "default");

  if (!isExpanded) {
    return (
      <div className="grid grid-cols-4 items-center gap-4">
        <div className="col-start-2 col-span-3">
          <button
            type="button"
            className="text-sm text-indigo-500 hover:text-indigo-700 font-medium"
            onClick={() => setIsExpanded(true)}
          >
            + Display format
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 items-center gap-4">
      <label htmlFor="displayFormat" className="text-right text-slate-700 font-medium">
        Format
      </label>
      <select
        id="displayFormat"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="col-span-3 flex h-10 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-indigo-500"
      >
        {FORMAT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label} -- {opt.description}
          </option>
        ))}
      </select>
    </div>
  );
}
