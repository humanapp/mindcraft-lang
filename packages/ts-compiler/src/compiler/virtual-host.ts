import ts from "typescript";

const LIB_DIR = "/lib/";

function resolvePath(base: string, relative: string): string {
  const segments = base.split("/").filter((s) => s.length > 0);
  for (const part of relative.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return `/${segments.join("/")}`;
}

export function createVirtualCompilerHost(files: Map<string, string>, options: ts.CompilerOptions): ts.CompilerHost {
  return {
    getSourceFile(fileName, languageVersion) {
      const content = files.get(fileName);
      if (content === undefined) return undefined;
      return ts.createSourceFile(fileName, content, languageVersion);
    },
    getDefaultLibFileName: () => `${LIB_DIR}lib.mindcraft.d.ts`,
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) => files.has(fileName),
    readFile: (fileName) => files.get(fileName),
    getDirectories: () => [],
    resolveModuleNameLiterals(moduleLiterals, containingFile, _redirected, _options, _source, _reused) {
      return moduleLiterals.map((literal) => {
        const name = literal.text;
        let base: string;
        if (name.startsWith("./") || name.startsWith("../")) {
          const containingDir = containingFile.substring(0, containingFile.lastIndexOf("/"));
          base = resolvePath(containingDir, name);
        } else {
          base = `/${name}`;
        }
        const candidates = [`${base}.d.ts`, `${base}.ts`, `${base}/index.d.ts`, `${base}/index.ts`];
        for (const candidate of candidates) {
          if (files.has(candidate)) {
            return {
              resolvedModule: {
                resolvedFileName: candidate,
                isExternalLibraryImport: false,
                extension: candidate.endsWith(".d.ts") ? ts.Extension.Dts : ts.Extension.Ts,
              },
            };
          }
        }
        return { resolvedModule: undefined };
      });
    },
  };
}
