/**
 * Bramki przeniesionego szablonu (ADR-068).
 *
 * Pilnują trzech rzeczy, które łatwo zepsuć niechcący: izolacji warstw
 * wizualnych między marketingiem a sklepami najemców, kompletności treści
 * (żaden token nie może dojechać do przeglądarki) i braku fabrykowanego
 * dowodu społecznego, który szablon niesie w standardzie.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PUBLIC_PAGES, TEMPLATE_ROUTES } from "@/lib/marketing/template";

import pages from "../marketing/pages.json";
import en from "../messages/en.json";
import pl from "../messages/pl.json";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const marketingPages = readdirSync(path.join(root, "marketing")).filter((file) =>
  file.endsWith(".html"),
);

// Każde miejsce, które może wskazywać na zasób szablonu: strony marketingu,
// komponenty osi publicznej (np. favicon w <head> layoutu) i słowniki tłumaczeń.
// Jeden zbiór karmi obie bramki spójności — sieroty (plik bez odwołania) oraz
// martwe odwołania (odwołanie bez pliku).
const referenceSources = (): Array<[string, string]> => {
  const sources: Array<[string, string]> = [];
  for (const file of marketingPages) sources.push([`marketing/${file}`, read(`marketing/${file}`)]);
  for (const entry of readdirSync(path.join(root, "app"), { recursive: true }) as string[]) {
    if (entry.endsWith(".tsx")) sources.push([`app/${entry}`, read(`app/${entry}`)]);
  }
  for (const file of readdirSync(path.join(root, "messages"))) {
    if (file.endsWith(".json")) sources.push([`messages/${file}`, read(`messages/${file}`)]);
  }
  return sources;
};

describe("izolacja warstw wizualnych", () => {
  it("oś marketingowa ładuje wyłącznie arkusze szablonu", () => {
    const layout = read("app/[locale]/layout.tsx");

    expect(layout).toContain("/forerunner/css/normalize.css");
    expect(layout).toContain("/forerunner/css/webflow.css");
    expect(layout).toContain("/forerunner/css/forerunner-template.webflow.css");
    // Tailwind i design system Fazy 2 NIE mogą wejść na marketing — inaczej
    // preflight rozjeżdża szablon, a tokeny mieszają dwa systemy naraz.
    expect(layout).not.toMatch(/import\s+["'][^"']*globals\.css/);
    expect(layout).not.toMatch(/from\s+["']@avably\/ui["']/);
    expect(layout).not.toContain("fontVariables");

  });

  it("sklep najemcy zostaje na tokenach Fazy 2 i Geist Sans", () => {
    const tenantLayout = read("app/(tenant)/layout.tsx");
    const fonts = read("app/fonts.ts");

    expect(tenantLayout).toContain("globals.css");
    expect(tenantLayout).toContain("fontVariables");
    // Sekcja 08 artefaktu Fazy 2 obowiązuje tam, gdzie mieszka produkt.
    expect(fonts).toContain('variable: "--font-geist-sans"');
    expect(fonts).not.toMatch(/Geist_Mono|Lora|Safiro|\bInter\b/);
    // Żaden arkusz ani font szablonu nie może dotrzeć do sklepów najemców.
    expect(tenantLayout).not.toContain("/forerunner/");
    expect(read("app/globals.css")).not.toContain("/forerunner/");
  });

  it("żaden plik osi tenanckiej nie sięga po zasoby szablonu", () => {
    const tenantFiles = [
      "app/(tenant)/store/page.tsx",
      "app/(tenant)/cart/page.tsx",
      "app/(tenant)/checkout/page.tsx",
      "components/storefront/page-shell.tsx",
      "components/storefront/store-header.tsx",
    ];
    for (const file of tenantFiles) {
      expect(read(file), file).not.toContain("forerunner");
    }
  });
});

describe("treść przeniesionych stron", () => {
  it("każdy token szablonu ma pokrycie w obu locale", async () => {
    const { marketingLinks, renderMarketingPage } = await import("@/lib/marketing/template");

    for (const file of marketingPages) {
      const page = file.replace(".html", "") as Parameters<typeof renderMarketingPage>[0];
      for (const [locale, messages] of [
        ["en", en],
        ["pl", pl],
      ] as const) {
        const html = renderMarketingPage(page, {
          ...messages.marketing,
          form: messages.landing.form,
          ...marketingLinks(locale),
        });
        expect(html, `${file} / ${locale}`).not.toMatch(/\{\{[a-zA-Z0-9_.]+\}\}/);
      }
    }
  });

  it("nie zostawia nazw ani sprzedaży szablonu", () => {
    for (const file of marketingPages) {
      const html = read(path.join("marketing", file));
      for (const forbidden of ["Forerunner", "BYQ", "Webflow Template", "Buy Template", "byq.studio"]) {
        expect(html, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("wycina fabrykowany dowód społeczny ze stron publicznych", () => {
    const home = read("marketing/home.html");
    // Pas logotypów klientów, slider opinii i karty z cytatami — szablon niesie
    // je jako wypełniacz; my nie mamy klientów, o których wolno tak mówić.
    for (const marker of [
      "home-a-logo-section",
      "home-a-slider-section",
      "hero-testimonial-box",
      "testimonial-block-small",
      "Jessica Mercedes",
      "Andrew Duna",
    ]) {
      expect(home, marker).not.toContain(marker);
    }
  });

  /**
   * DOWÓD SPOŁECZNY BYWA W OBRAZKU, NIE W TEKŚCIE. Bramka wyżej czyta same
   * napisy i dlatego przepuściła dwie rzeczy, które widać dopiero na zrzucie:
   * odznakę „featured designer" z szablonu (cudza marka wypalona w SVG) oraz
   * stockowe ujęcie osoby użyte pod cytatem podpisanym imieniem założyciela
   * — czyli obcą twarz przedstawioną jako nasza. Ta bramka patrzy na ZASOBY.
   */
  it("nie wraca cudza marka ani obca twarz w roli naszej", () => {
    for (const file of marketingPages) {
      const html = read(path.join("marketing", file));

      for (const zasob of ["Featured-SVG", "featured-designed-image", "Compnay-logo"]) {
        expect(html, `${file} wciąż osadza ${zasob}`).not.toContain(zasob);
      }
    }

    // Cytat założyciela zostaje (jest prawdziwy), ale nie wolno mu jechać na
    // ujęciu przypadkowej osoby — sekcja stoi dziś na materiale bez ludzi.
    const home = read("marketing/home.html");
    expect(home).toContain("{{video.authorName}}");
    expect(
      home,
      "sekcja cytatu wróciła na stockowe ujęcie osoby",
    ).not.toContain("576889ea7aa0897a362ad036dd02de93c9247cd3");
  });

  /**
   * KONTRAST NA KARTACH CIEMNYCH. `.pricing-card.last-plan` ustawia tło na
   * `color--dark`, a `.text-dark-64` ustawia kolor tekstu na TĘ SAMĄ wartość
   * — tekst znika przy kontraście 1:1. Wersja przed tą bramką pokazywała
   * kartę Premium bez ani jednej funkcji i nikt tego nie zauważył, bo treść
   * BYŁA w DOM, testy tokenów świeciły na zielono, a plamę widać wyłącznie
   * na zrzucie. Klasy jasne (`text-light-*`) to jedyne, które wolno tam wpuścić.
   */
  it("na ciemnych kartach nie ląduje tekst w kolorze tła", () => {
    for (const file of marketingPages) {
      const html = read(path.join("marketing", file));

      for (const match of html.matchAll(/<div class="pricing-card last-plan">([\s\S]*?)\n<\/div>/g)) {
        expect(
          match[1],
          `${file}: karta ciemna używa klasy ciemnego tekstu (znika na tle)`,
        ).not.toMatch(/class="text-dark-\d+"/);
      }
    }
  });

  /**
   * DWIE PUBLICZNE STRONY NIE MOGĄ BYĆ SWOJĄ KOPIĄ. `/contact` renderowało
   * nagłówek i lead listy oczekujących („Zostaw adres, jeśli wolisz
   * poczekać"), więc pozycja „Kontakt" w nawigacji prowadziła do duplikatu
   * `/waitlist` — z tą różnicą, że bez formularza. Klucze `contactPage.*`
   * istniały w treści i nie były podstawiane NIGDZIE, a bramka pokrycia
   * tokenów tego nie widzi: ona pilnuje, żeby każdy TOKEN miał treść, nie
   * żeby każda TREŚĆ miała token.
   */
  it("kontakt i lista oczekujących to dwie różne strony, nie jedna w dwóch adresach", () => {
    const contact = read("marketing/contact.html");
    const waitlist = read("marketing/waitlist.html");

    expect(contact).toContain("{{contactPage.title}}");
    expect(contact).toContain("{{contactPage.intro}}");
    expect(contact, "kontakt niesie nagłówek listy oczekujących").not.toContain(
      "{{waitlistPage.title}}",
    );
    expect(waitlist).toContain("{{waitlistPage.title}}");

    for (const messages of [pl, en]) {
      expect(messages.marketing.contactPage.title).not.toBe(messages.marketing.waitlistPage.title);
    }
  });

  it("kieruje CTA do rejestracji, a listę oczekujących trzyma jako drugą drogę", () => {
    const home = read("marketing/home.html");
    const registerLinks = home.match(/\{\{link\.register\}\}/g) ?? [];
    expect(registerLinks.length).toBeGreaterThanOrEqual(4);
    expect(home).toContain("{{link.waitlist}}");
    expect(home).not.toContain("webflow.com/templates");
  });

  /**
   * Cennik jest DECYZJĄ WŁAŚCICIELA (wariant B, 2026-08-08), nie propozycją
   * copywritera: Standard 199 / Premium 399 zł netto/msc, trial 14 dni bez
   * karty, rok w cenie 10 miesięcy, ZERO founders. Kwota zmieniona w treści
   * bez zmiany decyzji to zmiana ceny produktu po cichu — stąd bramka.
   */
  it("trzyma cennik zgodny z decyzją właściciela (wariant B, zero founders)", () => {
    expect(pl.marketing.pricingPage.standardPrice).toContain("199 zł");
    expect(pl.marketing.pricingPage.premiumPrice).toContain("399 zł");
    expect(en.marketing.pricingPage.standardPrice).toContain("PLN 199");
    expect(en.marketing.pricingPage.premiumPrice).toContain("PLN 399");

    // Netto musi paść wprost — inaczej 199 czyta się jak cena brutto.
    expect(pl.marketing.pricingPage.standardPrice).toMatch(/netto/i);
    expect(pl.marketing.pricingPage.intro).toMatch(/netto/i);
    expect(en.marketing.pricingPage.intro).toMatch(/\bnet\b/i);

    // Rocznie = rok w cenie 10 miesięcy (1 990 / 3 990), a nie rabat procentowy.
    expect(pl.marketing.pricingPage.standardYearly).toContain("1 990");
    expect(pl.marketing.pricingPage.premiumYearly).toContain("3 990");
    expect(en.marketing.pricingPage.standardYearly).toContain("1,990");

    // Trial 14 dni BEZ KARTY — obie wersje językowe, na banerze i na cenniku.
    for (const [name, text] of [
      ["pl.banner", pl.marketing.banner.text],
      ["en.banner", en.marketing.banner.text],
      ["pl.intro", pl.marketing.pricingPage.intro],
      ["en.intro", en.marketing.pricingPage.intro],
    ] as const) {
      expect(text, name).toMatch(/14/);
      expect(text, `${name}: trial musi być opisany jako bez karty`).toMatch(
        /bez karty|no card/i,
      );
    }

    // Cena founders została WYCOFANA decyzją właściciela — żaden ślad nie
    // może wrócić do treści (ani kwota, ani obietnica limitowanych miejsc).
    const wszystkieTeksty = JSON.stringify([pl.marketing, en.marketing]);
    for (const wycofane of ["99,50", "99.50", "founders", "Founders"]) {
      expect(wszystkieTeksty, `treść wciąż zna wycofane „${wycofane}"`).not.toContain(wycofane);
    }
  });

  /**
   * GRANICA OBIETNIC (docs/sprzedaz/avably-stan-produktu.md): sprzedajemy
   * wyłącznie to, co działa. Funkcje w budowie wolno pokazywać — ale zawsze
   * oznaczone, nigdy jako część oferty Standardu.
   */
  it("nie obiecuje ponad stan produktu", () => {
    // BLIK/Przelewy24 nie istnieją — gdziekolwiek padną, padają jako budowane.
    for (const [name, text] of [
      ["pl.faq.a1", pl.marketing.faq.a1],
      ["pl.features.card2Body", pl.marketing.features.card2Body],
      ["pl.pricing.s3", pl.marketing.pricingPage.s3],
    ] as const) {
      if (/BLIK/.test(text)) expect(text, name).toMatch(/w budowie/i);
    }
    for (const [name, text] of [
      ["en.faq.a1", en.marketing.faq.a1],
      ["en.features.card2Body", en.marketing.features.card2Body],
      ["en.pricing.s3", en.marketing.pricingPage.s3],
    ] as const) {
      if (/BLIK/.test(text)) expect(text, name).toMatch(/being built/i);
    }

    // Premium jest zapowiedzią, nie sprzedażą — musi nieść własne oznaczenie.
    expect(pl.marketing.pricingPage.premiumBadge).toMatch(/wkrótce/i);
    expect(en.marketing.pricingPage.premiumBadge).toMatch(/coming soon/i);
    expect(pl.marketing.pricingPage.premiumNote).toMatch(/dat nie podajemy|nie sprzedajemy/i);

    // Zero certyfikacji, których nie mamy — sekcja bezpieczeństwa mówi to wprost.
    for (const [name, note] of [
      ["pl", pl.marketing.security.note],
      ["en", en.marketing.security.note],
    ] as const) {
      expect(note, `${name}: brak zastrzeżenia o certyfikacjach`).toMatch(
        /certyfikac|certification/i,
      );
    }
    const wszystko = JSON.stringify([pl.marketing, en.marketing]);
    for (const nieprawda of ["ISO 27001", "SOC 2", "SOC2", "PCI DSS"]) {
      expect(wszystko, `treść obiecuje ${nieprawda}`).not.toContain(nieprawda);
    }
  });

  /**
   * Sekcja bezpieczeństwo/zgodność ma opisywać STAN FAKTYCZNY. Każdy filar
   * jest tu przypięty do miejsca w kodzie, które go realizuje — jeśli ten
   * mechanizm kiedyś zniknie, zniknie też prawo do zdania na stronie.
   */
  it("sekcja bezpieczeństwa opisuje mechanizmy, które naprawdę stoją w kodzie", () => {
    const proxySource = read("proxy.ts");
    const securityPl = Object.values(pl.marketing.security).join(" ");
    const securityEn = Object.values(en.marketing.security).join(" ");

    // Izolacja per organizacja: RLS + testy w CI.
    expect(securityPl).toMatch(/Row Level Security/i);
    expect(securityEn).toMatch(/Row Level Security/i);

    // CSP z nonce — deklaracja pokryta gałęzią middleware'u.
    expect(securityPl).toMatch(/Content-Security-Policy/);
    expect(proxySource, "obiecujemy CSP z nonce, a proxy go nie buduje").toContain("buildCsp");

    // security.txt (RFC 9116) — trasa istnieje i odpowiada treścią.
    expect(securityPl).toMatch(/security\.txt/);
    expect(securityPl).toMatch(/RFC 9116/);
    expect(() => read("app/.well-known/security.txt/route.ts")).not.toThrow();

    // Hosting UE i szyfrowanie sekretów integracji.
    expect(securityPl).toMatch(/Uni[ei] Europejskiej|UE/);
    expect(securityEn).toMatch(/European Union|EU/);
    expect(securityPl).toMatch(/szyfrowan/i);
  });
});

describe("spójność tras i zasobów", () => {
  const routes = new Set<string>([
    "",
    ...PUBLIC_PAGES.filter((page) => page !== "home"),
    ...TEMPLATE_ROUTES,
  ]);

  /**
   * WARIANTY PRZEGLĄDOWE (ADR-128, checklista I-03). Do odsłonięcia LP obok
   * stron publicznych żyło osiem wariantów układu (home-b/c, about + about-b/c,
   * contact-b/c, stories) — strony bez własnej treści, z nazwą szablonu
   * w środku, osiągalne pod publicznym `[page]`. Wybór układu jest dokonany,
   * więc warianty zniknęły z repo: nie ma trybu, który dałoby się przypadkiem
   * włączyć na produkcji, bo nie ma czego włączać.
   *
   * Bramka patrzy na TRZY warstwy naraz, bo każda z osobna daje się obejść:
   * lista tras (routing), zbiór plików (treść) i mapa `pages.json` (identyfikatory).
   */
  it("nie ma już wariantów przeglądowych — ani trasy, ani pliku, ani wpisu", () => {
    const warianty = ["home-b", "home-c", "about", "about-b", "about-c", "contact-b", "contact-c", "stories"];

    for (const wariant of warianty) {
      expect([...routes], `trasa ${wariant} wciąż istnieje`).not.toContain(wariant);
      expect(marketingPages, `plik ${wariant}.html wciąż leży w repo`).not.toContain(`${wariant}.html`);
      expect(
        Object.keys(pages),
        `pages.json wciąż zna ${wariant}`,
      ).not.toContain(wariant);
    }

    // Segment `[page]` obsługuje WYŁĄCZNIE trasy publiczne — gdyby ktoś
    // dopisał wariant do TEMPLATE_ROUTES, wróciłby publicznie osiągalny.
    for (const route of TEMPLATE_ROUTES) {
      expect(PUBLIC_PAGES, `${route} jest w TEMPLATE_ROUTES, ale nie jest stroną publiczną`).toContain(
        route,
      );
    }

    // Osobna trasa trybu przeglądu też zniknęła (nie została „na chwilę").
    expect(
      existsSync(path.join(root, "app/[locale]/przeglad")),
      "trasa przeglad/ wciąż istnieje",
    ).toBe(false);
  });

  it("żaden link w przeniesionych stronach nie prowadzi w pustkę", () => {
    const offenders: string[] = [];
    for (const file of marketingPages) {
      const html = read(path.join("marketing", file));
      for (const match of html.matchAll(/href="([^"]+)"/g)) {
        const href = match[1];
        if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
        // Adresy panelu i języka są tokenami rozwijanymi w runtime.
        if (/^\{\{link\.(register|login|langAlternate)\}\}$/.test(href)) continue;
        const token = href.match(/^\{\{link\.([a-zA-Z]+)\}\}$/);
        if (token) {
          const page = token[1]
            .replace(/^home$/, "")
            .replace(/([a-z])([A-Z])/g, "$1-$2")
            .toLowerCase();
          if (!routes.has(page)) offenders.push(`${file}: ${href}`);
          continue;
        }
        offenders.push(`${file}: ${href}`);
      }
    }
    expect(offenders, offenders.slice(0, 10).join(" | ")).toEqual([]);
  });

  it("nie trzyma zasobów, których żadna strona nie używa", () => {
    const referenced = referenceSources()
      .map(([, text]) => text)
      .join("\n");
    const orphans: string[] = [];
    for (const dir of ["images", "videos"]) {
      const base = path.join(root, "public/forerunner", dir);
      for (const file of readdirSync(base)) {
        if (!referenced.includes(`/forerunner/${dir}/${file}`)) orphans.push(`${dir}/${file}`);
      }
    }
    expect(orphans, orphans.slice(0, 10).join(" | ")).toEqual([]);
  });

  it("nie odwołuje się do zasobu, którego nie ma na dysku", () => {
    // Kierunek odwrotny do sieroty: każde odwołanie /forerunner/** i /produkt/**
    // w stronach, komponentach i słownikach musi trafiać w istniejący plik.
    // Tu ginął favicon szablonu — deklarowany w <head>, nieobecny na dysku (404).
    const reference = /\/(?:forerunner|produkt)\/[A-Za-z0-9._\-/]+/g;
    const dead: string[] = [];
    for (const [name, text] of referenceSources()) {
      for (const match of text.matchAll(reference)) {
        const ref = match[0];
        if (!existsSync(path.join(root, "public", ref))) dead.push(`${name}: ${ref}`);
      }
    }
    const unique = [...new Set(dead)];
    expect(unique, unique.slice(0, 10).join(" | ")).toEqual([]);
  });

  it("trzyma wagę pojedynczego zasobu w ryzach", () => {
    const heavy: string[] = [];
    for (const dir of ["images", "videos"]) {
      const base = path.join(root, "public/forerunner", dir);
      for (const file of readdirSync(base)) {
        const { size } = statSync(path.join(base, file));
        if (size > 5 * 1024 * 1024) heavy.push(`${dir}/${file} = ${Math.round(size / 1e6)} MB`);
      }
    }
    expect(heavy, heavy.join(" | ")).toEqual([]);
  });
});

describe("kontrakt dostępności formularza", () => {
  it("zachowuje przenoszenie fokusu na wynik i opisy pól", () => {
    const form = read("components/waitlist-form.tsx");
    expect(form).toContain("resultFocusArmedRef.current = true");
    expect(form).toContain("if (!resultFocusArmedRef.current");
    expect(form).toContain('aria-describedby="waitlist-email-help waitlist-email-error"');
    expect(form).toContain('aria-describedby="waitlist-consent-help waitlist-consent-error"');
    // Formularz jedzie na klasach szablonu, nie na Tailwindzie.
    expect(form).toContain("text-field w-input");
    expect(form).not.toMatch(/className="[^"]*\b(?:mt-|px-|grid|flex-col)\b/);
  });
});
