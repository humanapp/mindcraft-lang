import type { PluralRuleSpec } from "./plural";

/**
 * Translations keyed by English source string. `entries` holds plain keys;
 * `contexts` holds the same shape per context tag, for source strings whose
 * translation depends on the role they appear in.
 *
 * Context tags are an open namespace: nothing enumerates or validates them, so
 * a consumer introduces a new context family by shipping catalog entries under
 * a name of its own choosing.
 */
export interface MessageCatalog {
  readonly entries: Record<string, string>;
  readonly contexts: Record<string, Record<string, string>>;
}

/** A {@link MessageCatalog} together with the locale it translates and that locale's plural rule. */
export interface LocaleCatalog extends MessageCatalog {
  /** BCP-47-style locale code, for example `fr` or the pseudo-locale `qps`. */
  readonly locale: string;
  readonly pluralRule: PluralRuleSpec;
}

/** Locale code of the implicit identity catalog. */
export const kDefaultLocale = "en";

/** Context tag under which the localizer looks up its list-joining templates. */
export const kListContext = "list";
