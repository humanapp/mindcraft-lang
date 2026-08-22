import { Input } from "@wendoo-lang/ui";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

interface WorkspacePinInputProps {
  label: string;
  value: string;
  disabled?: boolean;
  autoFocus?: boolean;
  wrapperClassName?: string;
  labelClassName?: string;
  inputClassName?: string;
  buttonClassName?: string;
  showButtonLabel?: string;
  hideButtonLabel?: string;
  resetVisibilityKey?: unknown;
  onValueChange: (value: string) => void;
}

/** Masked text input for workspace PIN entry with an explicit visibility toggle. */
export function WorkspacePinInput({
  label,
  value,
  disabled = false,
  autoFocus = false,
  wrapperClassName = "space-y-1.5",
  labelClassName = "text-sm font-medium",
  inputClassName = "border-input bg-background",
  buttonClassName = "text-muted-foreground hover:text-foreground",
  showButtonLabel,
  hideButtonLabel,
  resetVisibilityKey,
  onValueChange,
}: WorkspacePinInputProps) {
  const inputId = useId();
  const [visible, setVisible] = useState(false);
  const previousResetVisibilityKeyRef = useRef(resetVisibilityKey);

  useEffect(() => {
    if (previousResetVisibilityKeyRef.current !== resetVisibilityKey) {
      previousResetVisibilityKeyRef.current = resetVisibilityKey;
      setVisible(false);
    }
  }, [resetVisibilityKey]);

  return (
    <div className={wrapperClassName}>
      <label htmlFor={inputId} className={labelClassName}>
        {label}
      </label>
      <div className="relative">
        <Input
          id={inputId}
          type="text"
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          className={`${inputClassName} pr-10 ${visible ? "" : "[-webkit-text-security:disc]"}`}
          onChange={(event) => onValueChange(event.target.value)}
        />
        <button
          type="button"
          disabled={disabled}
          className={`absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded disabled:pointer-events-none disabled:opacity-50 ${buttonClassName}`}
          aria-label={visible ? (hideButtonLabel ?? `Hide ${label}`) : (showButtonLabel ?? `Show ${label}`)}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
