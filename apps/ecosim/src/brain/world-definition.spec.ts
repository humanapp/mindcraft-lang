import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as worldDefinition from "./world-definition";

/** Module specifier the world builders import the world definition through. */
const DEFINITION_SPECIFIER = "@/brain/world-definition";

/** Sources that build a world, relative to this spec. */
const WORLD_BUILDERS = [
  "../game/main.ts",
  "../game/scenes/Playground.ts",
  "../rehearsal/world.ts",
  "../services/ecosim-environment-store.ts",
];

/**
 * Values the world definition owns, as the literal forms a builder would write
 * if it kept a private copy: the world extent and the Matter collision
 * categories.
 */
const OWNED_LITERALS = [/\b1024\b/, /\b768\b/, /0x0001/, /0x0002/, /0x0004/];

function builderSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

/** Names the builder binds from the world definition. */
function importedNames(source: string): Set<string> {
  const names = new Set<string>();
  const importPattern = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"${DEFINITION_SPECIFIER}"`, "g");
  for (const match of source.matchAll(importPattern)) {
    for (const entry of match[1].split(",")) {
      const name = entry
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];
      if (name.length > 0) names.add(name);
    }
  }
  return names;
}

describe("the world definition is the single source both worlds build from", () => {
  test("every world builder takes its rules from the world definition", () => {
    for (const path of WORLD_BUILDERS) {
      assert.ok(importedNames(builderSource(path)).size > 0, path);
    }
  });

  test("no world builder declares a rule the world definition owns", () => {
    const owned = Object.keys(worldDefinition);
    for (const path of WORLD_BUILDERS) {
      const source = builderSource(path);
      const imported = importedNames(source);
      for (const name of owned) {
        assert.doesNotMatch(
          source,
          new RegExp(`(?:const|let|var|function|class|interface|type|enum)\\s+${name}\\b`),
          `${path} declares ${name}`
        );
        assert.ok(
          !new RegExp(`\\b${name}\\b`).test(source) || imported.has(name),
          `${path} uses ${name} without importing it from the world definition`
        );
      }
    }
  });

  test("no world builder carries a private copy of a world rule", () => {
    for (const path of WORLD_BUILDERS) {
      const source = builderSource(path);
      for (const literal of OWNED_LITERALS) {
        assert.doesNotMatch(source, literal, path);
      }
    }
  });
});
