import { Toaster as SonnerToaster } from "sonner";

/**
 * Pre-configured Toaster component. Render once at the app root.
 * Uses dark theme to match the brain editor's visual style.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      theme="dark"
      toastOptions={{
        className: "bg-popover text-popover-foreground border-border text-sm",
      }}
    />
  );
}
