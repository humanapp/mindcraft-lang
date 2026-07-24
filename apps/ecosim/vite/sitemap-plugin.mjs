import { coreConceptDocs } from '../../../packages/core/src/docs/manifest.ts';
import { appPatternDocs } from '../src/docs/manifest.ts';

const BASE_URL = 'https://sim.mindcraft-lang.org';

function entry(loc, changefreq, priority) {
  return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

function buildSitemapXml() {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entry(`${BASE_URL}/`, 'weekly', '1.0'),
    entry(`${BASE_URL}/docs`, 'weekly', '0.8'),
  ];

  for (const pattern of appPatternDocs) {
    parts.push(entry(`${BASE_URL}/docs/patterns/${encodeURIComponent(pattern.id)}`, 'monthly', '0.6'));
  }

  for (const concept of coreConceptDocs) {
    parts.push(entry(`${BASE_URL}/docs/concepts/${encodeURIComponent(concept.id)}`, 'monthly', '0.6'));
  }

  parts.push('</urlset>');
  return parts.join('\n') + '\n';
}

export function sitemapPlugin() {
  return {
    name: 'sitemap',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: buildSitemapXml(),
      });
    },
  };
}
