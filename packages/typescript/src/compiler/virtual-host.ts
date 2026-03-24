import ts from "typescript";

const LIB_DIR = "/lib/";

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
        const candidates = [`/${name}.d.ts`, `/${name}.ts`, `/${name}/index.d.ts`, `/${name}/index.ts`];
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
