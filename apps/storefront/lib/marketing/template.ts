import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { PANEL_URL, type Locale } from "@avably/core";

import pages from "@/marketing/pages.json";

export type MarketingPage = keyof typeof pages;

/** Identyfikator witryny z eksportu — wspólny dla wszystkich stron szablonu. */
export const WF_SITE = "6800e0d30d7466dc5e82f732";

const TOKEN = /\{\{([a-zA-Z0-9_.]+)\}\}/g;
const cache = new Map<MarketingPage, string>();

function readPage(page: MarketingPage): string {
  const cached = cache.get(page);
  if (cached) return cached;
  const file = path.join(process.cwd(), "marketing", `${page}.html`);
  const html = readFileSync(file, "utf8");
  cache.set(page, html);
  return html;
}

export function wfPageId(page: MarketingPage): string {
  return pages[page].wfPage;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/** Wartości wchodzą do HTML szablonu, więc jadą przez escape. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);
}

function flatten(source: unknown, prefix = "", out: Record<string, string> = {}) {
  if (typeof source === "string") {
    out[prefix] = source;
    return out;
  }
  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

/** Adresy podstawiane w szablonie — nasze trasy zamiast plików eksportu. */
export function marketingLinks(locale: Locale) {
  const other: Locale = locale === "pl" ? "en" : "pl";
  return {
    link: {
      home: `/${locale}`,
      pricing: `/${locale}/pricing`,
      faq: `/${locale}/faq`,
      contact: `/${locale}/contact`,
      privacy: `/${locale}/privacy`,
      waitlist: `/${locale}/waitlist`,
      register: `${PANEL_URL}/${locale}/register`,
      login: `${PANEL_URL}/${locale}/login`,
      langAlternate: `/${other}`,
    },
    lang: { alternate: other },
  };
}

/**
 * Podstawia treść w HTML przeniesionym z szablonu. Nieznany token jest błędem,
 * a nie pustym miejscem na stronie — inaczej brakujące tłumaczenie wychodziłoby
 * dopiero u odwiedzającego.
 */
export function renderMarketingPage(
  page: MarketingPage,
  values: Record<string, unknown>,
): string {
  const flat = flatten(values);
  const missing = new Set<string>();
  const html = readPage(page).replace(TOKEN, (match, key: string) => {
    const value = flat[key];
    if (value === undefined) {
      missing.add(key);
      return match;
    }
    return escapeHtml(value);
  });

  if (missing.size > 0) {
    throw new Error(`Brak treści dla tokenów szablonu: ${[...missing].sort().join(", ")}`);
  }
  return html;
}
