import * as SwitchPrimitives from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "../lib/utils";

/**
 * shadcn/ui switch (toggle) built on Radix `Switch.Root`.
 *
 * Under `@media (pointer: coarse)` an invisible `::before` extends the pill's
 * hit area to 44px on both axes while the pill itself stays 44x24. The insets
 * are measured from the padding box, which the 2px transparent border leaves
 * 4px smaller than the pill on each axis.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors pointer-coarse:before:absolute pointer-coarse:before:-inset-x-0.5 pointer-coarse:before:-inset-y-3 pointer-coarse:before:content-[''] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-secondary",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full border-2 border-primary bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = "Switch";

export { Switch };
