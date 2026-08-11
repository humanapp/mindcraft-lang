import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assistantSessionUrl } from "./service-url";

const SESSION_PATH = "/api/assistant/session";

describe("assistant service session URL", () => {
  it("derives the scheme from the host and preserves the port", () => {
    const cases: [input: string, expected: string][] = [
      ["assistant.example.net", `wss://assistant.example.net${SESSION_PATH}`],
      ["assistant.example.net:443", `wss://assistant.example.net:443${SESSION_PATH}`],
      ["localhost:8787", `ws://localhost:8787${SESSION_PATH}`],
      ["localhost", `ws://localhost${SESSION_PATH}`],
      ["127.0.0.1:8787", `ws://127.0.0.1:8787${SESSION_PATH}`],
      ["[::1]:8787", `ws://[::1]:8787${SESSION_PATH}`],
    ];
    for (const [input, expected] of cases) {
      assert.equal(assistantSessionUrl(input), expected, input);
    }
  });

  it("strips a pasted scheme and re-derives from the host", () => {
    const cases: [input: string, expected: string][] = [
      ["https://assistant.example.net", `wss://assistant.example.net${SESSION_PATH}`],
      ["http://assistant.example.net", `wss://assistant.example.net${SESSION_PATH}`],
      ["wss://localhost:8787", `ws://localhost:8787${SESSION_PATH}`],
      ["ws://assistant.example.net:9000", `wss://assistant.example.net:9000${SESSION_PATH}`],
      ["http://127.0.0.1:8787", `ws://127.0.0.1:8787${SESSION_PATH}`],
    ];
    for (const [input, expected] of cases) {
      assert.equal(assistantSessionUrl(input), expected, input);
    }
  });
});
