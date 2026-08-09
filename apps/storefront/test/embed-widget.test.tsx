/**
 * Kontrakt WIZUALNY widgetu embedu (M3, ADR-120) — bramka dla trzech rzeczy
 * zgłoszonych przy recenzji wizualnej #227.
 *
 * Dlaczego to w ogóle jest testem, a nie „widać na zrzucie": zrzut dowodzi
 * stanu z jednej chwili, a wszystkie trzy usterki były REGRESJAMI CICHYMI —
 * kalendarz bez sufitu rósł dopiero w szerokim gnieździe, nagłówków dni po
 * prostu nie było, a podpis marki był samym tekstem. Żadna z nich nie paliła
 * niczego w CI. Teraz pali.
 */
import { load } from "cheerio";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CustomFieldDefinition } from "@avably/core";

import { EmbedCustomField, EmbedWidget } from "@/components/embed/embed-widget";
import plMessages from "../messages/pl.json";
import enMessages from "../messages/en.json";

const PRODUCT = "11111111-1111-4111-8111-111111111111";

const KATALOG = {
  products: [
    {
      id: PRODUCT,
      name: "Wiertarka udarowa",
      description: null,
      base_price_day_grosze: 8000,
      deposit_grosze: 20000,
      auto_increment_multiplier: 1,
      buffer_before_days: 0,
      buffer_after_days: 0,
      pricing_tiers: [],
      images: [],
    },
  ],
  pickupLocations: [
    { id: "22222222-2222-4222-8222-222222222222", name: "Magazyn", address_street: null, address_zip: null, address_city: null },
  ],
  deliveryMethods: [{ method: "pickup", price_grosze: 0 }],
} as never as {
  products: never[];
  pickupLocations: never[];
  deliveryMethods: never[];
};

/**
 * Render bez przeglądarki: `renderToStaticMarkup` + cheerio (storefront nie ma
 * jsdom ani testing-library i nie potrzebuje ich tutaj). Efekty się nie
 * wykonują, więc ani ResizeObserver, ani pobranie miesiąca nie są potrzebne —
 * nagłówki dni i podpis marki są w PIERWSZYM renderze, a to jest dokładnie to,
 * czego bronimy.
 */
function renderWidget(locale: "pl" | "en" = "pl", theme: "light" | "dark" = "light") {
  const copy = (locale === "pl" ? plMessages : enMessages).storefront;
  return load(
    renderToStaticMarkup(
      <EmbedWidget
        copy={copy as never}
        locale={locale}
        currency="PLN"
        products={KATALOG.products}
        pickupLocations={KATALOG.pickupLocations}
        deliveryMethods={KATALOG.deliveryMethods}
        customFields={[]}
        initialProductId={PRODUCT}
        theme={theme}
      />,
    ),
  );
}

const css = readFileSync(new URL("../app/embed/embed.css", import.meta.url), "utf8");
/** CSS bez komentarzy — inaczej wzmianka o `@media` w uzasadnieniu udaje regułę. */
const cssBezKomentarzy = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("widget embedu — nagłówki dni tygodnia", () => {
  it("kalendarz ma komplet siedmiu nagłówków, po polsku", () => {
    const $ = renderWidget("pl");
    const naglowki = $(".avably-embed__weekdays span");

    expect(naglowki.length, "brak wiersza nagłówków — kolumny trzeba liczyć palcem").toBe(7);
    expect(naglowki.toArray().map((el) => $(el).text())).toEqual([
      "pn", "wt", "śr", "cz", "pt", "so", "nd",
    ]);
  });

  it("nagłówki tłumaczą się razem z resztą widgetu", () => {
    const $ = renderWidget("en");

    expect($(".avably-embed__weekdays span").toArray().map((el) => $(el).text())).toEqual([
      "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    ]);
  });

  it("kolejność nagłówków zgadza się z przesunięciem pierwszego dnia (tydzień od poniedziałku)", () => {
    const $ = renderWidget("pl");
    // Poniedziałek pierwszy — zgodnie z `weekdayIndex`. Gdyby siatka szła od
    // niedzieli, nagłówki i kolumny rozjechałyby się o jeden dzień.
    const naglowki = $(".avably-embed__weekdays span").toArray().map((el) => $(el).text());
    expect(naglowki[0]).toBe("pn");
    expect(naglowki[6]).toBe("nd");
  });
});

describe("widget embedu — podpis marki", () => {
  it("stopka niesie LOGO, nie sam tekst", () => {
    const $ = renderWidget("pl");
    const logo = $("[data-embed-logo]");

    expect(logo.length, "podpis bez znaku marki").toBe(1);
    expect(logo.prop("tagName")).toBe("IMG");
    expect(logo.attr("alt")).toBe(plMessages.storefront.embed.poweredBy);
  });

  it("znak bierze się z JEDYNEGO miejsca, w którym logo żyje w repo", () => {
    const $ = renderWidget("pl");
    const src = $("[data-embed-logo]").attr("src")!;

    expect(src).toBe("/forerunner/images/avably-logo-dark.svg");
    // Kropka w ścieżce = trasa omija proxy, czyli także bramkę hasła. Bez tego
    // logo wracałoby na cudzej stronie jako 401 (patrz docblock komponentu).
    expect(src).toMatch(/\.svg$/);
  });

  it("wariant znaku idzie za MOTYWEM: jasny tusz na ciemnym tle", () => {
    const $ = renderWidget("pl", "dark");
    expect($("[data-embed-logo]").attr("src")).toBe("/forerunner/images/avably-logo-light.svg");
  });
});

describe("embed.css — układ zależny od GNIAZDA, nie od okna", () => {
  it("korzeń jest kontenerem zapytań", () => {
    expect(cssBezKomentarzy).toContain("container-type: inline-size");
    expect(cssBezKomentarzy).toContain("container-name: embed");
  });

  it("ZERO reguł @media — okno przeglądarki nic nie mówi o szerokości gniazda", () => {
    expect(cssBezKomentarzy).not.toContain("@media");
    expect(cssBezKomentarzy).toMatch(/@container embed \(/);
  });

  it("ZERO skalowania — scale() nie przyjmuje jednostek kontenerowych i rozmywa tekst", () => {
    expect(cssBezKomentarzy).not.toMatch(/transform:\s*scale/);
    expect(cssBezKomentarzy).not.toMatch(/\d+cqw/);
  });

  it("kalendarz MA SUFIT — komórka nie rośnie liniowo z gniazdem", () => {
    // To jest sedno reklamacji wizualnej: bez sufitu dzień miał ~165 px
    // w gnieździe 1200 px, a kalendarz zjadał ~1000 px wysokości.
    const siatka = cssBezKomentarzy.match(/\.avably-embed__weekdays,\s*\n\.avably-embed__grid \{[^}]*\}/);
    expect(siatka, "nie znaleziono reguły siatki kalendarza").not.toBeNull();
    expect(siatka![0]).toMatch(/max-width:\s*360px/);
  });

  it("widżet jako całość też ma sufit i centruje się w szerokim gnieździe", () => {
    expect(cssBezKomentarzy).toMatch(/max-width:\s*720px/);
    expect(cssBezKomentarzy).toMatch(/margin-inline:\s*auto/);
  });

  it("kontrolki formularza dorównują celom dotykowym kalendarza", () => {
    expect(cssBezKomentarzy).toMatch(/min-height:\s*40px/);
  });
});

/**
 * Pola własne w ramce (C6-A3, ADR-121).
 *
 * Regresja, przed którą to broni, jest konkretna: serwer embedu egzekwuje
 * wymagalność po definicjach najemcy, więc formularz, który pola nie rysuje,
 * daje najemcy z polem WYMAGANYM ramkę odrzucaną przy każdej próbie — i to
 * bez żadnego błędu w kodzie, który dałoby się zobaczyć.
 */
describe("widget embedu — pola własne najemcy", () => {
  const definition = (
    type: CustomFieldDefinition["type"],
    overrides: Partial<CustomFieldDefinition> = {},
  ): CustomFieldDefinition => ({
    id: "11111111-1111-4111-8111-111111111111",
    entity: "order",
    type,
    label: "Numer uprawnień",
    helpText: null,
    required: false,
    options: type === "select" ? ["Alfa", "Beta"] : [],
    position: 0,
    showInPanel: false,
    showInCheckout: true,
    showInContract: false,
    archivedAt: null,
    createdAt: null,
    ...overrides,
  });

  const renderField = (d: CustomFieldDefinition) =>
    load(
      renderToStaticMarkup(
        <EmbedCustomField
          definition={d}
          error={undefined}
          invalidLabel="błąd"
          chooseLabel="Wybierz…"
        />,
      ),
    );

  it("nazwa kontrolki to KLUCZ KONTRAKTU cf_<id> — tym samym, którym serwer odsyła błąd", () => {
    const $ = renderField(definition("text"));
    expect($('[name="cf_11111111-1111-4111-8111-111111111111"]').length).toBe(1);
    expect($("span").first().text()).toBe("Numer uprawnień");
  });

  it("każdy z siedmiu rodzajów dostaje kontrolkę, nie pustkę", () => {
    const rodzaje: CustomFieldDefinition["type"][] = [
      "text", "textarea", "number", "date", "select", "checkbox", "phone",
    ];
    for (const type of rodzaje) {
      const $ = renderField(definition(type));
      expect(
        $('[name="cf_11111111-1111-4111-8111-111111111111"]').length,
        `rodzaj ${type} nie wyrenderował kontrolki`,
      ).toBe(1);
    }
  });

  it("lista wyboru niesie opcje z definicji i pustkę na starcie", () => {
    const $ = renderField(definition("select"));
    expect($("option").toArray().map((el) => $(el).attr("value"))).toEqual(["", "Alfa", "Beta"]);
  });

  it("pole wymagane dostaje atrybut required (wygoda przeglądarki, nie bramka)", () => {
    const $ = renderField(definition("text", { required: true }));
    expect($('[name="cf_11111111-1111-4111-8111-111111111111"]').attr("required")).toBeDefined();
  });

  it("podpowiedź najemcy trafia pod pole", () => {
    const $ = renderField(definition("text", { helpText: "Numer z zaświadczenia UDT." }));
    expect($("small").text()).toBe("Numer z zaświadczenia UDT.");
  });

  it("odmowa serwera ląduje przy polu", () => {
    const $ = load(
      renderToStaticMarkup(
        <EmbedCustomField
          definition={definition("text")}
          error="not_allowed"
          invalidLabel="Nieprawidłowa wartość."
          chooseLabel="Wybierz…"
        />,
      ),
    );
    expect($("em").text()).toBe("Nieprawidłowa wartość.");
  });
});
