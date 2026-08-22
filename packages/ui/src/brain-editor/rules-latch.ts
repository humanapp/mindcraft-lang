import { task } from "@wendoo/core";
import { useEffect, useState } from "react";

/**
 * What the editor's rules area stands.
 *
 * - `no-page` -- the editor has no page to show, so there are no rules to build.
 * - `loading` -- a page is being shown whose rules have not been committed yet.
 * - `rules` -- the committed rules belong to the page being shown.
 */
export type RulesAreaStand = "no-page" | "loading" | "rules";

/**
 * What the rules area stands, given the page being shown and the page the
 * committed rules were built from. The two are compared by identity, so a page
 * the editor has moved to, replaced, or re-opened reads as `loading` until its
 * own rules are committed.
 */
export function rulesAreaStand<T>(shownPage: T | undefined, latchedPage: T | undefined): RulesAreaStand {
  if (shownPage === undefined) return "no-page";
  return shownPage === latchedPage ? "rules" : "loading";
}

/**
 * Latches `shownPage` on from a zero-delay task, which is the page whose rules
 * may be rendered. The commit that mounts the caller carries no rules; the task
 * that follows it puts them on in an ordinary state update, with a turn of the
 * event loop in between.
 *
 * The latch is only ever set to the page being shown and never cleared, so
 * rules already standing for a page cannot be taken back off it. A caller that
 * stops rendering, or moves to another page before the task runs, cancels it.
 * Pass the result to {@link rulesAreaStand}.
 */
export function useLatchedPage<T>(shownPage: T | undefined): T | undefined {
  const [latchedPage, setLatchedPage] = useState<T | undefined>(undefined);
  useEffect(() => {
    if (shownPage === undefined || shownPage === latchedPage) return;
    const latching = task.delay(0, () => setLatchedPage(() => shownPage));
    return () => task.cancel(latching);
  }, [shownPage, latchedPage]);
  return latchedPage;
}
