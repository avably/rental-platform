import { ORDER_STATUSES, PAYMENT_STATUSES } from "@avably/core";
import { statusSemantics } from "@avably/ui";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";
import { ORDER_COLUMN_KEYS, type OrderColumnKey } from "@/lib/orders/order-columns";

/**
 * Kontrakt renderu listy zamówień (ADR-057).
 *
 * Skan źródeł (`order-status-tone-contract.test.ts`) broni sposobu pisania,
 * ten test broni WYNIKU: dla każdej wartości obu osi chip wyrenderowany przez
 * ekran musi mieć `data-tone` równy `statusSemantics[oś][wartość]`. Lokalna
 * podmiana mapowania w ekranie (nawet bez literału `tone=`) pali tutaj.
 *
 * Render jak w P3 — `renderToStaticMarkup`, bo suita panelu chodzi w node bez
 * testing-library. `Link` z next-intl podmieniamy na zwykłą kotwicę, żeby nie
 * ciągnąć routera do renderu statycznego.
 */

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/zamowienia",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { OrdersTable } = await import("@/app/[locale]/(panel)/zamowienia/orders-table");
const { OrdersStats } = await import("@/app/[locale]/(panel)/zamowienia/orders-stats");
const { OrdersToolbar } = await import("@/app/[locale]/(panel)/zamowienia/orders-toolbar");

/**
 * Fixture pokrywa OBIE osie w całości: tyle wierszy, ile ma dłuższa oś, a
 * krótsza (zamówienia) zawija się modulo — każda wartość pojawia się co
 * najmniej raz, łącznie z `cancelled` po obu stronach.
 */
const rows = PAYMENT_STATUSES.map((paymentStatus, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  orderNumber: `ZAM/2026/07${index}`,
  customerLabel: `Klient ${index}`,
  customerName: `Klient ${index}`,
  customerEmail: `klient${index}@example.com`,
  equipment: ["Nagrzewnica 20 kW"],
  startDate: "2026-07-20",
  endDate: "2026-07-22",
  orderStatus: ORDER_STATUSES[index % ORDER_STATUSES.length]!,
  paymentStatus,
  totalRentalGrosze: 119900,
  currency: "PLN" as const,
}));

/** Efektywny sort domyślny (najnowsze po „#") — dla nagłówków i aria-sort. */
const sort = { key: "numer", dir: "desc" } as const;
const baseParams = { q: "szlifierka", status: "reserved" };

/**
 * Render tabeli z wybranym zestawem kolumn i zaznaczeniem (U4/U5). Tabela jest
 * BEZSTANOWA — zaznaczenie i ukryte kolumny wchodzą propsami, więc kontrakt
 * sprawdza dowolny wariant bez `localStorage` i bez atrapy magazynu.
 */
function renderTable(
  hiddenColumns: ReadonlySet<OrderColumnKey> = new Set(),
  selectedIds: ReadonlySet<string> = new Set(),
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <OrdersTable
        rows={rows}
        locale="pl"
        sort={sort}
        baseParams={baseParams}
        hiddenColumns={hiddenColumns}
        selectedIds={selectedIds}
        onToggleRow={() => {}}
        onToggleAll={() => {}}
      />
    </NextIntlClientProvider>,
  );
}

const html = renderTable();

/** Znacznik chipa danej osi i wartości — z całym zestawem atrybutów. */
function chipTag(axis: string, value: string): string | undefined {
  return html.match(
    new RegExp(`<span[^>]*data-status-axis="${axis}"[^>]*data-status-value="${value}"[^>]*>`),
  )?.[0];
}

describe("kontrakt renderu listy zamówień", () => {
  it("wiersze fixture pokrywają wszystkie wartości obu osi", () => {
    // Kontrola po pustym zbiorze: bez niej pętle niżej mogłyby nie sprawdzić
    // żadnej wartości i wciąż być zielone.
    expect(new Set(rows.map((row) => row.orderStatus)).size).toBe(ORDER_STATUSES.length);
    expect(new Set(rows.map((row) => row.paymentStatus)).size).toBe(PAYMENT_STATUSES.length);
    expect(ORDER_STATUSES).toContain("cancelled");
    expect(PAYMENT_STATUSES).toContain("cancelled");
  });

  it("każdy chip osi zamówienia niesie ton ze statusSemantics", () => {
    for (const status of ORDER_STATUSES) {
      const tag = chipTag("order", status);
      expect(tag, `brak chipa order/${status}`).toBeDefined();
      expect(tag, `order/${status}`).toContain(`data-tone="${statusSemantics.order[status]}"`);
    }
  });

  it("każdy chip osi płatności niesie ton ze statusSemantics", () => {
    for (const status of PAYMENT_STATUSES) {
      const tag = chipTag("payment", status);
      expect(tag, `brak chipa payment/${status}`).toBeDefined();
      expect(tag, `payment/${status}`).toContain(`data-tone="${statusSemantics.payment[status]}"`);
    }
  });

  it("każdy chip niesie tekst etykiety, nie sam kolor", () => {
    // Twardy zakaz `color-only-status` z artefaktu: status bez tekstu znika
    // dla daltonisty i dla czytnika ekranu.
    for (const [axis, values] of Object.entries({
      order: ORDER_STATUSES,
      payment: PAYMENT_STATUSES,
    })) {
      for (const value of values) {
        const label = (messages.orders.statusLabels as Record<string, Record<string, string>>)[
          axis
        ]![value]!;
        expect(html, `${axis}/${value}`).toContain(`>${label}</span>`);
      }
    }
  });

  it("kolumny i akcje wiersza są zgodne z sekcją 04 artefaktu", () => {
    for (const column of [
      messages.orders.list.colId,
      messages.orders.list.colCustomer,
      messages.orders.list.colEquipment,
      messages.orders.list.colTerm,
      messages.orders.list.colAmount,
      messages.orders.list.colOrderStatus,
      messages.orders.list.colPaymentStatus,
      messages.orders.list.colActions,
    ]) {
      expect(html).toContain(column);
    }

    // Trigger akcji jest ikoniczny — etykieta musi zostać w aria-label,
    // z numerem zamówienia, żeby nie było dwunastu identycznych „•••".
    const triggers = [...html.matchAll(/aria-label="Działania dla ([^"]+)"/g)];
    expect(triggers).toHaveLength(rows.length);
    expect(triggers.map((match) => match[1])).toEqual(rows.map((row) => row.orderNumber));
  });
});

/* ── Nagłówek: cztery kafle statystyk (U1) ─────────────────────────────── */

const statsHtml = renderToStaticMarkup(
  <NextIntlClientProvider locale="pl" messages={messages}>
    <OrdersStats
      stats={{
        all: { count: 12, sumGrosze: 3_624_700 },
        toDispatch: { count: 2, sumGrosze: 0 },
        inRental: { count: 3, sumGrosze: 0 },
        outstanding: { count: 1, sumGrosze: 129_900 },
      }}
      currency="PLN"
      locale="pl"
    />
  </NextIntlClientProvider>,
);

describe("kontrakt nagłówka: cztery kafle statystyk (U1)", () => {
  it("renderuje komplet czterech kafli z etykietami", () => {
    for (const stat of ["all", "to-dispatch", "in-rental", "outstanding"]) {
      expect(statsHtml, stat).toContain(`data-order-stat="${stat}"`);
    }
    expect(statsHtml).toContain(messages.orders.list.statAllLabel);
    expect(statsHtml).toContain(messages.orders.list.statToDispatchLabel);
    expect(statsHtml).toContain(messages.orders.list.statInRentalLabel);
    expect(statsHtml).toContain(messages.orders.list.statOutstandingLabel);
  });

  it("kwota zaległa idzie akcentem ostrzegawczym z tokenów, nie własnym hexem", () => {
    // „Do zapłaty" jako jedyny kafel niesie ton attention; brak hexa w klasach.
    expect(statsHtml).toContain("text-status-attention-fg");
    expect(statsHtml).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

/* ── Belka: wyszukiwarka, szybkie zakresy, zaawansowane (U1) ────────────── */

const toolbarHtml = renderToStaticMarkup(
  <NextIntlClientProvider locale="pl" messages={messages}>
    <OrdersToolbar filter={{ q: "szlifierka", preset: "biezacy-miesiac" }} customers={[]} resultCount={7} />
  </NextIntlClientProvider>,
);

describe("kontrakt belki: wyszukiwarka i szybkie filtry (U1)", () => {
  it("ma pole wyszukiwarki z placeholderem i licznik wyników", () => {
    expect(toolbarHtml).toContain("data-orders-search");
    expect(toolbarHtml).toContain(messages.orders.list.searchPlaceholder);
    expect(toolbarHtml).toContain("data-orders-result-count");
    expect(toolbarHtml).toContain("7 wyników");
  });

  it("wystawia trzy szybkie zakresy terminu i sekcję zaawansowaną", () => {
    expect(toolbarHtml).toContain(messages.orders.list.presetThisMonth);
    expect(toolbarHtml).toContain(messages.orders.list.presetNextMonth);
    expect(toolbarHtml).toContain(messages.orders.list.presetNext14);
    expect(toolbarHtml).toContain(messages.orders.list.advancedFilters);
  });
});

/* ── Tabela: sortowalne nagłówki (U2) ──────────────────────────────────── */

describe("kontrakt tabeli: sortowalne nagłówki (U2)", () => {
  it("sześć nagłówków sortu niesie klucz i parametr sort w href", () => {
    for (const key of ["numer", "klient", "termin", "kwota", "status", "platnosc"]) {
      const link = html.match(new RegExp(`<a[^>]*data-sort-key="${key}"[^>]*>`))?.[0];
      expect(link, `brak nagłówka sortu ${key}`).toBeDefined();
      expect(link, key).toMatch(new RegExp(`href="[^"]*sort=${key}[^"]*"`));
    }
    const keys = [...html.matchAll(/data-sort-key="([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toHaveLength(6);
  });

  it("dokładnie jedna kolumna jest aktywna (aria-sort), pozostałe none", () => {
    const ariaSorts = [...html.matchAll(/aria-sort="([^"]+)"/g)].map((m) => m[1]);
    // Domyślny sort to „#" malejąco (najnowsze): jedna descending, pięć none.
    expect(ariaSorts.filter((a) => a === "descending")).toHaveLength(1);
    expect(ariaSorts.filter((a) => a === "none")).toHaveLength(5);
  });
});

/* ── Tabela: wiersz-link i widok mobilny (U3) ──────────────────────────── */

/** Wnętrze każdego `<tr data-order-row>` — do asercji per wiersz. */
const rowBlocks = [...html.matchAll(/<tr[^>]*data-order-row[^>]*>([\s\S]*?)<\/tr>/g)].map(
  (match) => match[1]!,
);

/** Kolumny BEZ kotwicy: zaznaczenie (U4) i menu wiersza. */
const LINKLESS_CELLS = ["select", "actions"];

/**
 * Wiersz rozłożony na komórki: `data-cell` → treść komórki. `<td>` nie
 * zagnieżdża się w `<td>`, więc granicą komórki jest następny `<td` albo
 * koniec wiersza.
 */
function cellsOf(rowBlock: string): { key: string; content: string }[] {
  return [...rowBlock.matchAll(/<td[^>]*data-cell="([^"]+)"[^>]*>([\s\S]*?)(?=<td|$)/g)].map(
    (match) => ({ key: match[1]!, content: match[2]! }),
  );
}

describe("kontrakt tabeli: wiersz-link i karty mobilne (U3)", () => {
  it("każdy wiersz ma link do szczegółu, nie tylko komórkę ID", () => {
    const rowLinks = [...html.matchAll(/<a[^>]*data-row-link[^>]*>/g)];
    expect(rowLinks).toHaveLength(rows.length);
    for (const row of rows) {
      expect(html).toContain(`href="/zamowienia/${row.id}"`);
    }
  });

  /**
   * Regresja buga #117: rozciągnięta nakładka (`after:inset-0` w komórce „#"
   * na `relative` `<tr>`) sprawiała, że w Safari i Firefoksie WSZYSTKIE wiersze
   * prowadziły do jednego zamówienia. jsdom nie odda tamtego błędu CSS, więc
   * asercja celuje w to, co jest z nim równoważne strukturalnie: każdy wiersz
   * musi nieść własne, RÓŻNE kotwice do SWOJEGO id, bez pozycjonowania.
   *
   * PO U5 liczba kotwic jest ZMIENNA (kolumny da się ukryć), więc kontrakt jest
   * REGUŁĄ, nie liczbą: każda WIDOCZNA komórka treściowa niesie DOKŁADNIE
   * JEDNĄ kotwicę do celu swojego wiersza, komórki zaznaczenia i Akcji nie
   * niosą żadnej, a cele są RÓŻNE między wierszami. Warianty ukrycia
   * sprawdzamy niżej — ukryta kolumna nie ma prawa zostawić kotwicy w DOM.
   */
  it("każda widoczna komórka treściowa niesie jedną kotwicę do SWOJEGO zamówienia", () => {
    expect(rowBlocks).toHaveLength(rows.length);

    const hrefPerRow = rowBlocks.map((block, index) => {
      const cells = cellsOf(block);
      // Komplet: zaznaczenie, ID, sześć kolumn treściowych, Akcje.
      expect(cells.map((cell) => cell.key), `wiersz ${index}`).toEqual([
        "select",
        "id",
        ...ORDER_COLUMN_KEYS,
        "actions",
      ]);

      const targets = new Set<string>();
      for (const cell of cells) {
        const hrefs = [...cell.content.matchAll(/<a[^>]*?href="([^"]+)"/g)].map((m) => m[1]!);
        if (LINKLESS_CELLS.includes(cell.key)) {
          expect(hrefs, `wiersz ${index}, komórka ${cell.key}`).toHaveLength(0);
          expect(cell.content, `wiersz ${index}, komórka ${cell.key}`).not.toMatch(/<a[\s>]/);
        } else {
          expect(hrefs, `wiersz ${index}, komórka ${cell.key}`).toHaveLength(1);
          targets.add(hrefs[0]!);
        }
      }

      expect(targets.size, `wiersz ${index} miesza cele`).toBe(1);
      return [...targets][0]!;
    });

    expect(hrefPerRow).toEqual(rows.map((row) => `/zamowienia/${row.id}`));
    expect(new Set(hrefPerRow).size, "wiersze dzielą ten sam cel").toBe(rows.length);
  });

  /**
   * Ta sama reguła przy UKRYTYCH kolumnach (U5). Ukrycie ma zdejmować komórkę
   * z DOM-u, a nie zostawiać pustą kotwicę: niewidzialny link do zamówienia
   * dalej łapałby klik i dalej byłby ogłaszany przez czytnik ekranu.
   */
  it.each([
    ["dwie kolumny ukryte", ["customer", "amount"]],
    ["wszystkie treściowe ukryte", [...ORDER_COLUMN_KEYS]],
  ])("reguła kotwic trzyma się przy ukrytych kolumnach: %s", (_label, hiddenKeys) => {
    const hidden = new Set(hiddenKeys as OrderColumnKey[]);
    const visible = ORDER_COLUMN_KEYS.filter((key) => !hidden.has(key));
    const variantHtml = renderTable(hidden);
    const blocks = [...variantHtml.matchAll(/<tr[^>]*data-order-row[^>]*>([\s\S]*?)<\/tr>/g)].map(
      (match) => match[1]!,
    );

    expect(blocks).toHaveLength(rows.length);
    const hrefPerRow = blocks.map((block, index) => {
      const cells = cellsOf(block);
      expect(cells.map((cell) => cell.key), `wiersz ${index}`).toEqual([
        "select",
        "id",
        ...visible,
        "actions",
      ]);
      for (const key of hidden) {
        expect(block, `wiersz ${index}`).not.toContain(`data-cell="${key}"`);
      }

      const anchors = [...block.matchAll(/<a[^>]*?href="([^"]+)"/g)].map((m) => m[1]!);
      // Kotwic dokładnie tyle, ile widocznych komórek treściowych: ID + reszta.
      expect(anchors, `wiersz ${index}`).toHaveLength(1 + visible.length);
      expect(new Set(anchors).size, `wiersz ${index} miesza cele`).toBe(1);
      return anchors[0]!;
    });

    expect(hrefPerRow).toEqual(rows.map((row) => `/zamowienia/${row.id}`));
    expect(new Set(hrefPerRow).size, "wiersze dzielą ten sam cel").toBe(rows.length);
  });

  it("kolumna Akcje nie jest linkiem — menu klika się niezależnie", () => {
    for (const [index, block] of rowBlocks.entries()) {
      const actionsCell = block.match(/<td[^>]*data-cell="actions"[^>]*>([\s\S]*)$/)?.[1] ?? "";
      expect(actionsCell, `wiersz ${index}`).not.toMatch(/<a[\s>]/);
    }
  });

  it("nawigacja idzie kotwicami, nie nakładką pozycjonowaną na <tr>", () => {
    // Sedno buga: `relative` na <tr> + `after:inset-0` w komórce.
    const rowTags = [...html.matchAll(/<tr[^>]*data-order-row[^>]*>/g)].map((m) => m[0]);
    expect(rowTags).toHaveLength(rows.length);
    for (const tag of rowTags) {
      expect(tag).not.toMatch(/class="[^"]*(?:^|\s)relative(?:\s|")/);
    }
    expect(html).not.toContain("after:inset-0");
  });

  it("powtórzone kotwice wiersza są ukryte przed czytnikiem i przed Tabem", () => {
    for (const [index, block] of rowBlocks.entries()) {
      const anchors = [...block.matchAll(/<a[^>]*?>/g)].map((m) => m[0]);
      expect(anchors.filter((a) => a.includes("data-row-link")), `wiersz ${index}`).toHaveLength(1);
      for (const anchor of anchors.filter((a) => !a.includes("data-row-link"))) {
        expect(anchor, `wiersz ${index}`).toContain('aria-hidden="true"');
        expect(anchor, `wiersz ${index}`).toContain('tabindex="-1"');
      }
    }
  });

  it("na mobile każdy wiersz to osobna karta prowadząca do szczegółu", () => {
    const cards = [...html.matchAll(/data-order-card/g)];
    expect(cards).toHaveLength(rows.length);
  });
});

/* ── Tabela: zaznaczanie wierszy (U4) ──────────────────────────────────── */

describe("kontrakt tabeli: zaznaczanie wierszy (U4)", () => {
  it("nagłówek ma jedno „zaznacz wszystkie”, a każdy wiersz własny checkbox", () => {
    expect([...html.matchAll(/data-orders-select-all/g)]).toHaveLength(1);
    expect([...html.matchAll(/data-orders-select-row/g)]).toHaveLength(rows.length);
    // Karty mobilne też dają się zaznaczać — i to POZA kotwicą karty.
    expect([...html.matchAll(/data-orders-select-card/g)]).toHaveLength(rows.length);
  });

  it("checkbox karty mobilnej stoi obok kotwicy, nie w środku niej", () => {
    // Kontrolka wewnątrz <a> jest niepoprawnym HTML-em i pułapką na klik:
    // każde kliknięcie w checkbox nawigowałoby do szczegółu.
    const cards = [...html.matchAll(/<a[^>]*data-order-card[^>]*>([\s\S]*?)<\/a>/g)].map(
      (match) => match[1]!,
    );
    expect(cards).toHaveLength(rows.length);
    for (const [index, card] of cards.entries()) {
      expect(card, `karta ${index}`).not.toContain("data-orders-select-card");
      expect(card, `karta ${index}`).not.toMatch(/<(?:button|input)[\s>]/);
    }
  });

  it("stan zaznaczenia idzie na checkbox I na wiersz, i tylko dla zaznaczonych", () => {
    const selected = new Set([rows[0]!.id, rows[2]!.id]);
    const selectedHtml = renderTable(new Set(), selected);
    const blocks = [...selectedHtml.matchAll(/<tr[^>]*data-order-row[^>]*>[\s\S]*?<\/tr>/g)].map(
      (match) => match[0]!,
    );

    expect(blocks).toHaveLength(rows.length);
    for (const [index, block] of blocks.entries()) {
      const isSelected = selected.has(rows[index]!.id);
      const rowTag = block.match(/<tr[^>]*>/)![0];
      expect(rowTag.includes("data-selected"), `wiersz ${index}`).toBe(isSelected);
      // Radix niesie stan w `data-state` i `aria-checked` — bez tego drugiego
      // czytnik ekranu nie ma czego ogłosić.
      const rowCheckbox = block.match(/<button[^>]*data-orders-select-row[^>]*>/)![0];
      expect(rowCheckbox, `wiersz ${index}`).toContain(
        isSelected ? 'aria-checked="true"' : 'aria-checked="false"',
      );
    }
  });

  it("„zaznacz wszystkie” ma trzeci stan, gdy zaznaczona jest część strony", () => {
    const partial = renderTable(new Set(), new Set([rows[0]!.id]));
    const all = renderTable(new Set(), new Set(rows.map((row) => row.id)));
    const none = renderTable();

    const headOf = (markup: string) =>
      markup.match(/<button[^>]*data-orders-select-all[^>]*>/)![0];

    expect(headOf(partial)).toContain('aria-checked="mixed"');
    expect(headOf(all)).toContain('aria-checked="true"');
    expect(headOf(none)).toContain('aria-checked="false"');
  });

  it("każdy checkbox ma etykietę z numerem zamówienia, nie samą ramkę", () => {
    const labels = [...html.matchAll(/aria-label="Zaznacz zamówienie ([^"]+)"/g)].map((m) => m[1]);
    // Po jednym na wiersz tabeli i po jednym na kartę mobilną.
    expect(labels).toHaveLength(rows.length * 2);
    expect(new Set(labels)).toEqual(new Set(rows.map((row) => row.orderNumber)));
    expect(html).toContain(messages.orders.list.selectAllOnPage);
  });
});

/* ── Belka: wybór kolumn (U5) i układ filtrów (N2) ─────────────────────── */

describe("kontrakt belki: wybór kolumn (U5) i układ filtrów (N2)", () => {
  it("belka ma menu „Kolumny” z licznikiem widocznych", () => {
    expect(toolbarHtml).toContain("data-orders-columns-trigger");
    expect(toolbarHtml).toContain(messages.orders.list.columns);
    // Domyślnie widoczny KOMPLET kolumn treściowych.
    expect(toolbarHtml).toContain(`${ORDER_COLUMN_KEYS.length}/${ORDER_COLUMN_KEYS.length}`);
  });

  it("filtry zaawansowane stoją w TYM SAMYM wierszu co szybkie filtry (N2)", () => {
    const row = toolbarHtml.match(
      /<div[^>]*data-orders-filter-row[^>]*>([\s\S]*?)$/,
    )?.[1];
    expect(row, "brak wiersza sterowania listą").toBeDefined();
    // Jeden wiersz niesie i szybkie zakresy, i oba przyciski z prawej.
    expect(row).toContain(messages.orders.list.presetThisMonth);
    expect(row).toContain(messages.orders.list.presetNextMonth);
    expect(row).toContain(messages.orders.list.presetNext14);
    expect(row).toContain("data-orders-advanced");
    expect(row).toContain("data-orders-columns-trigger");
  });

  it("panel filtrów wychodzi nakładką, a nie pasem pełnej szerokości", () => {
    const details = toolbarHtml.match(/<details[^>]*data-orders-advanced[^>]*>/)![0];
    // Wąski przycisk (auto szerokość od sm), panel jako nakładka nad treścią.
    expect(details).toContain("sm:w-auto");
    expect(details).toContain("relative");
    expect(toolbarHtml).toContain("sm:absolute");
  });
});
