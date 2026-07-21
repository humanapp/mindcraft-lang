/**
 * True for a normalized relative path safe to join under a root directory:
 * non-empty segments, no `.` or `..`, no leading slash, no backslashes. A path
 * rejected here can escape its intended root when joined, and must not be
 * written.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/**
 * The portion of `candidatePath` relative to `rootPath` when `candidatePath`
 * resolves inside `rootPath`, or undefined when it does not. Both are POSIX
 * (`/`-separated) paths, such as VS Code `Uri.path` values.
 */
export function containedRelativePath(rootPath: string, candidatePath: string): string | undefined {
  const root = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  if (!candidatePath.startsWith(root)) {
    return undefined;
  }
  return candidatePath.slice(root.length);
}
