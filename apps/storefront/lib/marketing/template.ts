import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { PANEL_URL, type Locale } from "@avably/core";

import pages from "@/marketing/pages.json";

export type MarketingPage = keyof typeof pages;

/**
 * Strony PUBLICZNE: linkowane z nawigacji i stopki, indeksowane, w sitemap.
 * Warianty PRZEGLĄDOWE układów (home-b/c, about-a/b/c, contact-b/c, stories)
 * zostały USUNIĘTE z repo przy odsłonięciu LP (ADR-128): wybór układu jest
 * dokonany, a strona bez własnej treści nie ma prawa być osiągalna publicznie
 * (checklista I-03 audytu 2026-08-09). Strona `waitlist` zniknęła tym samym
 * trybem (decyzja właściciela 2026-08-12): LP prowadzi wprost do rejestracji
 * panelu, lista oczekujących nie ma już ani trasy, ani treści.
 */
export const PUBLIC_PAGES = ["home", "pricing", "faq", "contact", "privacy", "terms"] as const;

/** Trasy obsługiwane przez wspólny segment `[page]` (bez wysp Reacta). */
export const TEMPLATE_ROUTES = ["pricing", "faq", "contact"] as const;

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

/**
 * Skrypt startowy dla `<head>`: ustawia `data-wf-page` PRZED wykonaniem
 * webflow.js. IX2 czyta ten atrybut w momencie startu i przy niezgodności
 * milcząco pomija interakcje odsłaniające sekcje (elementy eksportu mają
 * inline `opacity:0`), a atrybutu nie da się wyrenderować statycznie — `<html>`
 * należy do layoutu wspólnego dla wszystkich tras marketingowych.
 */
export function wfBootstrapScript(): string {
  const map = Object.fromEntries(
    Object.entries(pages).map(([page, meta]) => [page === "home" ? "" : page, meta.wfPage]),
  );
  return `(function(){var m=${JSON.stringify(map)};var p=location.pathname.replace(/\\/$/,"").split("/").pop()||"";var id=m[p]!==undefined?m[p]:m[""];var r=document.documentElement;r.setAttribute("data-wf-page",id);r.setAttribute("data-wf-site",${JSON.stringify(WF_SITE)});r.className+=" w-mod-js";})();`;
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
      terms: `/${locale}/terms`,
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
