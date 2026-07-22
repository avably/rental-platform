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
const LINKS = {};
for (const [file, token] of [
  ["index.html", "{{link.home}}"],
  ["pricing.html", "{{link.pricing}}"],
  ["faq.html", "{{link.faq}}"],
  ["legal.html", "{{link.privacy}}"],
  ["stories.html", "{{link.stories}}"],
  ["contact/contact-a.html", "{{link.contact}}"],
  ["contact/contact-b.html", "{{link.contactB}}"],
  ["contact/contact-c.html", "{{link.contactC}}"],
  ["about/about-a.html", "{{link.about}}"],
  ["about/about-b.html", "{{link.aboutB}}"],
  ["about/about-c.html", "{{link.aboutC}}"],
  ["homepage/home-b.html", "{{link.homeB}}"],
  ["homepage/home-c.html", "{{link.homeC}}"],
]) {
  const base = file.split("/").pop();
  // Eksport linkuje te same strony różnie, zależnie od katalogu źródłowego.
  for (const variant of [file, `../${file}`, base, `../${base}`, `./${base}`]) LINKS[variant] = token;
}

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


/**
 * Kopiuje do `public/forerunner/**` DOKŁADNIE te zasoby, których używają
 * przenoszone strony — ani jednego więcej. Katalogi obrazów i wideo są
 * czyszczone przed kopiowaniem, więc plik przestający być używany znika z repo
 * zamiast zostawać sierotą (bramka `marketing-template.test.ts`).
 */
function assetTargetName(rel) {
  const decoded = decodeURIComponent(rel);
  const dir = path.dirname(decoded);
  const base = path
    .basename(decoded)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-(?=\.)/g, "");
  return `${dir}/${base}`;
}

function copyAssets(sources) {
  const referenced = new Set();
  for (const source of sources) {
    const html = fs.readFileSync(path.join(exportRoot, source), "utf8");
    const values = [
      ...html.matchAll(/(?:src|srcset|data-video-urls|poster)="([^"]+)"/g),
      ...html.matchAll(/url\(["']?([^)"']+)["']?\)/g),
    ].map((match) => match[1]);
    for (const value of values) {
      for (const part of value.split(",")) {
        const url = part.trim().split(/\s+/)[0].replace(/^\.\.\//, "").split("?")[0];
        if (/^(images|videos)\//.test(url)) referenced.add(url);
      }
    }
  }

  for (const dir of ["images", "videos"]) {
    fs.rmSync(path.join(publicRoot, dir), { recursive: true, force: true });
    fs.mkdirSync(path.join(publicRoot, dir), { recursive: true });
  }

  let copied = 0;
  for (const rel of referenced) {
    const from = path.join(exportRoot, decodeURIComponent(rel));
    // Warianty srcset, których eksport nie zawiera (Webflow generuje je na CDN).
    if (!fs.existsSync(from)) continue;
    // Wideo cięższe niż 5 MB nie wchodzi do repo — każdy klip ma w eksporcie
    // dwa warianty (mp4 i webm), a `rewriteAssets` usuwa źródła bez pliku,
    // więc zostaje lżejszy. Bez tego repo puchnie o kilkadziesiąt megabajtów.
    if (/\.(mp4|webm|mov)$/i.test(rel) && fs.statSync(from).size > 5 * 1024 * 1024) continue;
    const to = path.join(publicRoot, assetTargetName(rel));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied += 1;
  }
  // Znak marki i favicon powstają poza eksportem — odtwarzamy je po czyszczeniu.
  for (const [file, content] of Object.entries(BRAND_FILES)) {
    fs.writeFileSync(path.join(publicRoot, "images", file), content, "utf8");
  }
  return copied;
}

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


const WORDMARK_PATHS =
  '<path d="M280.703 69.8609L268.659 33.4453H276.31L287.434 68.7273L299.336 33.4453H307.2L289.063 84.7389H281.482L286.938 69.8609H280.703Z"/><path d="M258.992 69.8588V20.2656H266.077V69.8588H258.992Z"/><path d="M239.521 70.7799C231.302 70.7799 226.627 64.8287 225.422 56.7521V69.8588H218.337V20.2656H225.422V45.9833C226.627 37.6233 232.436 32.5222 239.521 32.5222C248.944 32.5222 255.461 40.528 255.461 51.7219C255.461 62.6324 248.802 70.7799 239.521 70.7799ZM225.139 51.7219C225.139 58.8066 229.815 64.3327 236.616 64.3327C243.205 64.3327 248.235 59.4443 248.235 51.7219C248.235 44.1412 243.205 38.9694 236.758 38.9694C230.381 38.9694 225.139 43.6453 225.139 51.7219Z"/><path d="M193.072 70.7811C185.775 70.7811 180.603 66.0343 180.603 59.2329C180.603 52.4316 185.633 48.4641 192.647 47.7556L205.045 46.4804C204.974 42.1587 201.857 38.758 196.402 38.758C191.372 38.758 188.963 41.9461 188.325 44.8509L182.02 43.0089C183.649 36.6326 188.892 32.5234 196.402 32.5234C207.029 32.5234 211.988 39.6082 211.988 46.9055V69.86H204.974V58.6662C204.974 66.3885 200.015 70.7811 193.072 70.7811ZM187.688 59.2329C187.688 62.7045 190.663 64.9007 194.56 64.9007C202.07 64.9007 205.045 59.4455 205.045 54.2736V52.2899L194.205 53.4234C189.884 53.9194 187.688 55.9031 187.688 59.2329Z"/><path d="M154.973 69.8609L143.071 33.4453H150.581L161.775 68.7982L172.543 33.4453H180.195L168.292 69.8609H154.973Z"/><path d="M100.8 69.8588L116.599 20.2656H130.556L146.355 69.8588H138.774L135.303 58.8775H111.781L108.31 69.8588H100.8ZM113.907 52.0053H133.177L123.542 21.3992L113.907 52.0053Z"/>';

const wordmark = (ink) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 348 93" role="img" aria-label="Avably"><circle cx="57.5" cy="46" r="15" fill="#A8C743"/><g transform="translate(-2 0)" fill="${ink}">${WORDMARK_PATHS}</g></svg>\n`;

/** Znak marki wg artefaktu Fazy 2 (sekcja 02) — jedyne pliki spoza eksportu. */
const BRAND_FILES = {
  "avably-logo-dark.svg": wordmark("#0B1017"),
  "avably-logo-light.svg": wordmark("#F4F6F5"),
  "avably-favicon.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="Avably"><rect width="96" height="96" rx="28" fill="#EAFFA4"/><circle cx="24" cy="48" r="10" fill="#A8C743"/><g transform="translate(40 24) scale(.96) translate(-100.8 -20.2656)" fill="#0B1017"><path d="M100.8 69.8588L116.599 20.2656H130.556L146.355 69.8588H138.774L135.303 58.8775H111.781L108.31 69.8588H100.8ZM113.907 52.0053H133.177L123.542 21.3992L113.907 52.0053Z"/></g></svg>\n',
};

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
  // Źródła wideo bez pliku w repo (wariant odrzucony przez limit rozmiaru).
  $("video source[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src && !/^\/forerunner\//.test(src) && !assetPath(src)) $(el).remove();
  });
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

/**
 * Neutralizacja nazw szablonu i jego autora w tekście wypełniacza. Strony
 * przeglądowe zachowują angielską treść z eksportu, ale NIE wolno im nieść
 * cudzej marki — bramka `marketing-template.test.ts` skanuje wszystkie pliki.
 */
const VENDOR_WORDS = [
  [/Forerunner\u2122|Forerunner\u00ae|Forerunner/g, "the product"],
  [/BYQ\u00ae Studio|BYQ Studio|BYQ\u2019s|BYQ/g, "the studio"],
  [/Webflow\u2019s|Webflow/g, "the builder"],
  [/for:human\u2122|For:Human\u2122/g, "the client"],
  [/terra-tory\u2122/g, "the client"],
  [/Ariel J\u0119drzejczak|Ariel/g, "the designer"],
  [/FRANCO\u00ae|Monolith\u2122|Monolith/g, "the client"],
];

function neutralizeVendor(text) {
  let out = text;
  for (const [pattern, replacement] of VENDOR_WORDS) out = out.replace(pattern, replacement);
  return out;
}

function replaceTexts($, stats) {
  const walk = (node) => {
    if (node.type === "text") {
      const raw = node.data;
      const trimmed = raw.trim().replace(/\s+/g, " ");
      if (!trimmed) return;
      const token = TEXTS[trimmed];
      if (token === undefined) {
        const neutral = neutralizeVendor(trimmed);
        if (neutral !== trimmed) node.data = raw.replace(raw.trim(), neutral);
        else stats.untouched.add(trimmed);
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
  for (const attr of ["alt", "title", "placeholder", "aria-label"]) {
    $(`[${attr}]`).each((_, el) => {
      const value = $(el).attr(attr);
      if (value) $(el).attr(attr, neutralizeVendor(value));
    });
  }
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
    ["contact/contact-a.html", "{{nav.contact}}"],
    ["contact-a.html", "{{nav.contact}}"],
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


/** Karty planu: kolekcja cennika jest w eksporcie PUSTA (CMS), więc odtwarzamy
 *  je z klas szablonu z treścią wg decyzji właściciela. */
const PRICING_CARD = `
<div class="pricing-card">
  <div class="label-master dark"><div class="label-small">{{pricingPage.planLabel}}</div></div>
  <div class="text-h3 no-margins">{{pricingPage.price}}</div>
  <div class="text-dark-64">{{pricingPage.priceNote}}</div>
  <div class="text-medium">{{pricingPage.includesTitle}}</div>
  <div class="text-dark-64">{{pricingPage.include1}}</div>
  <div class="text-dark-64">{{pricingPage.include2}}</div>
  <div class="text-dark-64">{{pricingPage.include3}}</div>
  <div class="text-dark-64">{{pricingPage.include4}}</div>
  <div class="text-dark-64">{{pricingPage.include5}}</div>
  <a href="{{link.register}}" class="cta-main accent w-inline-block">
    <div class="button-text-mask"><div class="button-text _1">{{nav.cta}}</div><div class="button-text _2">{{nav.cta}}</div></div>
    <div class="button-bg accent"></div>
  </a>
</div>
<div class="pricing-card last-plan">
  <div class="label-master"><div class="label-small">{{pricingPage.foundersLabel}}</div></div>
  <div class="text-h3 no-margins">{{pricingPage.foundersPrice}}</div>
  <div>{{pricingPage.foundersNote}}</div>
  <div class="text-medium">{{pricingPage.honestTitle}}</div>
  <div>{{pricingPage.honest1}}</div>
  <div>{{pricingPage.honest2}}</div>
  <div>{{pricingPage.buildingTitle}}</div>
  <div>{{pricingPage.building1}}</div>
  <div>{{pricingPage.building2}}</div>
  <a href="{{link.waitlist}}" class="cta-main dark-outlined w-inline-block">
    <div class="button-text-mask"><div class="button-text _1">{{nav.waitlist}}</div><div class="button-text _2">{{nav.waitlist}}</div></div>
    <div class="button-bg dark-outlined"></div>
  </a>
</div>`;

function transformPricing($) {
  transformShell($);
  $(".headline-pricing .label-small").text("{{nav.pricing}}");
  $(".headline-pricing h1").text("{{pricingPage.title}}");
  // Przełącznik miesiąc/rok nie ma czego przełączać przy jednym planie.
  $(".tabs-menu-pricing").remove();
  $(".tab-pane-pricing").each((index, el) => {
    if (index > 0) {
      $(el).remove();
      return;
    }
    $(el).find(".product-thirds").html(PRICING_CARD);
  });
  // Pas logotypów klientów pod cennikiem: ten sam fejk, co na landingu.
  $(".pricing-logo-master").remove();
  $(".w-dyn-empty, .w-dyn-hide").remove();
}

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
  { source: "pricing.html", out: "pricing.html", transform: transformPricing },
  { source: "faq.html", out: "faq.html", transform: transformShell },
  { source: "contact/contact-a.html", out: "contact.html", transform: transformShell },
  { source: "contact/contact-a.html", out: "waitlist.html", transform: transformWaitlist },
  { source: "contact/contact-b.html", out: "contact-b.html", transform: transformShell },
  { source: "contact/contact-c.html", out: "contact-c.html", transform: transformShell },
  { source: "about/about-a.html", out: "about.html", transform: transformShell },
  { source: "about/about-b.html", out: "about-b.html", transform: transformShell },
  { source: "about/about-c.html", out: "about-c.html", transform: transformShell },
  { source: "stories.html", out: "stories.html", transform: transformShell },
  { source: "homepage/home-b.html", out: "home-b.html", transform: transformShell },
  { source: "homepage/home-c.html", out: "home-c.html", transform: transformShell },
  { source: "legal.html", out: "privacy.html", transform: transformPrivacy },
];

const sources = [...new Set(pages.map((page) => page.source))].filter((source) =>
  fs.existsSync(path.join(exportRoot, source)),
);
console.log(`zasoby: skopiowano ${copyAssets(sources)} plików`);

const summary = [];
for (const page of pages) {
  if (!fs.existsSync(path.join(exportRoot, page.source))) continue;
  const result = buildPage(page.source, page.out, { transform: page.transform });
  summary.push(result);
  const leftovers = [...result.stats.untouched].filter((t) => /[A-Za-z]{3}/.test(t));
  console.log(`${page.out}: podmieniono ${result.stats.used.size}, bez mapy ${leftovers.length}`);
  for (const text of leftovers.slice(0, 40)) console.log(`   ? ${text}`);
}

/**
 * Drugi przebieg: skoro wynikowy HTML jest źródłem prawdy o użyciu, usuwamy
 * zasoby, do których nic nie prowadzi (odrzucone warianty srcset, wideo ponad
 * limit, obrazy sekcji wyciętych jako fabrykowany dowód).
 */
const renderedHtml = fs
  .readdirSync(outDir)
  .filter((file) => file.endsWith(".html"))
  .map((file) => fs.readFileSync(path.join(outDir, file), "utf8"))
  .join("\n");

let pruned = 0;
for (const dir of ["images", "videos"]) {
  const base = path.join(publicRoot, dir);
  for (const file of fs.readdirSync(base)) {
    if (renderedHtml.includes(`/forerunner/${dir}/${file}`)) continue;
    fs.rmSync(path.join(base, file));
    pruned += 1;
  }
}
console.log(`zasoby: usunięto ${pruned} sierot`);

fs.writeFileSync(
  path.join(outDir, "pages.json"),
  `${JSON.stringify(
    Object.fromEntries(summary.map((s) => [s.outFile.replace(".html", ""), { wfPage: s.wfPage }])),
    null,
    2,
  )}\n`,
  "utf8",
);
