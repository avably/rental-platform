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

  it("kieruje CTA do rejestracji, a listę oczekujących trzyma jako drugą drogę", () => {
    const home = read("marketing/home.html");
    const registerLinks = home.match(/\{\{link\.register\}\}/g) ?? [];
    expect(registerLinks.length).toBeGreaterThanOrEqual(4);
    expect(home).toContain("{{link.waitlist}}");
    expect(home).not.toContain("webflow.com/templates");
  });

  it("trzyma cennik i obietnice zgodne z decyzją właściciela", () => {
    expect(pl.marketing.banner.text).toContain("199 zł/msc");
    expect(pl.marketing.pricingPage.price).toContain("199 zł");
    expect(pl.marketing.pricingPage.foundersPrice).toContain("99,50");
    expect(pl.marketing.pricingPage.foundersNote).toContain("20");
    expect(read("marketing/pricing.html")).toContain("{{pricingPage.price}}");
    expect(en.marketing.banner.text).toContain("PLN 199");
    for (const messages of [pl, en]) {
      expect(messages.marketing.faq.a4).toMatch(/20/);
    }
    // Płatności online wolno wymieniać wyłącznie jako budowane.
    const paymentsPl = pl.marketing.faq.a1;
    expect(paymentsPl).toMatch(/w budowie/i);
    expect(en.marketing.faq.a1).toMatch(/being built/i);
    const featuresPl = Object.entries(pl.marketing.features)
      .filter(([key]) => key.startsWith("card"))
      .map(([, value]) => value)
      .join(" ");
    expect(featuresPl).not.toMatch(/płatności online/i);
  });
});

describe("spójność tras i zasobów", () => {
  const routes = new Set<string>([
    "",
    ...PUBLIC_PAGES.filter((page) => page !== "home"),
    ...TEMPLATE_ROUTES,
    "przeglad",
  ]);

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
