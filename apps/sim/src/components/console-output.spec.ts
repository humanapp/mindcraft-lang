import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { WorkspaceCompileDiagnostic } from "@mindcraft-lang/bridge-app";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompileDiagnosticsConsole } from "./CompileDiagnosticsConsole";
import { ConsoleOutputList } from "./ConsoleOutputList";

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ location: `loc ${index}`, message: `message ${index}` }));
}

function compileDiagnostic(index: number): WorkspaceCompileDiagnostic {
  return {
    path: `src/tiles/file${index}.ts`,
    severity: "error",
    code: "MC1",
    message: `compiler message ${index}`,
    range: { startLine: index + 1, startColumn: 5, endLine: index + 1, endColumn: 9 },
  };
}

describe("ConsoleOutputList", () => {
  test("renders every row under the five-row cap", () => {
    const markup = renderToStaticMarkup(
      createElement(ConsoleOutputList, {
        rows: rows(7),
        maxVisibleRows: 5,
        testId: "console",
        rowTestId: "console-row",
      })
    );
    assert.equal((markup.match(/data-testid="console-row"/g) ?? []).length, 7);
    assert.match(markup, /data-maxrows="5"/);
  });

  test("renders every row under the ten-row cap", () => {
    const markup = renderToStaticMarkup(
      createElement(ConsoleOutputList, {
        rows: rows(12),
        maxVisibleRows: 10,
        testId: "console",
        rowTestId: "console-row",
      })
    );
    assert.equal((markup.match(/data-testid="console-row"/g) ?? []).length, 12);
    assert.match(markup, /data-maxrows="10"/);
  });
});

describe("CompileDiagnosticsConsole", () => {
  test("renders nothing when the latest compile is clean", () => {
    const markup = renderToStaticMarkup(createElement(CompileDiagnosticsConsole, { diagnostics: [] }));
    assert.equal(markup, "");
  });

  test("renders one row per diagnostic with its path:line:col location", () => {
    const diagnostics = [0, 1, 2].map(compileDiagnostic);
    const markup = renderToStaticMarkup(createElement(CompileDiagnosticsConsole, { diagnostics }));
    assert.match(markup, /data-testid="bridge-compile-diagnostics"/);
    assert.equal((markup.match(/data-testid="bridge-compile-diagnostic-row"/g) ?? []).length, 3);
    assert.match(markup, /src\/tiles\/file0\.ts:1:5/);
    assert.match(markup, /compiler message 0/);
    assert.match(markup, /data-maxrows="10"/);
  });
});
