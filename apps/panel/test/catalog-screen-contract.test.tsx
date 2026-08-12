import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * Kontrakt RENDERU ekranów katalogu (ADR-058).
 *
 * Skan źródeł (`panel-date-fields-contract`) broni sposobu pisania, ten test
 * broni WYNIKU — dokładnie tak, jak para kontraktów P4 (ADR-057 D1): sam skan
 * przepuściłby ekran, który stracił wyświetlanie błędu albo klasę cyfr
 * tabelarycznych, bo to nie jest zakazany zapis, tylko brak.
 *
 * Render jak w P3/P4 — `renderToStaticMarkup`, bo suita panelu chodzi w node
 * bez testing-library. `Link` z next-intl podmieniamy na zwykłą kotwicę.
 */

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/katalog",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { ProductsTable } = await import("@/app/[locale]/(panel)/katalog/products-table");
const { ProductForm } = await import("@/app/[locale]/(panel)/katalog/product-form");
const { resolveProductSort } = await import("@/lib/catalog/product-sort");
const { statusSemantics } = await import("@avably/ui");

const rows = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Nagrzewnica olejowa 20 kW",
    basePriceDayGrosze: 54000,
    depositGrosze: 120000,
    active: true,
    unitCount: 3,
    deployedToday: 1,
    thumbnail: {
      url: "http://127.0.0.1:54321/storage/v1/object/public/product-images/t/p/a.jpg",
      alt: "Nagrzewnica na stojaku",
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Zestaw nagłośnieniowy 600 W",
    basePriceDayGrosze: 49500,
    depositGrosze: 150000,
    active: false,
    unitCount: 0,
    deployedToday: 0,
    thumbnail: null,
  },
];

const sort = resolveProductSort(undefined, undefined);

const tableHtml = renderToStaticMarkup(
  <NextIntlClientProvider locale="pl" messages={messages}>
    <ProductsTable rows={rows} currency="PLN" locale="pl" sort={sort} baseParams={{}} />
  </NextIntlClientProvider>,
);

/** Znacznik komórki danego rodzaju — z całym zestawem atrybutów i klas. */
function cellTags(cell: string): string[] {
  return [...tableHtml.matchAll(new RegExp(`<td[^>]*data-cell="${cell}"[^>]*>`, "g"))].map(
    (match) => match[0],
  );
}

/**
 * Formularz w zadanym stanie. `useActionState` oddaje przy renderze
 * serwerowym wyłącznie stan POCZĄTKOWY, więc błąd wchodzi propem
 * `initialState` — to jedyny szew, który nie wymaga podmiany Reacta.
 */
function renderFormWithError(fieldErrors: Record<string, string>): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <ProductForm
        action={async () => ({})}
        initialState={{ fieldErrors }}
        currencyCode="PLN"
        defaults={{
          name: "Na",
          description: "",
          basePriceDay: "540,00",
          deposit: "1200,00",
          autoIncrementMultiplier: "1",
          bufferBeforeDays: "1",
          bufferAfterDays: "1",
          active: true,
        }}
      />
    </NextIntlClientProvider>,
  );
}

describe("kontrakt renderu ekranów katalogu", () => {
  it("fixture pokrywa oba stany dostępności i niepustą tabelę", () => {
    // Kontrola po pustym zbiorze: bez niej asercje niżej mogłyby nie obejrzeć
    // ani jednego wiersza i wciąż być zielone.
    expect(rows.some((row) => row.active)).toBe(true);
    expect(rows.some((row) => !row.active)).toBe(true);
    expect(cellTags("name")).toHaveLength(rows.length);
  });

  it("kolumny liczbowe niosą cyfry tabelaryczne", () => {
    // Kwoty i liczniki muszą się układać w pion — bez `tabular-nums` kolumna
    // „chwieje się" między wierszami (ADR-053 D3).
    for (const cell of ["price", "deposit", "units", "deployed"]) {
      const tags = cellTags(cell);
      expect(tags, `brak komórek ${cell}`).toHaveLength(rows.length);
      for (const tag of tags) {
        expect(tag, `kolumna ${cell} bez tabular-nums`).toContain("tabular-nums");
      }
    }
  });

  it("kolumna tekstowa NIE dostaje cyfr tabelarycznych", () => {
    // Druga strona tej samej reguły: klasa idzie na dane liczbowe, nie na
    // wszystko z rzędu. Bez tej asercji „wszędzie tabular-nums" też by przeszło.
    for (const tag of cellTags("name")) {
      expect(tag).not.toContain("tabular-nums");
    }
  });

  it("oś dostępności ma ton z jednego miejsca, nie z warunku na ekranie", () => {
    const chips = [...tableHtml.matchAll(/<span[^>]*data-catalog-axis="availability"[^>]*>/g)].map(
      (match) => match[0],
    );
    expect(chips).toHaveLength(rows.length);
    expect(chips[0]).toContain('data-catalog-value="active"');
    expect(chips[0]).toContain('data-tone="positive"');
    expect(chips[1]).toContain('data-catalog-value="inactive"');
    // Zdjęcie ze sprzedaży to nie usterka — `neutral`, nigdy `problem`.
    expect(chips[1]).toContain('data-tone="neutral"');
    expect(chips[1]).not.toContain('data-tone="problem"');
    // Oś katalogu jest ROZŁĄCZNA z mapą zamówień: gdyby ktoś dopisał ją do
    // `statusSemantics`, kontrakt tamtej mapy z artefaktem by się rozjechał.
    expect(Object.keys(statusSemantics)).toEqual(["order", "payment", "shipment"]);
  });

  it("status zawsze niesie TEKST, nie sam kolor", () => {
    expect(tableHtml).toContain(messages.catalog.list.activeYes);
    expect(tableHtml).toContain(messages.catalog.list.activeNo);
  });

  it("„dziś w terenie” jest OSOBNĄ osią od publikacji, nie tą samą (U8a)", () => {
    // Kontrola po pustym zbiorze: najpierw upewniamy się, że komórka
    // W OGÓLE się wyrenderowała, potem asertujemy o jej treści.
    const deployed = [...tableHtml.matchAll(/<span[^>]*data-catalog-axis="deployment"[^>]*>/g)].map(
      (match) => match[0],
    );
    expect(deployed, "brak komórek osi deployment").toHaveLength(rows.length);
    // Produkt z 1 sztuką w terenie z 3 → „partial"; produkt bez wydań → „none".
    expect(deployed[0]).toContain('data-catalog-value="partial"');
    expect(deployed[1]).toContain('data-catalog-value="none"');
    // Osie NIE dzielą wartości: gdyby ktoś oznaczył kolumnę „w terenie"
    // istniejącą osią `availability`, w produkcie stanęłyby dwie różne liczby
    // pod jedną nazwą (pułapka zamykana ADR-140).
    for (const chip of deployed) {
      expect(chip).not.toContain('data-catalog-axis="availability"');
    }
    expect(Object.keys(statusSemantics)).toEqual(["order", "payment", "shipment"]);
  });

  it("liczba w terenie jest zapisana WSPÓLNIE z mianownikiem („1 z 3”)", () => {
    // Sama liczba „1" nie mówi nic — dopiero „1 z 3" odpowiada na pytanie
    // operatora „ile z sześciu rowerów jest dziś w terenie".
    expect(tableHtml).toContain("1 z 3");
    // Produkt BEZ egzemplarzy nie udaje „0 z 0" — pokazuje myślnik.
    expect(tableHtml).toContain(messages.catalog.list.deployedNone);
    expect(tableHtml).not.toContain("0 z 0");
  });

  it("miniatura ma alt z opisu, a produkt bez zdjęcia dostaje PLACEHOLDER", () => {
    const image = tableHtml.match(/<img[^>]*data-product-thumbnail="image"[^>]*>/)?.[0];
    expect(image, "brak miniatury produktu ze zdjęciem").toBeDefined();
    expect(image).toContain('alt="Nagrzewnica na stojaku"');
    expect(image).toContain("/storage/v1/object/public/product-images/");
    // Goły URL publiczny, NIE transformacja zależna od planu hostingu (ADR-145).
    expect(image).not.toContain("/render/image/");
    // Produkt bez zdjęcia: kafelek zastępczy, nie dziura w kolumnie.
    const placeholders = [
      ...tableHtml.matchAll(/<span[^>]*data-product-thumbnail="placeholder"[^>]*>/g),
    ];
    expect(placeholders).toHaveLength(1);
  });

  it("nagłówki sortowalne niosą aria-sort, a nie samą strzałkę", () => {
    // Domyślny sort to „nazwa" rosnąco — dokładnie jeden nagłówek jest aktywny.
    const ascending = [...tableHtml.matchAll(/aria-sort="ascending"/g)];
    expect(ascending).toHaveLength(1);
    const none = [...tableHtml.matchAll(/aria-sort="none"/g)];
    expect(none, "sortowalne kolumny bez stanu aria-sort").toHaveLength(3);
    for (const key of ["nazwa", "cena", "egzemplarze", "teren"]) {
      expect(tableHtml, `brak nagłówka sortu ${key}`).toContain(`data-sort-key="${key}"`);
    }
  });

  it("formularz produktu pokazuje KONKRETNY błąd pod polem, z powiązaniem aria", () => {
    const html = renderFormWithError({ name: "Nazwa musi mieć co najmniej 3 znaki." });

    // Komunikat musi być widoczny w treści…
    expect(html).toContain("Nazwa musi mieć co najmniej 3 znaki.");
    // …mieć rolę alertu i identyfikator, na który wskazuje pole…
    expect(html).toMatch(/<p id="product-name-error"[^>]*role="alert"/);
    const field = html.match(/<input[^>]*id="product-name"[^>]*>/)?.[0];
    expect(field).toBeDefined();
    expect(field).toContain('aria-describedby="product-name-error"');
    // …oraz stan error na samym polu: kolor nigdy nie niesie informacji sam.
    expect(field).toContain('aria-invalid="true"');
  });

  it("pole bez błędu nie udaje błędu", () => {
    // Kontrola POZYTYWNA dla asercji wyżej: gdyby render zawsze wypisywał
    // komunikat, tamten test byłby zielony niezależnie od stanu.
    const html = renderFormWithError({});
    expect(html).not.toContain("product-name-error");
    // Szukamy ATRYBUTU, nie podciągu: klasa `aria-invalid:border-destructive`
    // z prymitywu P2 siedzi w każdym polu i sama w sobie niczego nie znaczy.
    expect(html.match(/<input[^>]*id="product-name"[^>]*>/)?.[0]).not.toContain(
      'aria-invalid="true"',
    );
  });
});
