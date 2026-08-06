import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";
import { attachKeyboardInsetPublisher } from "./keyboard-inset";
import { attachInsetSurface } from "./surface-insets";

/** shadcn/ui dialog root, backed by Radix `Dialog.Root`. Wraps a controlled or uncontrolled modal. */
const Dialog = DialogPrimitive.Root;

/** Element that opens the parent {@link Dialog}. */
const DialogTrigger = DialogPrimitive.Trigger;

/** Portal target for {@link Dialog} content. */
const DialogPortal = DialogPrimitive.Portal;

/** Element that closes the parent {@link Dialog}. */
const DialogClose = DialogPrimitive.Close;

/** Full-viewport overlay rendered behind {@link DialogContent}. */
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Renders nothing, and publishes the soft-keyboard inset for as long as it is
 * mounted. It sits inside the portaled content, which mounts only while the
 * dialog is on screen, so nothing listens when no dialog is open.
 */
const KeyboardInsetPublisher = (): null => {
  React.useEffect(attachKeyboardInsetPublisher, []);
  return null;
};

/**
 * Attaches the element it is given as an inset surface for as long as it is
 * mounted, and passes it on to `forwarded`. The surface carries whatever insets
 * stand at the moment it mounts.
 */
function useInsetSurfaceRef<T extends HTMLElement>(forwarded: React.ForwardedRef<T>): React.RefCallback<T> {
  return React.useCallback(
    (node: T) => {
      const release = attachInsetSurface(node);
      if (typeof forwarded === "function") forwarded(node);
      else if (forwarded) forwarded.current = node;
      return () => {
        release();
        if (typeof forwarded === "function") forwarded(null);
        else if (forwarded) forwarded.current = null;
      };
    },
    [forwarded]
  );
}

/**
 * Centered modal container. Renders an overlay and an optional close button
 * (suppressed via `hideClose`; the button grows to a 44px square under a coarse
 * pointer, keeping its glyph in place). Centres itself in the viewport width left free
 * by the documentation panel, read from the `--docs-panel-inset` custom
 * property that panel publishes onto it; the property reads `0%` when no panel
 * is covering anything, which centres the dialog in the whole viewport. It
 * centres itself vertically in the height the soft keyboard leaves free, read
 * the same way from `--keyboard-inset`, which reads `0px` with no keyboard up.
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    hideClose?: boolean;
  }
>(({ className, children, hideClose, ...props }, ref) => {
  const insetSurfaceRef = useInsetSurfaceRef(ref);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={insetSurfaceRef}
        className={cn(
          "fixed left-[calc(50%-var(--docs-panel-inset,0%)*0.5)] top-[calc(50%-var(--keyboard-inset,0)*0.5)] z-50 grid w-full max-w-[min(32rem,100%-var(--docs-panel-inset,0%))] translate-x-[-50%] translate-y-[-50%] gap-4 border bg-popover p-6 shadow-lg transition-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className
        )}
        {...props}
      >
        <KeyboardInsetPublisher />
        {children}
        {!hideClose && (
          <DialogPrimitive.Close className="absolute right-4 top-4 inline-flex items-center justify-center rounded-sm opacity-70 transition-opacity pointer-coarse:top-0.5 pointer-coarse:right-0.5 pointer-coarse:size-11 hover:opacity-100 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

/** Header section inside a {@link DialogContent}. */
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

/** Footer section inside a {@link DialogContent}. */
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

/** Accessible title for a {@link Dialog}, backed by Radix `Dialog.Title`. */
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

/** Accessible description for a {@link Dialog}, backed by Radix `Dialog.Description`. */
const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
