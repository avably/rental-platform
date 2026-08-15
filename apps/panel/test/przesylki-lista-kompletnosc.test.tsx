// @vitest-environment jsdom

/**
 * LISTA PRZESYŁEK NIE GUBI ŻADNEJ DAWNEJ KOLUMNY (ADR-188).
 *
 * ================== CO TEN TEST PILNUJE ==================
 *
 * ADR-188 zdjął ze szczegółu zamówienia tabelę ośmiu kolumn, bo nie mieściła
 * się w kolumnie treści przy ŻADNEJ szerokości okna. Najtańszym sposobem, żeby
 * „zmieścić" tabelę, jest wyrzucenie z niej danych — dlatego twardym warunkiem
 * tej zmiany było: żadna informacja nie znika bez drogi dotarcia do niej.
 *
 * Ten plik broni właśnie tego warunku i NIE zajmuje się geometrią. Geometrię —
 * szerokość własną wobec dostępnej, przy pięciu szerokościach okna, w prawdziwej
 * przeglądarce — mierzy `packages/e2e/tests/06-przesylki-w-kolumnie.spec.ts`.
 * Podział ról jest celowy: jsdom NIE liczy layoutu, więc udawanie tu pikseli
 * dałoby bramkę, która świeci na zielono niezależnie od tego, co widzi operator.
 *
 * „Droga dotarcia" rozumiana jest wprost: komplet danych stoi w drzewie
 * dostępności OD RAZU, bez rozwijania i bez chowania przed czytnikiem ekranu.
 * Gdyby kiedyś doszło rozwinięcie, ten test trzeba będzie świadomie przepisać —
 * i o to chodzi.
 */
import { cleanup, render, within } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/** Odpowiednik `getTranslations` serwera na PRAWDZIWYCH tekstach PL — bez tego
 * test przechodziłby na kluczach i nie widziałby, czy etykieta w ogóle istnieje. */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale: "pl",
      messages,
      namespace,
      timeZone: "Europe/Warsaw",
    } as unknown as Parameters<typeof createTranslator>[0]),
}));

const { ShipmentsList } = await import(
  "@/app/[locale]/(panel)/zamowienia/[id]/shipments-list"
);
const copy = messages.orders.delivery.section;

const ORDER_ID = "11111111-2222-4333-8444-555555555555";

/** Statusy, przy których anulowanie ma jeszcze skutek (ADR-105) — spisane
 * jako zwykłe stringi, żeby porównanie nie zawężało się do typów fikstur. */
const ANULOWALNE: readonly string[] = ["created", "in_progress"];

/** Fikstury w kształcie produkcji: długie identyfikatory i surowy status
 * dostawcy — to one rozpychały tabelę i to one muszą się na ekranie znaleźć. */
const PRZESYLKI = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    shipment_type: "outbound" as const,
    status: "in_transit" as const,
    provider_order_number: "GK-2026-08-0000148372",
    provider_status: "PRZESYLKA_W_DORECZENIU_ODDZIAL_WARSZAWA_OKECIE",
    tracking_number: "00259776543210987654321",
    tracking_url: "https://sledzenie.przewoznik.example/pl/przesylka?numer=00259776543210987654321",
    price_grosze: 2390,
    created_at: "2026-08-14T09:12:00.000Z",
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    shipment_type: "return" as const,
    status: "created" as const,
    provider_order_number: "GK-2026-08-0000148519",
    provider_status: null,
    tracking_number: "00259776543211122334455",
    tracking_url: "https://sledzenie.przewoznik.example/pl/przesylka?numer=00259776543211122334455",
    price_grosze: 1990,
    created_at: "2026-08-14T10:41:00.000Z",
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    shipment_type: "outbound" as const,
    status: "delivered" as const,
    provider_order_number: "GK-2026-07-0000139004",
    provider_status: "DORECZONA_ODBIOR_OSOBISTY_PUNKT_PARTNERSKI",
    tracking_number: null,
    tracking_url: null,
    price_grosze: null,
    created_at: "2026-07-30T16:05:00.000Z",
  },
];

const timestamp = new Intl.DateTimeFormat("pl", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Warsaw",
});

const akcja = async () => ({});

async function renderujListe() {
  const element = await ShipmentsList({
    shipments: PRZESYLKI,
    orderId: ORDER_ID,
    locale: "pl",
    currency: "PLN",
    emailAvailability: { available: true },
    timestamp,
    actions: { refreshStatus: akcja, cancelShipment: akcja, sendReturnLabel: akcja },
  });

  render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {element}
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("lista przesyłek — komplet informacji dawnych kolumn (ADR-188)", () => {
  it("renderuje kartę na każdą przesyłkę (kontrola pozytywna zbioru)", async () => {
    await renderujListe();

    // Bez tej asercji każda kolejna „nic nie znika" byłaby zielona na PUSTYM
    // zbiorze kart — najczęstszy sposób, w jaki bramka kompletności kłamie.
    expect(document.querySelectorAll("[data-shipment]")).toHaveLength(PRZESYLKI.length);
  });

  it("każda karta niesie komplet danych z dawnych kolumn", async () => {
    await renderujListe();

    const karty = [...document.querySelectorAll<HTMLElement>("[data-shipment]")];

    for (const [index, przesylka] of PRZESYLKI.entries()) {
      const karta = karty[index]!;
      const w = within(karta);
      const tekst = karta.textContent ?? "";

      // 1. TYP (dawna kolumna „Typ")
      expect(w.getByText(copy.types[przesylka.shipment_type])).toBeTruthy();

      // 2. STATUS (dawna kolumna „Status") — chip z osią i wartością, jak
      //    wszędzie w panelu; sam kolor nigdy nie jest nośnikiem (ADR-057).
      const chip = karta.querySelector('[data-status-axis="shipment"]');
      expect(chip?.getAttribute("data-status-value")).toBe(przesylka.status);
      expect(chip?.textContent?.trim().length ?? 0).toBeGreaterThan(0);

      // 3. SUROWY STATUS DOSTAWCY — tam, gdzie różni się od naszego (ADR-031).
      if (przesylka.provider_status) {
        expect(tekst).toContain(przesylka.provider_status);
      }

      // 4. NUMER U DOSTAWCY (dawna kolumna „Nr u dostawcy")
      expect(tekst).toContain(przesylka.provider_order_number);

      // 5. ŚLEDZENIE (dawna kolumna „Śledzenie") — numer JAKO LINK do
      //    przewoźnika, plus kopiowanie do schowka.
      if (przesylka.tracking_number) {
        const link = w.getByRole("link", { name: przesylka.tracking_number });
        expect(link.getAttribute("href")).toBe(przesylka.tracking_url);
        expect(w.getByRole("button", { name: copy.copyCta })).toBeTruthy();
      } else {
        expect(tekst).toContain("—");
      }

      // 6. KOSZT NADANIA (dawna kolumna „Koszt nadania") — kwota albo jawny
      //    myślnik; brak ceny nie może być pustym miejscem.
      if (przesylka.price_grosze !== null) {
        expect(tekst).toMatch(/23,90|19,90/);
      }

      // 7. UTWORZONO (dawna kolumna „Utworzono")
      expect(tekst).toContain(timestamp.format(new Date(przesylka.created_at)));

      // 8. ETYKIETA (dawna kolumna „Etykieta") — link do route handlera PDF
      //    z identyfikatorem TEJ przesyłki.
      const etykieta = w.getByRole("link", { name: copy.labelLink });
      expect(etykieta.getAttribute("href")).toBe(
        `/pl/zamowienia/${ORDER_ID}/delivery-label?shipment=${przesylka.id}`,
      );

      // 9. AKCJE (dawna kolumna bez nagłówka) — odświeżenie zawsze; etykieta
      //    zwrotna tylko przy zwrocie; anulowanie tylko tam, gdzie ma skutek.
      expect(w.getByRole("button", { name: copy.refreshCta })).toBeTruthy();
      expect(
        Boolean(w.queryByRole("button", { name: copy.sendReturnLabelCta })),
        `etykieta zwrotna w karcie ${przesylka.shipment_type}`,
      ).toBe(przesylka.shipment_type === "return");
      expect(
        Boolean(w.queryByRole("button", { name: copy.cancelShipmentCta })),
        `anulowanie w karcie o statusie ${przesylka.status}`,
      ).toBe(ANULOWALNE.includes(przesylka.status));
    }
  });

  it("nic nie chowa się przed czytnikiem ekranu ani za rozwinięciem", async () => {
    await renderujListe();

    const lista = document.querySelector("[data-shipment]")!.closest("ul")!;
    const schowane = [...lista.querySelectorAll<HTMLElement>("*")].filter(
      (element) =>
        element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true",
    );

    expect(
      schowane.map((element) => element.tagName.toLowerCase()),
      "element listy przesyłek poza drzewem dostępności",
    ).toEqual([]);
    expect(lista.querySelectorAll("details")).toHaveLength(0);
  });

  it("dane wiersza nie stoją w tabeli (kontrola przyczyny defektu)", async () => {
    await renderujListe();

    // Tabela liczy szerokość OD TREŚCI (`table-layout: auto`) i nie umie zejść
    // poniżej sumy swoich kolumn — właśnie dlatego dane dostawcy, na które nie
    // mamy wpływu, rozpychały ją ponad szerokość kolumny treści. Powrót tabeli
    // w to miejsce to powrót defektu, więc jest tu nazwany wprost.
    expect(document.querySelectorAll("[data-shipment] table")).toHaveLength(0);
  });
});
