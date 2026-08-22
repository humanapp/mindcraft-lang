import type { FolderSessionErrorCode as FolderSessionErrorCodeType } from "@wendoo-lang/bridge-protocol";
import { FolderSessionErrorCode } from "@wendoo-lang/bridge-protocol";

/** Operations opening an app-generated HTML document outside the extension host. */
export interface ExternalDocumentAccess {
  /** Write `html` to the reused temporary document file, replacing its content, and return its path. */
  writeTempDocument(html: string): Promise<string>;
  /** Open the file at `path` in the user's default external application. */
  openExternal(path: string): Promise<void>;
}

/** Outcome of one external-document open. */
export type OpenExternalDocumentOutcome =
  | { ok: true }
  | { ok: false; code: FolderSessionErrorCodeType; message: string };

/**
 * Write `html` to the temporary document file and open it externally. Returns
 * `WRITE_FAILED` when either the write or the open fails.
 */
export async function openExternalHtmlDocument(
  html: string,
  access: ExternalDocumentAccess
): Promise<OpenExternalDocumentOutcome> {
  try {
    const path = await access.writeTempDocument(html);
    await access.openExternal(path);
  } catch (error) {
    return {
      ok: false,
      code: FolderSessionErrorCode.WRITE_FAILED,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true };
}
