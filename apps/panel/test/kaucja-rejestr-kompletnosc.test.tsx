// @vitest-environment jsdom

/**
 * REJESTR KAUCJI NIE GUBI ŻADNEJ DAWNEJ KOLUMNY (ADR-204).
 *
 * ================== CO TEN TEST PILNUJE ==================
 *
 * ADR-204 zdjął z rejestru kaucji tabelę pięciu kolumn (data, zdarzenie,
 * kwota, powód, saldo), bo prymityw `Table` chował jej przepełnienie
 * w `overflow-x-auto`, a nieograniczony tekst operatora (powód potrącenia)
 * rozpychał ją ponad kolumnę treści. Najtańszym sposobem, żeby cokolwiek
 * „zmieściło się", jest wyrzucenie z tego danych — dlatego twardym warunkiem
 * zmiany było: żadna informacja nie znika i żadna nie jest ucinana. Rejestr
 * jest dowodem w sporze z klientem; dowód przycięty do wielokropka przestaje
 * nim być.
 *
 * Ten plik broni właśnie tego warunku i NIE zajmuje się geometrią. Geometrię —
 * szerokość własną wobec dostępnej, przy pięciu szerokościach okna, w prawdziwej
 * przeglądarce — mierzy `packages/e2e/tests/08-kaucja-w-kolumnie.spec.ts`.
 * Podział ról jest celowy: jsdom NIE liczy layoutu, więc udawanie tu pikseli
 * dałoby bramkę, która świeci na zielono niezależnie od tego, co widzi operator.
 *
 * „Droga dotarcia" rozumiana jest wprost: komplet danych stoi w drzewie
 * dostępności OD RAZU, bez rozwijania W OBRĘBIE LISTY i bez chowania przed
 * czytnikiem ekranu. (Zewnętrzne `<details>` sekcji — „Szczegóły
 * rozliczenia" — to osobna, wcześniejsza decyzja D7/N5 o miejscu CAŁEJ
 * chronologii, nie o dostępności pól pojedynczego wiersza.)
 */
import { formatMoney } from "@avably/core";
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

const { DepositLedger } = await import(
  "@/app/[locale]/(panel)/zamowienia/[id]/deposit-ledger"
);
const { runningBalances } = await import("@/app/[locale]/(panel)/zamowienia/[id]/deposit");
const copy = messages.orders.deposit;

/** Najdłuższy NIEROZDZIELNY token powodu — to on wywracał tabelę i to jego
 * pełna obecność (nie prefiks, nie wielokropek) jest tu asercją. */
const TOKEN_POWODU =
  "ZGLOSZENIESERWISOWE20260812WIERTNICADHZ400OBUDOWAPRZEKLADNIWYCENA48000GR";

/** Powód potrącenia w kształcie produkcji: kolumna `reason` nie ma limitu
 * długości (~500 znaków, wewnątrz token bez spacji). */
const DLUGI_POWOD =
  "Uszkodzenie wiertnicy stwierdzone przy zwrocie: pęknięta obudowa przekładni " +
  "i wyłamany uchwyt boczny. Klient potwierdził uszkodzenie na miejscu przy " +
  "odbiorze, protokół spisany w obecności pracownika magazynu i podpisany przez " +
  "obie strony. Wycena serwisu obejmuje wymianę obudowy przekładni, robociznę " +
  `oraz kalibrację narzędzia po naprawie. Identyfikator zgłoszenia: ${TOKEN_POWODU} ` +
  "(numer nadany automatycznie przez system serwisowy dostawcy). Pozostała część " +
  "kaucji wraca do klienta po zakończeniu rozliczenia zamówienia.";

/** Fikstury w kształcie produkcji: cztery rodzaje wierszy, które rejestr
 * naprawdę miewa — pobranie ręczne, pobranie z obiegu dostawcy (z odnośnikiem
 * dowodowym), potrącenie z długim powodem, zwrot bez powodu. */
const ZDARZENIA = [
  {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    kind: "collected" as const,
    amount_grosze: 100_000,
    reason_code: null,
    reason: null,
    provider: "manual" as const,
    provider_reference: null,
    created_at: "2026-08-10T09:00:00.000Z",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    kind: "collected" as const,
    amount_grosze: 50_000,
    reason_code: null,
    reason: null,
    provider: "stripe" as const,
    provider_reference: "pi_3RqKaucjaNajmuRazemZPlatnoscia0029",
    created_at: "2026-08-10T09:05:00.000Z",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000003",
    kind: "deducted" as const,
    amount_grosze: 40_000,
    reason_code: "damage",
    reason: DLUGI_POWOD,
    provider: "manual" as const,
    provider_reference: null,
    created_at: "2026-08-17T15:30:00.000Z",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000004",
    kind: "refunded" as const,
    amount_grosze: 60_000,
    reason_code: null,
    reason: null,
    provider: "manual" as const,
    provider_reference: null,
    created_at: "2026-08-17T15:45:00.000Z",
  },
];

/** Salda liczone TĄ SAMĄ funkcją, którą woła strona (./deposit) — test
 * pilnuje, że karta i-tego zdarzenia pokazuje saldo PO i-tym zdarzeniu,
 * a nie saldo sąsiada. */
const SALDA = runningBalances(ZDARZENIA);

const timestamp = new Intl.DateTimeFormat("pl", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Warsaw",
});

async function renderujRejestr() {
  const element = await DepositLedger({
    events: ZDARZENIA,
    balances: SALDA,
    currency: "PLN",
    locale: "pl",
    timestamp,
  });

  render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {element}
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("rejestr kaucji — komplet informacji dawnych kolumn (ADR-204)", () => {
  it("renderuje kartę na każde zdarzenie (kontrola pozytywna zbioru)", async () => {
    await renderujRejestr();

    // Bez tej asercji każda kolejna „nic nie znika" byłaby zielona na PUSTYM
    // zbiorze kart — najczęstszy sposób, w jaki bramka kompletności kłamie.
    expect(document.querySelectorAll("[data-deposit-event]")).toHaveLength(ZDARZENIA.length);
  });

  it("każda karta niesie komplet danych z dawnych kolumn", async () => {
    await renderujRejestr();

    const karty = [...document.querySelectorAll<HTMLElement>("[data-deposit-event]")];

    for (const [index, zdarzenie] of ZDARZENIA.entries()) {
      const karta = karty[index]!;
      const w = within(karta);
      const tekst = karta.textContent ?? "";

      // 1. ZDARZENIE (dawna kolumna „Zdarzenie") — słowo, nie sam znak kwoty.
      expect(w.getByText(copy.kinds[zdarzenie.kind])).toBeTruthy();
      expect(karta.getAttribute("data-deposit-kind")).toBe(zdarzenie.kind);

      // 2. KWOTA (dawna kolumna „Kwota") — ze znakiem kierunku: pobranie
      //    zwiększa saldo, zwrot i potrącenie je zmniejszają.
      const znak = zdarzenie.kind === "collected" ? "+" : "−";
      expect(tekst).toContain(
        `${znak}${formatMoney(zdarzenie.amount_grosze, "PLN", "pl")}`,
      );

      // 3. DATA (dawna kolumna „Data")
      expect(tekst).toContain(timestamp.format(new Date(zdarzenie.created_at)));

      // 4. SALDO PO ZDARZENIU (dawna kolumna „Saldo") — z indeksu TEGO wiersza.
      expect(tekst).toContain(formatMoney(SALDA[index]!, "PLN", "pl"));

      // 5. POWÓD (dawna kolumna „Powód") — kod z listy PLUS pełne
      //    doprecyzowanie operatora. Całe ~500 znaków, z tokenem bez spacji:
      //    skrócenie „dla zmieszczenia się" ma tu być czerwone.
      if (zdarzenie.kind === "deducted") {
        expect(tekst).toContain(copy.reasonCodes[zdarzenie.reason_code as "damage"]);
        expect(tekst).toContain(DLUGI_POWOD);
        expect(tekst).toContain(TOKEN_POWODU);
      } else {
        // Brak powodu to jawny myślnik, nie puste miejsce (wzorzec dawnej
        // tabeli): pole bez wartości nie może wyglądać jak pole zgubione.
        expect(tekst).toContain("—");
      }

      // 6. OBIEG I DOWÓD U DOSTAWCY (ADR-069) — wiersz z obiegu dostawcy
      //    niesie odnośnik, wiersz ręczny NIE twierdzi, że ma dostawcę.
      if (zdarzenie.provider === "stripe") {
        expect(tekst).toContain(copy.providerOnline);
        expect(tekst).toContain(zdarzenie.provider_reference!);
      } else {
        expect(tekst).not.toContain(copy.providerOnline);
      }
    }
  });

  it("nic nie chowa się przed czytnikiem ekranu ani za rozwinięciem", async () => {
    await renderujRejestr();

    const lista = document.querySelector("[data-deposit-ledger]")!;
    const schowane = [...lista.querySelectorAll<HTMLElement>("*")].filter(
      (element) =>
        element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true",
    );

    expect(
      schowane.map((element) => element.tagName.toLowerCase()),
      "element rejestru kaucji poza drzewem dostępności",
    ).toEqual([]);
    expect(lista.querySelectorAll("details")).toHaveLength(0);
  });

  it("dane wiersza nie stoją w tabeli (kontrola przyczyny defektu)", async () => {
    await renderujRejestr();

    // Tabela liczy szerokość OD TREŚCI (`table-layout: auto`), komórki
    // prymitywu niosą `whitespace-nowrap`, a kontener `overflow-x-auto`
    // chowa przepełnienie bez śladu. Powrót tabeli w to miejsce to powrót
    // defektu, więc jest tu nazwany wprost.
    expect(document.querySelectorAll("[data-deposit-event] table")).toHaveLength(0);
    expect(document.querySelectorAll("[data-deposit-ledger] table")).toHaveLength(0);
  });
});
