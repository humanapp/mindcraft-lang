import assert from "node:assert/strict";
import { AppHostError, type AppHostErrorCode } from "@mindcraft-lang/app-host";

/** Assert that an async operation rejects with a specific app-host error code. */
export async function assertRejectsWithCode(block: () => Promise<unknown>, code: AppHostErrorCode): Promise<void> {
  await assert.rejects(block, (error: unknown) => {
    assert.ok(error instanceof AppHostError);
    assert.strictEqual(error.code, code);
    return true;
  });
}
