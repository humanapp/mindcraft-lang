import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FolderSessionErrorCode } from "@wendoo-lang/bridge-protocol";
import type { ExternalDocumentAccess } from "./external-document";
import { openExternalHtmlDocument } from "./external-document";

const DOCUMENT_URI = "file:///workspace/project/.wendoo/print.html";

/**
 * In-memory external-document access recording the written document and the
 * path handed to the opener. `failWrites`/`failOpen` make that step reject.
 */
function memoryAccess(options?: {
  failWrites?: boolean;
  failOpen?: boolean;
}): ExternalDocumentAccess & { written?: string; opened?: string } {
  const record: { written?: string; opened?: string } = {};
  return {
    get written() {
      return record.written;
    },
    get opened() {
      return record.opened;
    },
    writeTempDocument: async (html) => {
      if (options?.failWrites) {
        throw new Error("disk full");
      }
      record.written = html;
      return DOCUMENT_URI;
    },
    openExternal: async (path) => {
      if (options?.failOpen) {
        throw new Error("no external handler");
      }
      record.opened = path;
    },
  };
}

const HTML = "<!doctype html><html><body>doc</body></html>";

describe("openExternalHtmlDocument", () => {
  it("writes the document and opens the written file path", async () => {
    const access = memoryAccess();
    const outcome = await openExternalHtmlDocument(HTML, access);
    assert.deepStrictEqual(outcome, { ok: true });
    assert.equal(access.written, HTML);
    assert.equal(access.opened, DOCUMENT_URI);
  });

  it("reports the write-failed code when the write rejects", async () => {
    const access = memoryAccess({ failWrites: true });
    const outcome = await openExternalHtmlDocument(HTML, access);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.code, FolderSessionErrorCode.WRITE_FAILED);
    assert.equal(access.opened, undefined);
  });

  it("reports the write-failed code when the open rejects", async () => {
    const access = memoryAccess({ failOpen: true });
    const outcome = await openExternalHtmlDocument(HTML, access);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.code, FolderSessionErrorCode.WRITE_FAILED);
  });
});
