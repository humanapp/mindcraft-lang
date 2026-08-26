const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { dirname, join, relative, resolve } = require("node:path");
const { after, before, describe, test } = require("node:test");

/**
 * Editor project coverage: every spec project must be reachable by the
 * editor. Spec files are excluded from each package's tsconfig.json, so the
 * root tsconfig.json (an editor-only solution file) must reference every
 * tsconfig.spec.json, and tsserver must assign each package's spec files to
 * its spec project with zero semantic diagnostics. A spec file the editor
 * cannot place lands in an inferred project and shows bogus errors.
 */

const repoRoot = resolve(__dirname, "..");

/** TypeScript installation the editor is pinned to (the ts-compiler copy). */
const typescriptDir = dirname(
  require.resolve("typescript/package.json", { paths: [join(repoRoot, "packages", "ts-compiler")] })
);

/** Every tsconfig.spec.json in the tree, as repo-root-relative paths. */
function discoverSpecConfigs() {
  const found = [];
  for (const group of ["packages", "apps"]) {
    for (const entry of readdirSync(join(repoRoot, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(group, entry.name, "tsconfig.spec.json");
      if (existsSync(join(repoRoot, candidate))) found.push(candidate);
    }
  }
  return found;
}

/** First *.spec.ts / *.spec.tsx under the package's src tree, or undefined. */
function firstSpecFile(packageDir) {
  const src = join(repoRoot, packageDir, "src");
  if (!existsSync(src)) return undefined;
  const stack = [src];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.spec\.tsx?$/.test(entry.name)) return full;
    }
  }
  return undefined;
}

/** A tsserver session speaking the wire protocol over stdio. */
function startTsserver() {
  const proc = spawn("node", [join(typescriptDir, "lib", "tsserver.js"), "--disableAutomaticTypingAcquisition"], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  let seq = 0;
  let buffered = "";
  const pending = new Map();
  proc.stdout.on("data", (chunk) => {
    buffered += chunk.toString("utf8");
    for (;;) {
      const headerEnd = buffered.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = /Content-Length: (\d+)/.exec(buffered.slice(0, headerEnd));
      if (!header) {
        buffered = buffered.slice(headerEnd + 4);
        continue;
      }
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + Number(header[1]);
      if (buffered.length < bodyEnd) return;
      const body = buffered.slice(bodyStart, bodyEnd);
      buffered = buffered.slice(bodyEnd);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      if (message.type === "response" && pending.has(message.request_seq)) {
        pending.get(message.request_seq)(message);
        pending.delete(message.request_seq);
      }
    }
  });
  return {
    request(command, args) {
      const requestSeq = ++seq;
      const response = new Promise((resolveResponse) => pending.set(requestSeq, resolveResponse));
      proc.stdin.write(`${JSON.stringify({ seq: requestSeq, type: "request", command, arguments: args })}\n`);
      return response;
    },
    notify(command, args) {
      proc.stdin.write(`${JSON.stringify({ seq: ++seq, type: "request", command, arguments: args })}\n`);
    },
    stop() {
      proc.stdin.end();
      proc.kill();
    },
  };
}

describe("editor project coverage", () => {
  const specConfigs = discoverSpecConfigs();
  let server;

  before(() => {
    server = startTsserver();
  });
  after(() => {
    server.stop();
  });

  test("root tsconfig.json references every tsconfig.spec.json", () => {
    const ts = require(join(typescriptDir, "lib", "typescript.js"));
    const rootConfigPath = join(repoRoot, "tsconfig.json");
    const rootConfig = ts.readConfigFile(rootConfigPath, (p) => readFileSync(p, "utf8"));
    assert.equal(rootConfig.error, undefined);
    const referenced = new Set(
      (rootConfig.config.references ?? []).map((ref) => relative(repoRoot, resolve(repoRoot, ref.path)))
    );
    for (const config of specConfigs) {
      assert.ok(referenced.has(config), `root tsconfig.json must reference ${config}`);
    }
  });

  for (const config of specConfigs) {
    const packageDir = dirname(config);
    const specFile = firstSpecFile(packageDir);
    test(`${packageDir}: a spec file belongs to its spec project and is clean`, { skip: !specFile }, async () => {
      server.notify("open", { file: specFile });
      const info = await server.request("projectInfo", { file: specFile, needFileNameList: false });
      const diagnostics = await server.request("semanticDiagnosticsSync", { file: specFile });
      server.notify("close", { file: specFile });
      const project = info.body?.configFileName ?? "(none)";
      assert.equal(
        relative(repoRoot, project),
        config,
        `${relative(repoRoot, specFile)} landed in ${project} -- an editor-orphaned spec shows bogus diagnostics`
      );
      const codes = (diagnostics.body ?? []).map((d) => `TS${d.code}`);
      assert.deepEqual(codes, [], `${relative(repoRoot, specFile)} has editor diagnostics: ${codes.join(", ")}`);
    });
  }

  test("a package source file still belongs to its build project", async () => {
    const controlFile = join(repoRoot, "packages", "assistant-relay", "src", "session.ts");
    server.notify("open", { file: controlFile });
    const info = await server.request("projectInfo", { file: controlFile, needFileNameList: false });
    server.notify("close", { file: controlFile });
    assert.equal(
      relative(repoRoot, info.body?.configFileName ?? "(none)"),
      join("packages", "assistant-relay", "tsconfig.json")
    );
  });
});
