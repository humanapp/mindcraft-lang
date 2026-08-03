import { List } from "../platform/list";
import { kDefaultLocale, kListContext, type LocaleCatalog } from "./catalog";
import { foldForSearch } from "./folding";
import { defaultPluralRule } from "./plural";
import { applySentenceCase, defaultSentenceCaseSpec } from "./sentence-case";
import { type LocalizedValue, renderTemplate } from "./template";

/** Conjunction a joined list reads with. */
export type ListKind = "and" | "or";

/**
 * Display-time translation service. Hosts construct one per locale and inject
 * it.
 */
export interface Localizer {
  /** The locale this instance renders, for example `en` or `fr`. */
  locale(): string;

  /**
   * Render the English source string `source` in the active locale.
   *
   * `source` is both the message key and the English template. `params`
   * supplies the named placeholders; `context` selects a contextualized entry
   * for source strings whose translation depends on their role. A source with
   * no catalog entry renders from the English text itself.
   */
  tr(source: string, params?: Record<string, LocalizedValue>, context?: string): string;

  /** Join `items` into one display string with the locale's conjunction glue. */
  list(items: readonly string[], kind: ListKind): string;

  /**
   * Order two DISPLAY strings by the locale's collation, returning a negative,
   * zero, or positive number as `a` sorts before, with, or after `b`.
   *
   * Never apply it to machine keys, ids, or any ordering that reaches a
   * compiled or persisted artifact.
   */
  compare(a: string, b: string): number;

  /**
   * Normalize `s` for search matching by folding case and diacritics. Apply it
   * to the query and the candidate alike.
   */
  foldForSearch(s: string): string;

  /**
   * Case `text` as the word a sentence opens with in this locale.
   *
   * The operation only ever uppercases, and only the word's leading unit --
   * one character by default, a locale's declared digraph where it declares
   * one. Authored case is the source of truth everywhere else: a word that
   * already opens with a capital comes back unchanged, and nothing after the
   * leading unit is touched. A locale that opens a sentence in lower case
   * returns `text` unchanged.
   *
   * Apply it only to the word a sentence opens with, and only for display; a
   * surface that matches, keys, or identifies a word reads the authored text.
   */
  sentenceCase(text: string): string;
}

/** List-glue templates, looked up under the `list` context. */
const kGlueTemplate = "{a}, {b}";
const kTwoAndTemplate = "{a} and {b}";
const kEndAndTemplate = "{a}, and {b}";
const kTwoOrTemplate = "{a} or {b}";
const kEndOrTemplate = "{a}, or {b}";

class CatalogLocalizer implements Localizer {
  private readonly catalog: LocaleCatalog;

  constructor(catalog: LocaleCatalog) {
    this.catalog = catalog;
  }

  locale(): string {
    return this.catalog.locale;
  }

  /** The template for `source`, falling back to the English source itself. */
  private template(source: string, context?: string): string {
    if (context !== undefined) {
      const scoped = this.catalog.contexts[context];
      if (scoped !== undefined) {
        const hit = scoped[source];
        if (hit !== undefined) {
          return hit;
        }
      }
      return source;
    }
    const hit = this.catalog.entries[source];
    return hit === undefined ? source : hit;
  }

  tr(source: string, params?: Record<string, LocalizedValue>, context?: string): string {
    return renderTemplate(this.template(source, context), params, this.catalog.pluralRule);
  }

  private glue(left: string, right: string, template: string): string {
    return this.tr(template, { a: left, b: right }, kListContext);
  }

  list(items: readonly string[], kind: ListKind): string {
    const values = List.from(items);
    const count = values.size();
    if (count === 0) {
      return "";
    }
    if (count === 1) {
      return values.get(0);
    }
    if (count === 2) {
      return this.glue(values.get(0), values.get(1), kind === "and" ? kTwoAndTemplate : kTwoOrTemplate);
    }
    let head = values.get(0);
    for (let i = 1; i < count - 1; i++) {
      head = this.glue(head, values.get(i), kGlueTemplate);
    }
    return this.glue(head, values.get(count - 1), kind === "and" ? kEndAndTemplate : kEndOrTemplate);
  }

  compare(a: string, b: string): number {
    const foldedA = foldForSearch(a);
    const foldedB = foldForSearch(b);
    if (foldedA !== foldedB) {
      return foldedA < foldedB ? -1 : 1;
    }
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  }

  foldForSearch(s: string): string {
    return foldForSearch(s);
  }

  sentenceCase(text: string): string {
    return applySentenceCase(this.catalog.sentenceCase ?? defaultSentenceCaseSpec, this.catalog.locale, text);
  }
}

/** Build a {@link Localizer} that resolves source strings through `catalog`. */
export function createLocalizer(catalog: LocaleCatalog): Localizer {
  return new CatalogLocalizer(catalog);
}

/**
 * Build the default {@link Localizer}: with no catalog behind it every English
 * source string is its own template, so `tr` interpolates and pluralizes and
 * otherwise returns the source unchanged.
 */
export function createDefaultLocalizer(): Localizer {
  return new CatalogLocalizer({
    locale: kDefaultLocale,
    pluralRule: defaultPluralRule,
    entries: {},
    contexts: {},
  });
}
