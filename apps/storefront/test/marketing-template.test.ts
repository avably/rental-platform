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

import { SAAS_PLAN_PRICING, SAAS_TRIAL_DAYS } from "@avably/core";
import { describe, expect, it } from "vitest";

import { PUBLIC_PAGES, TEMPLATE_ROUTES } from "@/lib/marketing/template";

import pages from "../marketing/pages.json";
import en from "../messages/en.json";
import pl from "../messages/pl.json";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
/**
 * Bramki patrzące na MARKUP muszą najpierw zdjąć komentarze. Inaczej zdanie
 * w komentarzu („<video> nie dostaje atrybutu poster") jest dla wyrażenia
 * regularnego nieodróżnialne od elementu — i bramka pada na własnej
 * dokumentacji zamiast na kodzie.
 */
const bezKomentarzy = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");
const marketingPages = readdirSync(path.join(root, "marketing")).filter((file) =>
  file.endsWith(".html"),
);

/**
 * Katalogi zasobów strony marketingowej wraz z sufitem wagi POJEDYNCZEGO pliku.
 *
 * `public/forerunner/videos` MOŻE NIE ISTNIEĆ: wideo z szablonu (bonsai, ~2,8 MB
 * na wejście) zniknęło razem z ostatnim odwołaniem do niego (A2, ADR-128),
 * a pustego katalogu git nie przechowuje. Brak katalogu NIE jest awarią —
 * awarią jest plik, którego nikt nie używa, i plik za ciężki na stronę główną.
 *
 * Sufit dla `public/produkt` jest DZIESIĘĆ RAZY niższy niż dla zasobów szablonu,
 * bo te pliki wchodzą na ścieżkę pierwszego ekranu: zrzut interfejsu zapisany
 * bez kompresji potrafi ważyć więcej niż cała reszta strony razem wzięta.
 */
const ASSET_DIRS = [
  { dir: "public/forerunner/images", prefix: "/forerunner/images", limit: 5 * 1024 * 1024 },
  { dir: "public/forerunner/videos", prefix: "/forerunner/videos", limit: 5 * 1024 * 1024 },
  { dir: "public/produkt/pl", prefix: "/produkt/pl", limit: 150 * 1024 },
  { dir: "public/produkt/en", prefix: "/produkt/en", limit: 150 * 1024 },
  // LP 2.0: fotografia stockowa i wideo hero. Bez tego wpisu katalog wypadał
  // i z bramki wagi, i z bramki sieroctwa — wideo mogłoby urosnąć do 4 MB
  // i przejść bez mrugnięcia. Sufit pojedynczego pliku jest sufitem WIDEO;
  // obrazy mają własny, wielokrotnie niższy, w bramce niżej.
  // 2026-08-11: 480 kB → 1050 kB ŚWIADOMIE. Pętla cyklu wynajmu (zestaw B)
  // trwa 14,5 s wobec 6 s magazynu; najcięższy jest fallback H.264 (990 kB),
  // którego nie da się docisnąć bez widocznej degradacji. Przeglądarka pobiera
  // JEDEN kodek: nowoczesne biorą AV1 (677 kB), H.264 schodzi tylko tam,
  // gdzie AV1/VP9 nie grają. Margines wąski celowo — kolejny wzrost ma boleć.
  { dir: "public/marketing", prefix: "/marketing", limit: 1050 * 1024 },
  // SKRYPTY SZABLONU (spike webflow.js, krok 1). `webflow.js` żyje w repo
  // jako minifikat esbuild (1546 kB raw → ~350 kB na drucie); oryginalny
  // eksport szablonu waży 5,5 MB raw i wraca jednym niewinnym „przywróćmy
  // plik z eksportu". Sufit leży TUŻ nad minifikatem — podmiana na wersję
  // niezminifikowaną (albo doklejenie kolejnej biblioteki) ma palić build,
  // nie przechodzić recenzję na oko.
  { dir: "public/forerunner/js", prefix: "/forerunner/js", limit: 1600 * 1024 },
];

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
   * KONTAKT NIESIE WŁASNĄ TREŚĆ. Historycznie `/contact` renderował nagłówek
   * listy oczekujących, a dane firmy (e-mail, adres) jechały na kluczach
   * `waitlistPage.*` — po zdjęciu waitlisty te dane przeszły pod
   * `contactPage.*`. Bramka pokrycia tokenów tego nie widzi: ona pilnuje,
   * żeby każdy TOKEN miał treść, nie żeby każda TREŚĆ miała token.
   */
  it("kontakt niesie własny nagłówek i dane firmy z kluczy contactPage", () => {
    const contact = read("marketing/contact.html");

    for (const token of [
      "{{contactPage.title}}",
      "{{contactPage.intro}}",
      "{{contactPage.email}}",
      "{{contactPage.addressLine1}}",
    ]) {
      expect(contact, `kontakt zgubił ${token}`).toContain(token);
    }
  });

  /**
   * LISTA OCZEKUJĄCYCH ZNIKŁA W CAŁOŚCI (decyzja właściciela 2026-08-12):
   * LP prowadzi wprost do samodzielnej rejestracji panelu. Każde CTA, które
   * kiedyś zbierało adresy, prowadzi teraz do `{{link.register}}`, a treść
   * nie zna ani listy oczekujących, ani jej kluczy. Backend zapisu
   * (app.join_waitlist) został zdjęty migracją 0071 (revoke + DROP);
   * nieobecności RPC pilnuje packages/db/test/waitlist-decommission.test.ts.
   */
  it("kieruje każde CTA do rejestracji — lista oczekujących zniknęła z treści", () => {
    for (const file of marketingPages) {
      const html = read(path.join("marketing", file));
      expect(html, `${file} wciąż linkuje listę oczekujących`).not.toContain("{{link.waitlist}}");
      expect(html, `${file} wciąż zna klucze waitlisty`).not.toMatch(/\{\{[a-zA-Z0-9_.]*waitlist/i);
      expect(html).not.toContain("webflow.com/templates");
    }

    const home = read("marketing/home.html");
    const registerLinks = home.match(/\{\{link\.register\}\}/g) ?? [];
    expect(registerLinks.length).toBeGreaterThanOrEqual(6);

    // Treść marketingowa bez śladu listy oczekujących — w OBU locale.
    for (const [name, messages] of [
      ["pl", pl],
      ["en", en],
    ] as const) {
      expect(
        JSON.stringify(messages.marketing),
        `${name}: treść marketingowa wciąż zna listę oczekujących`,
      ).not.toMatch(/waitlist|oczekując/i);
    }
  });

  /**
   * Cennik jest DECYZJĄ WŁAŚCICIELA (wariant B, 2026-08-08) i ma JEDNO
   * źródło: `SAAS_PLAN_PRICING` w @avably/core (ADR-135) — kwoty w tej bramce
   * są z niego POLICZONE, nie wpisane, więc zmiana stałej bez zmiany treści
   * (i odwrotnie) pali test. Ta bramka pilnuje PREZENTACJI ceny na cenniku:
   * waluta przy właściwym planie, „netto" wprost, grupowanie tysięcy per
   * locale. Zupełność — każde wystąpienie każdej kwoty w OBU plikach treści,
   * z przynętą na kwoty dopisane bez pokrycia — pilnuje dwukierunkowo
   * saas-pricing-parity.test.ts.
   */
  it("trzyma cennik zgodny z decyzją właściciela (wariant B, zero founders)", () => {
    const cennik = Object.fromEntries(SAAS_PLAN_PRICING.map((plan) => [plan.id, plan]));
    const zlote = (grosze: number) => grosze / 100;
    // PL grupuje tysiące spacją („1 990"), EN przecinkiem („1,990").
    const grupuj = (kwota: number, separator: string) =>
      String(kwota).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
    const standardMies = zlote(cennik.standard.monthlyNetGrosze);
    const premiumMies = zlote(cennik.premium.monthlyNetGrosze);

    expect(pl.marketing.pricingPage.standardPrice).toContain(`${grupuj(standardMies, " ")} zł`);
    expect(pl.marketing.pricingPage.premiumPrice).toContain(`${grupuj(premiumMies, " ")} zł`);
    expect(en.marketing.pricingPage.standardPrice).toContain(`PLN ${grupuj(standardMies, ",")}`);
    expect(en.marketing.pricingPage.premiumPrice).toContain(`PLN ${grupuj(premiumMies, ",")}`);

    // Netto musi paść wprost — inaczej 199 czyta się jak cena brutto.
    expect(pl.marketing.pricingPage.standardPrice).toMatch(/netto/i);
    expect(pl.marketing.pricingPage.intro).toMatch(/netto/i);
    expect(en.marketing.pricingPage.intro).toMatch(/\bnet\b/i);

    // Rocznie = rok w cenie 10 miesięcy (1 990 / 3 990), a nie rabat procentowy.
    expect(pl.marketing.pricingPage.standardYearly).toContain(
      grupuj(zlote(cennik.standard.yearlyNetGrosze), " "),
    );
    expect(pl.marketing.pricingPage.premiumYearly).toContain(
      grupuj(zlote(cennik.premium.yearlyNetGrosze), " "),
    );
    expect(en.marketing.pricingPage.standardYearly).toContain(
      grupuj(zlote(cennik.standard.yearlyNetGrosze), ","),
    );

    // Trial BEZ KARTY — obie wersje językowe, na banerze i na cenniku.
    // Długość ze stałej (SAAS_TRIAL_DAYS, ADR-135) — pełny parytet
    // dwukierunkowy pilnuje saas-trial-days-parity.test.ts.
    for (const [name, text] of [
      ["pl.banner", pl.marketing.banner.text],
      ["en.banner", en.marketing.banner.text],
      ["pl.intro", pl.marketing.pricingPage.intro],
      ["en.intro", en.marketing.pricingPage.intro],
    ] as const) {
      expect(text, name).toContain(String(SAAS_TRIAL_DAYS));
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
    // `waitlist` dopisany tym samym trybem: strona zniknęła razem z listą
    // oczekujących (decyzja właściciela 2026-08-12) i nie ma prawa wrócić
    // ani trasą, ani plikiem, ani wpisem w pages.json.
    const warianty = ["home-b", "home-c", "about", "about-b", "about-c", "contact-b", "contact-c", "stories", "waitlist"];

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
    // Zrzuty interfejsu wchodzą na stronę PRZEZ TREŚĆ (klucze `marketing.shots`
    // w messages/*.json), a nie literałem w HTML — inaczej nie dałoby się mieć
    // osobnego kadru dla wersji polskiej i angielskiej. Zbiór „użyte" musi więc
    // obejmować oba źródła, bo inaczej ta bramka uznałaby każdy zrzut za sierotę.
    // Trzecie źródło to komponenty osi publicznej (favicon w <head> layoutu).
    // Bez nich ta bramka uznałaby favicon za sierotę, a bramka odwrotna nie
    // zauważyłaby jego zniknięcia — oba kierunki MUSZĄ karmić się tym samym
    // zbiorem źródeł, inaczej jeden zaczyna kłamać o drugim.
    const komponentyTsx = (readdirSync(path.join(root, "app"), { recursive: true }) as string[])
      .filter((entry) => entry.endsWith(".tsx"))
      .map((entry) => read(path.join("app", entry)));
    const uzyte = [
      ...marketingPages.map((file) => read(path.join("marketing", file))),
      ...komponentyTsx,
      JSON.stringify(pl),
      JSON.stringify(en),
    ].join("\n");
    const orphans: string[] = [];
    for (const { dir, prefix } of ASSET_DIRS) {
      const base = path.join(root, dir);
      if (!existsSync(base)) continue;
      for (const file of readdirSync(base)) {
        if (!uzyte.includes(`${prefix}/${file}`)) orphans.push(`${prefix}/${file}`);
      }
    }
    expect(orphans, orphans.slice(0, 10).join(" | ")).toEqual([]);
  });

  /**
   * MARTWE ODWOŁANIE DO PLIKU. Bramka sieroctwa patrzy w jedną stronę: czy
   * każdy PLIK ma odwołanie. Nie widzi odwrotności — literówki w `src`, pliku
   * przeniesionego albo zapomnianego przy commicie. Taki obraz nie rzuca
   * błędu, tylko cicho nie wchodzi: zostaje pusta ramka i tekst alternatywny.
   * Ta bramka idzie w drugą stronę: każdy lokalny `src`/`srcset`/`poster`
   * w przeniesionych stronach musi wskazywać plik, który naprawdę leży w `public/`.
   */
  it("żadne odwołanie do pliku w przeniesionych stronach nie wisi w próżni", () => {
    const brakujace: string[] = [];
    for (const file of marketingPages) {
      const html = bezKomentarzy(read(path.join("marketing", file)));
      const sciezki = new Set<string>();
      for (const match of html.matchAll(/(?:src|poster)="(\/[^"{}]+)"/g)) sciezki.add(match[1]);
      for (const match of html.matchAll(/srcset="([^"]+)"/g)) {
        for (const kandydat of match[1].split(",")) {
          const url = kandydat.trim().split(/\s+/)[0];
          if (url.startsWith("/")) sciezki.add(url);
        }
      }
      for (const sciezka of sciezki) {
        if (!existsSync(path.join(root, "public", sciezka.replace(/^\//, "")))) {
          brakujace.push(`${file}: ${sciezka}`);
        }
      }
    }
    // Komponenty osi publicznej też wskazują zasoby. Favicon w <head> layoutu żył
    // jako martwe odwołanie właśnie dlatego, że bramka czytała wyłącznie szablony
    // HTML — naprawione osobnym PR-em i utrzymane tutaj przy scalaniu gałęzi.
    const komponenty = (readdirSync(path.join(root, "app"), { recursive: true }) as string[]).filter(
      (entry) => entry.endsWith(".tsx"),
    );
    for (const entry of komponenty) {
      const zrodlo = read(path.join("app", entry));
      const wzorzec = /(?:href|src|poster)="(\/(?:forerunner|produkt|marketing)\/[^"]+)"/g;
      for (const match of zrodlo.matchAll(wzorzec)) {
        if (!existsSync(path.join(root, "public", match[1].replace(/^\//, "")))) {
          brakujace.push(`app/${entry}: ${match[1]}`);
        }
      }
    }

    // Zrzuty interfejsu wchodzą przez treść, nie literałem — sprawdzamy je z JSON-a.
    for (const [locale, messages] of [
      ["pl", pl],
      ["en", en],
    ] as const) {
      for (const [klucz, wartosc] of Object.entries(messages.marketing.shots)) {
        if (typeof wartosc !== "string" || !wartosc.startsWith("/")) continue;
        if (!existsSync(path.join(root, "public", wartosc.replace(/^\//, "")))) {
          brakujace.push(`${locale}/shots.${klucz}: ${wartosc}`);
        }
      }
    }
    expect(brakujace, brakujace.join(" | ")).toEqual([]);
  });

  /**
   * TEKST ALTERNATYWNY BIERZE SIĘ Z TREŚCI, NIE Z HTML-a. Każdy `<img>` na osi
   * marketingowej ma `alt` podstawiany per locale — inaczej polska i angielska
   * wersja opisywałyby ten sam obraz tym samym zdaniem po polsku. Wyjątkiem są
   * elementy czysto dekoracyjne (logo z własną nazwą, siatka kropek), które
   * mają `alt` pusty albo dosłowny. Bramka pilnuje, żeby nowy obraz nie wszedł
   * z `alt=""` „na chwilę".
   */
  it("każdy obraz treściowy niesie tekst alternatywny z i18n", () => {
    const bezOpisu: string[] = [];
    for (const file of marketingPages) {
      const html = bezKomentarzy(read(path.join("marketing", file)));
      for (const match of html.matchAll(/<img\b[^>]*>/g)) {
        const tag = match[0];
        const alt = tag.match(/\salt="([^"]*)"/);
        if (!alt) {
          bezOpisu.push(`${file}: <img> bez atrybutu alt`);
          continue;
        }
        // Dekoracja: pusty alt jest tu POPRAWNY (Dots.svg), logo niesie nazwę marki.
        if (alt[1] === "" || alt[1] === "Avably") continue;
        if (!/^\{\{[a-zA-Z0-9_.]+Alt\}\}$/.test(alt[1])) {
          bezOpisu.push(`${file}: alt="${alt[1]}" nie jest tokenem treści`);
        }
      }
    }
    expect(bezOpisu, bezOpisu.join(" | ")).toEqual([]);
  });

  /**
   * WIDEO HERO NIE MOŻE ZALEŻEĆ OD JAVASCRIPTU. `buildCsp` daje
   * `script-src 'self' 'nonce-…' 'strict-dynamic'`; przy `strict-dynamic`
   * przeglądarka ignoruje także `'self'`, więc liczy się wyłącznie nonce.
   * Statyczne `marketing/*.html` nonce'a nie dostaną nigdy — skrypt wstawiony
   * tam nie wykonałby się PO CICHU, razem z bramką ruchu, którą miałby nieść.
   * Stąd trzy warunki: zero `<script>` w tych plikach, atrybuty odtwarzania
   * na samym elemencie i bramka `prefers-reduced-motion` w arkuszu.
   */
  it("wideo hero odtwarza się bez skryptu, a bramka ruchu stoi w CSS", () => {
    for (const file of marketingPages) {
      expect(bezKomentarzy(read(path.join("marketing", file))), `${file} wstawia <script>`).not.toMatch(
        /<script\b/,
      );
    }

    const home = bezKomentarzy(read("marketing/home.html"));
    const video = home.match(/<video\b[^>]*>/)?.[0];
    expect(video, "home.html zgubiło element <video>").toBeTruthy();
    for (const atrybut of ["autoplay", "muted", "loop", "playsinline", 'preload="none"']) {
      expect(video, `<video> bez ${atrybut} nie odtworzy się bez skryptu`).toContain(atrybut);
    }

    // BRAMKA POBRANIA, nie tylko widoczności. `display: none` ukrywa element,
    // ale `autoplay` i tak uruchamia wybór zasobu — zmierzone w Chrome:
    // 211,7 kB wideo schodziło na telefon mimo ukrytego elementu. Dopiero
    // `media` na `<source>` daje transfer 0 B przy 375 px i przy „ogranicz ruch".
    const zrodla = [...home.matchAll(/<source\b[^>]*>/g)].map((m) => m[0]);
    expect(zrodla.length, "wideo hero bez żadnego <source>").toBeGreaterThanOrEqual(3);
    for (const zrodlo of zrodla) {
      expect(zrodlo, "<source> bez bramki min-width — telefon pobierze wideo").toContain(
        "(min-width: 1024px)",
      );
      expect(zrodlo, "<source> bez bramki ruchu — plik zejdzie mimo „ogranicz ruch”").toContain(
        "prefers-reduced-motion: no-preference",
      );
    }
    // Poster tylko raz: duplikat na `<video poster>` pobierał ten sam plik
    // drugi raz na telefonie, gdzie wideo i tak nie leci (+45,9 kB).
    expect(video, "<video> znowu ma własny poster — to drugi transfer tego samego pliku").not.toContain(
      "poster=",
    );

    const css = read("public/forerunner/css/avably-marketing.css");
    const bramka = css.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.hero-media-wideo\s*\{[^}]*\}/,
    );
    expect(
      bramka,
      "brak bramki prefers-reduced-motion dla wideo — deklaracja bez pokrycia",
    ).toBeTruthy();
    expect(bramka?.[0]).toMatch(/display:\s*none/);
  });

  /**
   * Suma katalogu, nie tylko pojedynczy plik: dziesięć plików po 400 kB
   * przechodzi bramkę „per plik" i topi stronę. Obrazy mają tu sufit
   * ośmiokrotnie niższy niż wideo, bo wchodzą na ścieżkę pierwszego ekranu.
   */
  it("katalog marketingowy nie rośnie po cichu", () => {
    const base = path.join(root, "public/marketing");
    if (!existsSync(base)) return;
    let obrazy = 0;
    let wideo = 0;
    const zaciezkie: string[] = [];
    for (const file of readdirSync(base)) {
      const { size } = statSync(path.join(base, file));
      const jestWideo = /\.(mp4|webm)$/.test(file);
      if (jestWideo) wideo += size;
      else {
        obrazy += size;
        if (size > 60 * 1024) zaciezkie.push(`/marketing/${file} = ${Math.round(size / 1024)} kB > 60 kB`);
      }
    }
    expect(zaciezkie, zaciezkie.join(" | ")).toEqual([]);
    // Dziś 128 kB (postery pętli 21 + 7, pięć kafli 103). Zapas jest wąski
    // celowo: szóstego kafla nie da się dołożyć „przy okazji", bez decyzji
    // o wadze. Ciemny poster bramy waży mniej niż jasny magazyn — sufit zostaje.
    expect(Math.round(obrazy / 1024), "suma obrazów marketingowych").toBeLessThanOrEqual(175);
    // 2026-08-11: 1000 → 2400 ŚWIADOMIE, razem z sufitem pojedynczego pliku
    // wyżej: pętla 14,5 s w trzech kodekach sumuje się do 2302 kB w repo,
    // ale na łącze schodzi zawsze JEDEN z nich (AV1 677 / VP9 635 / H.264 990).
    expect(Math.round(wideo / 1024), "suma wideo marketingowego").toBeLessThanOrEqual(2400);
  });

  it("trzyma wagę pojedynczego zasobu w ryzach", () => {
    const heavy: string[] = [];
    for (const { dir, prefix, limit } of ASSET_DIRS) {
      const base = path.join(root, dir);
      if (!existsSync(base)) continue;
      for (const file of readdirSync(base)) {
        const { size } = statSync(path.join(base, file));
        if (size > limit) {
          heavy.push(`${prefix}/${file} = ${Math.round(size / 1024)} kB > ${Math.round(limit / 1024)} kB`);
        }
      }
    }
    expect(heavy, heavy.join(" | ")).toEqual([]);
  });
});
