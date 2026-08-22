import type { LibraryUninstallImpact } from "@wendoo/bridge-app";

interface UninstallImpactMessageProps {
  /** The computed impact: the brains and files still using the library. */
  impact: Pick<LibraryUninstallImpact, "brainNames" | "filePaths">;
}

/** Body of the uninstall confirmation: the brains and files still using the library, and what removal means. */
export function UninstallImpactMessage({ impact }: UninstallImpactMessageProps) {
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <p>This library is still used by:</p>
      <ul className="list-disc pl-5">
        {impact.brainNames.map((name) => (
          <li key={`brain:${name}`} data-testid="uninstall-impact-brain">
            {name}
          </li>
        ))}
        {impact.filePaths.map((path) => (
          <li key={`file:${path}`} data-testid="uninstall-impact-file">
            {path}
          </li>
        ))}
      </ul>
      <p>
        Removing it now leaves those tiles as placeholders until the library is installed again; nothing is deleted.
      </p>
    </div>
  );
}
