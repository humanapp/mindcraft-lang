// ---------------------------------------------------------------------------
// Display-time localization.
//
// - Localizer: the injected service every display surface renders through
// - Catalogs: per-locale JSON compiled into generated modules under _generated/
// - Template engine: the bounded message syntax `tr` renders
//
// Typical usage:
//   import { createDefaultLocalizer } from "@mindcraft-lang/core/localization";
//   import * as fr from "@mindcraft-lang/core/localization/fr";
// ---------------------------------------------------------------------------

export type { LocaleCatalog, MessageCatalog } from "./catalog";
export { kDefaultLocale, kListContext, kTileLabelContext } from "./catalog";
export type {
  CatalogBuildIssue,
  CatalogEntryInput,
  CatalogModuleInput,
  CatalogModuleResult,
} from "./catalog-build";
export { buildLocaleCatalogModule } from "./catalog-build";
export type { ListKind, Localizer } from "./localizer";
export { createDefaultLocalizer, createLocalizer } from "./localizer";
export type {
  PluralCategory,
  PluralClause,
  PluralOperand,
  PluralRange,
  PluralRuleSpec,
  PluralTest,
} from "./plural";
export { defaultPluralRule, selectPluralCategory } from "./plural";
export { pseudoLocalize } from "./pseudo-locale";
export type { SentenceCaseSpec } from "./sentence-case";
export { applySentenceCase, defaultSentenceCaseSpec } from "./sentence-case";
export type {
  LocalizedValue,
  ParsedTemplate,
  TemplateBranch,
  TemplateIssue,
  TemplateNode,
} from "./template";
export { parseTemplate, renderTemplate, TemplateDiagCode } from "./template";
