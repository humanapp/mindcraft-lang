import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileContent } from "@wendoo-lang/app-host";
import { fileContentText, fileContentToWire } from "@wendoo-lang/app-host";
import type { FolderCompilerFilesPayload } from "@wendoo-lang/bridge-protocol";
import { EXTENSIONS_TREE_PATH, INSTALLED_EXTENSIONS_METADATA_PATH } from "@wendoo-lang/bridge-protocol";
import type { AffordanceFileAccess } from "./project-affordances";
import {
  GENERATED_TSCONFIG_MARKER,
  GITIGNORE_MARKER,
  ProjectAffordanceWriter,
  renderGeneratedTsconfig,
  updatedGitignoreContent,
} from "./project-affordances";

/** In-memory file access over a flat path->content map, tracking write and delete order. */
function memoryFileAccess(initial?: Record<string, FileContent>): AffordanceFileAccess & {
  files: Map<string, FileContent>;
  writes: string[];
  deletes: string[];
} {
  const files = new Map<string, FileContent>(Object.entries(initial ?? {}));
  const writes: string[] = [];
  const deletes: string[] = [];
  return {
    files,
    writes,
    deletes,
    async readFile(path) {
      return files.get(path);
    },
    async writeFile(path, content) {
      files.set(path, content);
      writes.push(path);
    },
    async deleteFile(path) {
      files.delete(path);
      deletes.push(path);
    },
    async listFilesUnder(directory) {
      return [...files.keys()].filter((path) => path.startsWith(`${directory}/`));
    },
    async deleteDirectoryIfEmpty() {},
  };
}

const ORIGIN = "example-org/position-ext";

/** The text of `path` in a memory file map, or undefined when absent or binary. */
function textOf(files: Map<string, FileContent>, path: string): string | undefined {
  const content = files.get(path);
  return content === undefined ? undefined : fileContentText(content);
}

function payload(
  files: Array<[string, FileContent]>,
  installedExtensions: FolderCompilerFilesPayload["installedExtensions"] = {}
): FolderCompilerFilesPayload {
  return { files: files.map(([path, content]) => [path, fileContentToWire(content)]), installedExtensions };
}

describe("updatedGitignoreContent", () => {
  it("creates the ignore block when no .gitignore exists", () => {
    const content = updatedGitignoreContent(undefined);
    assert.ok(content);
    assert.ok(content.startsWith(GITIGNORE_MARKER));
    assert.ok(content.includes(".libraries/"));
    assert.ok(content.includes("tsconfig.json"));
  });

  it("appends only the missing entries and preserves existing content byte-for-byte", () => {
    const existing = "node_modules/\n.libraries/\n";
    const content = updatedGitignoreContent(existing);
    assert.ok(content);
    assert.ok(content.startsWith(existing), "existing content is preserved unmodified at the top");
    const appended = content.slice(existing.length);
    assert.ok(appended.includes("tsconfig.json"));
    assert.ok(!appended.includes(".libraries/"), "an already-covered entry is not appended");
  });

  it("adds a separating newline when the existing content lacks a trailing one", () => {
    const content = updatedGitignoreContent("node_modules/");
    assert.ok(content);
    assert.ok(content.startsWith(`node_modules/\n${GITIGNORE_MARKER}`));
  });

  it("recognizes slash variants of the entries as covering", () => {
    assert.equal(updatedGitignoreContent("/.libraries\n/tsconfig.json\n"), undefined);
    assert.equal(updatedGitignoreContent(".libraries\ntsconfig.json"), undefined);
  });

  it("does not accept commented-out entries as covering", () => {
    const content = updatedGitignoreContent("#.libraries/\n# tsconfig.json\n");
    assert.ok(content);
    assert.ok(content.includes(".libraries/"));
    assert.ok(content.includes("\ntsconfig.json"));
  });

  it("appends caller-supplied entries and no-ops once they are covered", () => {
    const added = updatedGitignoreContent("node_modules/\n", [".wendoo/"]);
    assert.ok(added);
    assert.ok(added.startsWith("node_modules/\n"));
    assert.ok(added.slice("node_modules/\n".length).includes(".wendoo/"));
    assert.equal(updatedGitignoreContent("node_modules/\n.wendoo/\n", [".wendoo/"]), undefined);
  });
});

describe("ProjectAffordanceWriter", () => {
  it("writes the file set, the marker-prefixed tsconfig, the provenance record, and the gitignore", async () => {
    const access = memoryFileAccess();
    const writer = new ProjectAffordanceWriter(access);

    await writer.apply(
      payload(
        [
          ["tsconfig.json", '{ "compilerOptions": {} }'],
          [`.libraries/${ORIGIN}/index.ts`, "export const p = 1;"],
        ],
        { [ORIGIN]: { reference: `gh:${ORIGIN}@v0.1.0`, specifier: "v0.1.0" } }
      )
    );

    assert.equal(access.files.get("tsconfig.json"), renderGeneratedTsconfig('{ "compilerOptions": {} }'));
    assert.ok(textOf(access.files, "tsconfig.json")?.startsWith(GENERATED_TSCONFIG_MARKER));
    assert.equal(access.files.get(`.libraries/${ORIGIN}/index.ts`), "export const p = 1;");
    const metadata = JSON.parse(textOf(access.files, INSTALLED_EXTENSIONS_METADATA_PATH) ?? "{}") as Record<
      string,
      { reference: string; specifier: string }
    >;
    assert.deepStrictEqual(metadata, { [ORIGIN]: { reference: `gh:${ORIGIN}@v0.1.0`, specifier: "v0.1.0" } });
    assert.ok(access.files.has(".gitignore"));
  });

  it("overwrites a pre-existing root tsconfig.json with the generated one", async () => {
    const access = memoryFileAccess({ "tsconfig.json": '{ "extends": "user-config" }' });
    const writer = new ProjectAffordanceWriter(access);

    await writer.apply(payload([["tsconfig.json", "{}"]]));

    assert.equal(access.files.get("tsconfig.json"), renderGeneratedTsconfig("{}"));
  });

  it("leaves an unchanged file untouched on a repeat apply", async () => {
    const access = memoryFileAccess();
    const writer = new ProjectAffordanceWriter(access);
    const set = payload([
      ["tsconfig.json", "{}"],
      [`.libraries/${ORIGIN}/index.ts`, "export const p = 1;"],
    ]);

    await writer.apply(set);
    const writesAfterFirst = access.writes.length;
    await writer.apply(set);

    assert.equal(access.writes.length, writesAfterFirst, "a repeat apply of the same set writes nothing");
  });

  it("prunes tree files that left the set, including stale files found on disk at the first apply", async () => {
    const stalePath = ".libraries/old-org/old-ext/index.ts";
    const access = memoryFileAccess({ [stalePath]: "export const stale = 1;" });
    const writer = new ProjectAffordanceWriter(access);

    await writer.apply(
      payload([
        ["tsconfig.json", "{}"],
        [`.libraries/${ORIGIN}/index.ts`, "export const p = 1;"],
      ])
    );
    assert.equal(access.files.has(stalePath), false, "a stale on-disk tree file is pruned at the first apply");

    await writer.apply(payload([["tsconfig.json", "{}"]]));
    assert.equal(access.files.has(`.libraries/${ORIGIN}/index.ts`), false, "an uninstalled subtree is pruned");
  });

  it("prunes a provenance record that no longer lists any dependency", async () => {
    const access = memoryFileAccess();
    const writer = new ProjectAffordanceWriter(access);

    await writer.apply(
      payload([["tsconfig.json", "{}"]], { [ORIGIN]: { reference: `gh:${ORIGIN}@v0.1.0`, specifier: "v0.1.0" } })
    );
    assert.ok(access.files.has(INSTALLED_EXTENSIONS_METADATA_PATH));

    await writer.apply(payload([["tsconfig.json", "{}"]]));
    assert.equal(access.files.has(INSTALLED_EXTENSIONS_METADATA_PATH), false);
  });

  it("prunes a managed path outside the tree when it leaves the set", async () => {
    const access = memoryFileAccess();
    const writer = new ProjectAffordanceWriter(access);

    await writer.apply(
      payload([
        ["tsconfig.json", "{}"],
        ["ambient.d.ts", "declare const mounted: number;"],
      ])
    );
    assert.ok(access.files.has("ambient.d.ts"));
    assert.equal(writer.isAffordancePath("ambient.d.ts"), true);

    await writer.apply(payload([["tsconfig.json", "{}"]]));
    assert.equal(access.files.has("ambient.d.ts"), false);
    assert.equal(writer.isAffordancePath("ambient.d.ts"), false);
  });

  it("owns the generated tsconfig and the whole tree as affordance paths, and nothing else", () => {
    const writer = new ProjectAffordanceWriter(memoryFileAccess());
    assert.equal(writer.isAffordancePath("tsconfig.json"), true);
    assert.equal(writer.isAffordancePath(".libraries"), true);
    assert.equal(writer.isAffordancePath(`.libraries/${ORIGIN}/index.ts`), true);
    assert.equal(writer.isAffordancePath("main.ts"), false);
    assert.equal(writer.isAffordancePath("nested/tsconfig.json"), false);
  });

  it("materializes a library's binary asset byte for byte", async () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const access = memoryFileAccess();
    const writer = new ProjectAffordanceWriter(access);

    await writer.apply(
      payload([
        ["tsconfig.json", "{}"],
        [`${EXTENSIONS_TREE_PATH}/${ORIGIN}/icon.png`, pngBytes],
      ])
    );

    const written = access.files.get(`${EXTENSIONS_TREE_PATH}/${ORIGIN}/icon.png`);
    assert.ok(written instanceof Uint8Array, "the icon lands on disk as bytes");
    assert.deepEqual([...written], [...pngBytes]);
  });

  it("rewrites a binary asset only when its bytes change", async () => {
    const first = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const access = memoryFileAccess();
    const writer = new ProjectAffordanceWriter(access);
    const assetPath = `${EXTENSIONS_TREE_PATH}/${ORIGIN}/icon.png`;

    await writer.apply(
      payload([
        ["tsconfig.json", "{}"],
        [assetPath, first],
      ])
    );
    access.writes.length = 0;
    await writer.apply(
      payload([
        ["tsconfig.json", "{}"],
        [assetPath, new Uint8Array(first)],
      ])
    );

    assert.deepEqual(access.writes, [], "equal bytes in a fresh array are not a change");
  });
});
