/**
 * Przeniesienie szablonu Forerunner do repo (ADR-068).
 *
 * Skrypt bierze WYEKSPORTOWANY HTML szablonu i produkuje pliki
 * `marketing/*.html`, które renderujemy na trasach `[locale]/**`. Zmienia się
 * wyłącznie:
 *   1. treść — teksty szablonu na tokeny `{{klucz}}` (i18n w runtime),
 *   2. adresy — assety na `/forerunner/**`, linki na nasze trasy,
 *   3. sekcje fabrykowanego dowodu społecznego — usunięte w całości.
 * Znaczniki, klasy i kolejność węzłów zostają nietknięte: to jest warunek
 * nieodróżnialności od oryginału.
 *
 * Uruchomienie (eksport nie wchodzi do repo):
 *   node scripts/build-marketing-html.mjs ../../downloads/forerunner-template.webflow
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import * as cheerio from "cheerio";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const exportRoot = path.resolve(process.argv[2] ?? path.join(appRoot, "../../downloads/forerunner-template.webflow"));
const outDir = path.join(appRoot, "marketing");
const publicRoot = path.join(appRoot, "public/forerunner");

/** Teksty szablonu → tokeny. Klucz = dokładna treść węzła w eksporcie. */
const TEXTS = JSON.parse(fs.readFileSync(path.join(here, "marketing-text-map.json"), "utf8"));

/** Adresy stron szablonu → nasze trasy (tokeny rozwijane per locale). */
const LINKS = {
  "index.html": "{{link.home}}",
  "../index.html": "{{link.home}}",
  "pricing.html": "{{link.pricing}}",
  "../pricing.html": "{{link.pricing}}",
  "faq.html": "{{link.faq}}",
  "../faq.html": "{{link.faq}}",
  "contact/contact-a.html": "{{link.contact}}",
  "contact-a.html": "{{link.contact}}",
  "../contact/contact-a.html": "{{link.contact}}",
  "legal.html": "{{link.privacy}}",
  "../legal.html": "{{link.privacy}}",
};

/** Węzły wycinane w całości: fabrykowany dowód społeczny i sprzedaż szablonu. */
const REMOVE = [
  ".sales-preview",
  ".sales-cta-master",
  ".home-a-logo-section",
  ".home-a-slider-section",
  ".hero-testimonial-box",
  ".testimonial-block-small",
  ".testimonial-card-master",
  ".cta-testimonial",
  ".menu-bottom-tile .text-body",
  ".banner-master .w-slider-nav",
  ".w-commerce-commercecartwrapper",
  ".nav-cart",
];

function assetPath(url) {
  const clean = url.replace(/^\.\.\//, "").split("?")[0];
  if (!/^(images|videos|fonts|css|js)\//.test(clean)) return null;
  const decoded = decodeURIComponent(clean);
  const dir = path.dirname(decoded);
  const base = path
    .basename(decoded)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-(?=\.)/g, "");
  const target = `${dir}/${base}`;
  return fs.existsSync(path.join(publicRoot, target)) ? `/forerunner/${target}` : null;
}

/** Znak marki: logotyp szablonu → wordmark Avably (artefakt Fazy 2, sekcja 02). */
const BRAND_IMAGES = {
  "images/Logo-Dark.svg": "/forerunner/images/avably-logo-dark.svg",
  "images/Logo.svg": "/forerunner/images/avably-logo-light.svg",
  "images/Footer-SVG.svg": "/forerunner/images/avably-logo-dark.svg",
  "images/favicon.svg": "/forerunner/images/avably-favicon.svg",
  "images/webclip.svg": "/forerunner/images/avably-favicon.svg",
};

function rewriteBrand($) {
  $("img[src]").each((_, el) => {
    const $el = $(el);
    const src = ($el.attr("src") ?? "").replace(/^\.\.\//, "");
    const replacement = BRAND_IMAGES[src];
    if (!replacement) return;
    $el.attr("src", replacement).attr("alt", "Avably").removeAttr("srcset").removeAttr("sizes");
  });
}

function rewriteAssets($) {
  $("[src], [srcset], [data-video-urls], [poster]").each((_, el) => {
    const $el = $(el);
    for (const attr of ["src", "poster"]) {
      const value = $el.attr(attr);
      if (!value || /^(https?:|data:|\/)/.test(value)) continue;
      const mapped = assetPath(value);
      if (mapped) $el.attr(attr, mapped);
    }
    for (const attr of ["srcset", "data-video-urls"]) {
      const value = $el.attr(attr);
      if (!value) continue;
      const parts = value
        .split(",")
        .map((part) => {
          const [url, ...rest] = part.trim().split(/\s+/);
          const mapped = assetPath(url);
          return mapped ? [mapped, ...rest].join(" ") : null;
        })
        .filter(Boolean);
      if (parts.length) $el.attr(attr, parts.join(", "));
      else $el.removeAttr(attr);
    }
  });
}

function rewriteLinks($) {
  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;
    if (href in LINKS) {
      $el.attr("href", LINKS[href]);
      $el.removeAttr("target");
      return;
    }
    if (/^https?:\/\/(webflow\.com|www\.byq\.studio|arieljedrzejczak|www\.figma\.com|facebook|instagram|linkedin|youtube)/.test(href)) {
      $el.attr("href", "{{link.home}}");
      $el.removeAttr("target");
      return;
    }
    // Strony szablonu, których nie przenosimy (sklep, historie, warianty).
    if (/\.html($|[?#])/.test(href) || href.startsWith("/product/") || href.startsWith("/stories/")) {
      $el.attr("href", "{{link.home}}");
      $el.removeAttr("target");
    }
  });
}

function replaceTexts($, stats) {
  const walk = (node) => {
    if (node.type === "text") {
      const raw = node.data;
      const trimmed = raw.trim().replace(/\s+/g, " ");
      if (!trimmed) return;
      const token = TEXTS[trimmed];
      if (token === undefined) {
        stats.untouched.add(trimmed);
        return;
      }
      stats.used.add(trimmed);
      if (token === null) return; // świadomie zostawiamy (np. separatory)
      node.data = raw.replace(raw.trim(), token);
      return;
    }
    if (node.children) node.children.forEach(walk);
  };
  $.root().children().each((_, el) => walk(el));
}

function buildPage(sourceFile, outFile, { removeExtra = [], transform } = {}) {
  const html = fs.readFileSync(path.join(exportRoot, sourceFile), "utf8");
  const $ = cheerio.load(html);

  $("script").remove();
  for (const selector of [...REMOVE, ...removeExtra]) $(selector).remove();

  transform?.($);
  rewriteBrand($);
  rewriteAssets($);
  rewriteLinks($);

  const stats = { used: new Set(), untouched: new Set() };
  replaceTexts($, stats);

  const body = $("body").html() ?? "";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, outFile), `${body.trim()}\n`, "utf8");

  const wfPage = $("html").attr("data-wf-page") ?? "";
  return { outFile, wfPage, stats };
}

/** Ustawia treść listy węzłów na kolejne tokeny (kolizje tekstów szablonu). */
function setTexts($, selector, tokens) {
  $(selector).each((index, el) => {
    if (index < tokens.length) $(el).text(tokens[index]);
  });
}

/** Podmienia obie warstwy napisu przycisku Webflow (efekt najechania). */
function setButton($, el, token, href) {
  const $el = $(el);
  const $labels = $el.find(".button-text, .text-underline, .button-text-small");
  // Proste linki (stopka) nie mają warstw napisu — wtedy tekst idzie wprost.
  if ($labels.length) $labels.text(token);
  else $el.text(token);
  if (href) {
    $el.filter("a").attr("href", href);
    $el.find("a").attr("href", href);
    $el.removeAttr("target");
    $el.find("a").removeAttr("target");
  }
}

const LANG_SWITCH = `
<div class="navigation-link-hover-wrap">
  <a href="{{link.langAlternate}}" hreflang="{{lang.alternate}}" class="nav-link light w-inline-block">
    <div class="button-text-mask">
      <div class="button-text _1">{{nav.langAlternate}}</div>
      <div class="button-text _2">{{nav.langAlternate}}</div>
    </div>
  </a>
</div>`;

/** Nawigacja i stopka są wspólne dla wszystkich przenoszonych stron. */
function transformShell($) {
  // Nawigacja: rozwijane menu stron szablonu i trasy, których nie mamy.
  $(".navigation-link-hover-wrap").each((_, el) => {
    const $el = $(el);
    const href = $el.find("a").attr("href") ?? "";
    const isDropdown = $el.find(".nav-dropdown").length > 0;
    if (isDropdown || /about\/|stories/.test(href)) $el.remove();
  });

  for (const [href, token] of [
    ["pricing.html", "{{nav.pricing}}"],
    ["contact/contact-a.html", "{{nav.waitlist}}"],
    ["contact-a.html", "{{nav.waitlist}}"],
    ["faq.html", "{{nav.faq}}"],
  ]) {
    // Podstrony leżą o katalog głębiej — eksport linkuje je z prefiksem `../`.
    $(`.nav-menu a[href="${href}"], .nav-menu a[href="../${href}"]`).each((_, el) =>
      setButton($, el, token),
    );
  }

  $(".nav-menu-inner").append(LANG_SWITCH);

  // Konta społecznościowe, których nie prowadzimy.
  $(".menu-socials, .footer-social-wrap").remove();

  // CTA nawigacji i menu mobilnego → rejestracja w panelu.
  $(".nav-desktop-button a, .menu-cta-link-wrap a").each((_, el) =>
    setButton($, el, "{{nav.cta}}", "{{link.register}}"),
  );
  $(".menu-cta-link-wrap .menu-link").text("{{footer.waitlistLead}}");
  $(".menu-cta-link-wrap a").text("{{footer.waitlistCta}}").attr("href", "{{link.waitlist}}");

  // Banner nad belką: cena zamiast promocji szablonu.
  $(".banner a").attr("href", "{{link.register}}");

  // Stopka: sprzedaż szablonu → nasze CTA; newsletter → lista oczekujących.
  $(".footer-top-tile a").each((_, el) => setButton($, el, "{{nav.cta}}", "{{link.register}}"));
  const $newsletter = $(".newsletter-form-block");
  $newsletter.find(".newsletter-field-master").replaceWith(
    `<a href="{{link.waitlist}}" class="cta-main dark-outlined w-inline-block">
      <div class="button-text-mask">
        <div class="button-text _1">{{footer.waitlistCta}}</div>
        <div class="button-text _2">{{footer.waitlistCta}}</div>
      </div>
      <div class="button-bg dark-outlined"></div>
    </a>`,
  );
  // Formularz Webflow celował w ich backend — zostaje sam układ.
  const $form = $newsletter.find("form");
  if ($form.length) $form.replaceWith(`<div class="newsletter-form">${$form.html() ?? ""}</div>`);
  $newsletter.find(".w-form-done, .w-form-fail").remove();

  const columns = $(".footer-column");
  const columnLinks = [
    [
      ["{{link.pricing}}", "{{nav.pricing}}"],
      ["{{link.faq}}", "{{nav.faq}}"],
      ["{{link.contact}}", "{{nav.contact}}"],
    ],
    [
      ["{{link.privacy}}", "{{footer.privacy}}"],
      ["{{link.waitlist}}", "{{nav.waitlist}}"],
      ["{{link.login}}", "{{nav.login}}"],
    ],
  ];
  columns.each((index, el) => {
    const $column = $(el);
    if (index >= columnLinks.length) {
      $column.remove();
      return;
    }
    const $items = $column.find(".footer-links-column > *");
    const target = columnLinks[index];
    $items.each((itemIndex, item) => {
      if (itemIndex >= target.length) {
        $(item).remove();
        return;
      }
      const [href, token] = target[itemIndex];
      const $item = $(item);
      const $link = $item.is("a") ? $item : $item.find("a").first();
      $link.attr("href", href).removeAttr("target");
      setButton($, $link, token);
    });
  });

  // Podpis autora szablonu.
  $(".footer-last-block .text-small.text-dark-64").last().remove();
}

function transformHome($) {
  transformShell($);
  setTexts($, ".hero-feature-item .text-medium", [
    "{{hero.feature1}}",
    "{{hero.feature2}}",
    "{{hero.feature3}}",
  ]);
  setTexts($, ".about-feature .text-medium", [
    "{{premise.feature1}}",
    "{{premise.feature2}}",
    "{{premise.feature3}}",
  ]);
  // Hero i sekcja CTA: „Buy Template” → rejestracja.
  $(".hero-button-wrap a, .cta-content-block a, .cta-button-wrap a").each((index, el) => {
    const $el = $(el);
    const isSecondary = index === 1 && $el.closest(".hero-button-wrap").length > 0;
    if (isSecondary) {
      setButton($, el, "{{hero.ctaSecondary}}", "#features");
      return;
    }
    setButton($, el, "{{nav.cta}}", "{{link.register}}");
  });
  $(".cta-button-wrap a").last().each((_, el) => setButton($, el, "{{nav.waitlist}}", "{{link.waitlist}}"));
  $(".features-headline a, .headline-home-a-features a").each((_, el) =>
    setButton($, el, "{{nav.cta}}", "{{link.register}}"),
  );
}

/** Miejsce, w które strona wstawia komponent Reacta (formularz, treść prawna). */
const ISLAND = "<!--avably-island-->";

function transformWaitlist($) {
  transformShell($);
  $(".heading-contact .label-small, .headline-contact .label-small").text("{{nav.waitlist}}");
  // Formularz Webflow celował w ich backend — zostaje sam układ sekcji.
  $(".contact-form-block, .form-block-contact, .w-form")
    .filter((_, el) => $(el).find("textarea").length > 0)
    .replaceWith(ISLAND);
  // Dane kontaktowe szablonu: telefon i profile społecznościowe, których nie mamy.
  $(".contact-info-single").each((_, el) => {
    const text = $(el).text();
    if (/\+48 22|Instagram|Social/i.test(text)) $(el).remove();
  });
}

function transformPrivacy($) {
  transformShell($);
  $(".heading-legal .label-small").text("{{privacyPage.eyebrow}}");
  $(".heading-legal h1").text("{{privacyPage.title}}");
  $(".body-legal").empty().append(ISLAND);
}

const pages = [
  { source: "index.html", out: "home.html", transform: transformHome },
  { source: "contact/contact-a.html", out: "waitlist.html", transform: transformWaitlist },
  { source: "legal.html", out: "privacy.html", transform: transformPrivacy },
];

const summary = [];
for (const page of pages) {
  if (!fs.existsSync(path.join(exportRoot, page.source))) continue;
  const result = buildPage(page.source, page.out, { transform: page.transform });
  summary.push(result);
  const leftovers = [...result.stats.untouched].filter((t) => /[A-Za-z]{3}/.test(t));
  console.log(`${page.out}: podmieniono ${result.stats.used.size}, bez mapy ${leftovers.length}`);
  for (const text of leftovers.slice(0, 40)) console.log(`   ? ${text}`);
}

fs.writeFileSync(
  path.join(outDir, "pages.json"),
  `${JSON.stringify(
    Object.fromEntries(summary.map((s) => [s.outFile.replace(".html", ""), { wfPage: s.wfPage }])),
    null,
    2,
  )}\n`,
  "utf8",
);
