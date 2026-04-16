import type { ExampleDefinition } from "@mindcraft-lang/bridge-app";

const raw = import.meta.glob("./**/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export function loadExamples(): ExampleDefinition[] {
  const groups = new Map<string, { path: string; content: string }[]>();

  for (const [key, content] of Object.entries(raw)) {
    const match = key.match(/^\.\/([^/]+)\/(.+)$/);
    if (!match || match[1] === "index.ts") continue;

    const folder = match[1];
    const path = match[2];

    let files = groups.get(folder);
    if (!files) {
      files = [];
      groups.set(folder, files);
    }
    files.push({ path, content });
  }

  const result: ExampleDefinition[] = [];
  for (const [folder, files] of groups) {
    result.push({ folder, files });
  }
  return result;
}
