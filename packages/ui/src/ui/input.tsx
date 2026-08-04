import * as React from "react";

import { cn } from "../lib/utils";

/** Props for {@link Input}. Extends standard `<input>` props. */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/**
 * shadcn/ui input. Styled `<input>` element with form-friendly defaults.
 *
 * Under `@media (pointer: coarse)` the field is at least 44px tall and its text
 * is 16px, the floor below which iOS Safari zooms the page in on focus.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm pointer-coarse:min-h-11 pointer-coarse:text-base file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
