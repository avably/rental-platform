/**
 * Dane PRZYKŁADOWE podglądu umowy (U10, ADR-151).
 *
 * Ten moduł produkuje WIERSZ ZAMÓWIENIA w dokładnie tym kształcie, w jakim
 * czyta go z bazy generator prawdziwej umowy (`ContractOrderRow`). Dzięki temu
 * podgląd idzie TĄ SAMĄ drogą: `buildContractPdfProps` → `renderContractPdf` →
 * `packages/pdf/src/contract-template.tsx`. Drugiego, „prawie takiego samego"
 * widoku tu nie ma i nie może być — operator ma zobaczyć dokument, który system
 * NAPRAWDĘ wygeneruje, a nie jego ilustrację.
 *
 * ══ OZNACZENIE PRZYKŁADU IDZIE DANYMI, NIE SZABLONEM ══
 *
 * Kusi znak wodny, ale znak wodny wymagałby gałęzi w szablonie umowy — i wtedy
 * podgląd renderowałby coś, czego prawdziwa umowa nie zawiera, czyli przestałby
 * być dowodem na to, co się wygeneruje. Dlatego słowo „PRZYKŁAD" niesie sama
 * treść przykładowa, w miejscach, które szablon drukuje najbardziej widocznie:
 *
 *   - `order_number` → plakietka w nagłówku PIERWSZEJ strony **oraz stopka
 *     KAŻDEJ strony** (`Footer` jest `fixed`), więc żadna kartka wydruku nie
 *     jest bez oznaczenia;
 *   - nazwa najemcy (klienta) → sekcja stron umowy i podpis pod umową;
 *   - nazwy pozycji → przedmiot najmu.
 *
 * Dane WYNAJMUJĄCEGO (nazwa firmy, adres, NIP, e-mail) i treść warunków są
 * PRAWDZIWE — po to jest ten podgląd.
 */
import type { Locale } from "@avably/core";

import type { ContractOrderRow } from "@/app/[locale]/(panel)/zamowienia/[id]/contract-document";

/** Słowo, którym oznaczony jest dokument przykładowy — po jednym na język. */
export const CONTRACT_PREVIEW_MARK: Record<Locale, string> = {
  pl: "PRZYKŁAD",
  en: "SAMPLE",
};

/** Długość przykładowego najmu w dniach (liczona włącznie, jak w umowie). */
export const CONTRACT_PREVIEW_DAYS = 7;

const SAMPLE_TEXT: Record<Locale, {
  customerName: string;
  street: string;
  zip: string;
  city: string;
  email: string;
  itemMain: string;
  itemExtra: string;
  serialNumber: string;
}> = {
  pl: {
    customerName: "PRZYKŁAD — Anna Przykładowa",
    street: "ul. Przykładowa 1/2",
    zip: "00-001",
    city: "Miasto Przykładowe",
    email: "klient@example.com",
    itemMain: "Przykładowy sprzęt — pozycja główna",
    itemExtra: "Przykładowe wyposażenie dodatkowe",
    serialNumber: "PRZYKŁAD-0001",
  },
  en: {
    customerName: "SAMPLE — Jane Sample",
    street: "1 Sample Street, apt. 2",
    zip: "00-001",
    city: "Sample City",
    email: "customer@example.com",
    itemMain: "Sample equipment — main item",
    itemExtra: "Sample additional gear",
    serialNumber: "SAMPLE-0001",
  },
};

/**
 * Kwoty przykładowe są ROZŁĄCZNE (30/15 najmu, 100/20 kaucji, 15 dostawy),
 * żeby operator widział, która liczba skąd się bierze, a test nie przechodził
 * przypadkiem przez kolizję dwóch takich samych kwot w dokumencie.
 */
const SAMPLE_ITEMS = [
  { rental_grosze: 30_000, deposit_grosze: 100_000 },
  { rental_grosze: 15_000, deposit_grosze: 20_000 },
] as const;

const SAMPLE_TOTALS = {
  rental: SAMPLE_ITEMS[0].rental_grosze + SAMPLE_ITEMS[1].rental_grosze,
  deposit: SAMPLE_ITEMS[0].deposit_grosze + SAMPLE_ITEMS[1].deposit_grosze,
  delivery: 1_500,
};

/**
 * Data przesunięta o `days` dni, w UTC, w zapisie `YYYY-MM-DD`.
 *
 * UTC świadomie: przykładowe daty nie opisują żadnego prawdziwego najmu, a
 * arytmetyka strefowa wprowadziłaby do podglądu zmienność zależną od godziny
 * uruchomienia — czyli test, który raz na dobę pokazuje inny wynik.
 */
function shiftIsoDate(isoDate: string, days: number): string {
  const shifted = new Date(`${isoDate}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export interface ContractPreviewSampleInput {
  locale: Locale;
  /** Dzień „dzisiaj" w zapisie `YYYY-MM-DD` — podaje WOŁAJĄCY (wzorzec 8a). */
  today: string;
  /** Waluta najemcy; kwoty są przykładowe, ale symbol ma być prawdziwy. */
  currency: string;
}

/**
 * Przykładowe zamówienie w kształcie, jakiego oczekuje `buildContractPdfProps`.
 *
 * Funkcja jest CZYSTA: bez `new Date()` bez argumentu, bez bazy, bez losowości.
 * Determinizm jest tu wymogiem odbioru — podgląd uruchomiony dwa razy pod rząd
 * ma pokazać ten sam dokument, inaczej „widziałem co innego" staje się
 * nierozstrzygalne.
 */
export function contractPreviewOrderRow(input: ContractPreviewSampleInput): ContractOrderRow {
  const text = SAMPLE_TEXT[input.locale];
  return {
    order_number: CONTRACT_PREVIEW_MARK[input.locale],
    start_date: input.today,
    end_date: shiftIsoDate(input.today, CONTRACT_PREVIEW_DAYS - 1),
    total_rental_grosze: SAMPLE_TOTALS.rental,
    total_deposit_grosze: SAMPLE_TOTALS.deposit,
    delivery_grosze: SAMPLE_TOTALS.delivery,
    currency: input.currency,
    customers: {
      full_name: text.customerName,
      email: text.email,
      // `null`, a nie język panelu: `buildContractPdfProps` spada wtedy na język
      // najemcy — dokładnie tak, jak przy kliencie bez ustawionego języka.
      locale: null,
      address_street: text.street,
      address_zip: text.zip,
      address_city: text.city,
    },
    order_items: [
      {
        rental_grosze: SAMPLE_ITEMS[0].rental_grosze,
        deposit_grosze: SAMPLE_ITEMS[0].deposit_grosze,
        products: { name: text.itemMain },
        product_units: { serial_number: text.serialNumber },
      },
      {
        rental_grosze: SAMPLE_ITEMS[1].rental_grosze,
        deposit_grosze: SAMPLE_ITEMS[1].deposit_grosze,
        products: { name: text.itemExtra },
        product_units: { serial_number: null },
      },
    ],
  };
}
