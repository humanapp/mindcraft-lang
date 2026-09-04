import type { LibraryOfferToasts } from "@wendoo/bridge-app";
import { toast } from "sonner";

/**
 * How adding a library the assistant offered reports what happened: one
 * short-lived toast per outcome, carrying the library's display name, or the
 * refusal's stable code and message.
 */
export const ecosimLibraryOfferToasts: LibraryOfferToasts = {
  failed: ({ code, message }) => {
    toast.error(`Could not add library. ${code !== undefined ? `${code}: ` : ""}${message}`);
  },
  confirmed: (libraryName) => {
    toast.success(`Added ${libraryName}`);
  },
  worsened: (libraryName) => {
    toast.warning(`Added ${libraryName}, and some new problems appeared`);
  },
};
