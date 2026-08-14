/**
 * Kontrakt propsów generatora umów PDF.
 *
 * ZAMROŻONY po merge'u — Zadanie Z7 (umowa per tenant) woła `renderContractPdf`
 * dokładnie na tym kształcie. Wzorzec 8a (jak `RentalLifecycleEmailProps`
 * w `@avably/emails`): wartości formatuje WOŁAJĄCY. Pakiet nie liczy kwot,
 * nie zna VAT-u ani stref czasowych — daty przychodzą jako gotowe stringi,
 * a kwoty jako liczby groszy do sformatowania (jedyny kontakt pakietu
 * z groszami to ich reprezentacja, patrz `money.ts`).
 */
import type { ContractLogo } from "./logo";

/**
 * Para etykieta→wartość pola własnego najemcy (C6-A2, ADR-119).
 *
 * OBIE STRONY SĄ GOTOWYM TEKSTEM i obie są TREŚCIĄ, nigdy instrukcją. Etykietę
 * i wartość wpisuje operator (a przy polach checkoutowych — klient końcowy),
 * więc szablon renderuje je WYŁĄCZNIE w `<Text>`: żadnego parsera HTML, którym
 * idzie `terms.body`, i żadnego składania znaczników ze stringów. Formatowanie
 * (data po polsku, „Tak"/„Nie", separator tysięcy) należy do wołającego —
 * dokładnie jak daty zamówienia, wzorzec 8a.
 *
 * Wołający podaje WYŁĄCZNIE pola z flagą „umowa" i WYŁĄCZNIE niepuste: pusta
 * wartość ma nie zostawić sierocej etykiety, a pusty zestaw — pustej sekcji.
 */
export interface ContractCustomField {
  label: string;
  value: string;
}

export interface ContractPdfProps {
  locale: "en" | "pl";
  tenant: {
    name: string;
    address: string;
    nip: string | null;
    email: string;
    /**
     * ZNAK FIRMY NAJEMCY (ADR-175) — bajty, nigdy adres; szczegóły w `logo.ts`.
     *
     * Pominięcie jest stanem NORMALNYM i znaczy dokładnie tyle, co dziś:
     * nagłówek pokazuje nazwę najemcy tekstem, a dokument jest co do znaku
     * taki sam jak przed tą zmianą. Wołający pomija to pole zarówno wtedy, gdy
     * najemca znaku nie ma, jak i wtedy, gdy pliku nie udało się pobrać —
     * dla dokumentu obie odpowiedzi są tą samą odpowiedzią.
     */
    logo?: ContractLogo;
  };
  customer: { fullName: string; address: string | null; email: string };
  order: { number: string; startDate: string; endDate: string; days: number };
  items: {
    name: string;
    serialNumber: string | null;
    rentalGrosze: number;
    depositGrosze: number;
    /** Pola własne PRODUKTU — drukowane pod pozycją, której dotyczą. */
    customFields?: ContractCustomField[];
  }[];
  totals: {
    rentalGrosze: number;
    depositGrosze: number;
    deliveryGrosze: number;
    currency: string;
  };
  /**
   * Pola własne klienta i zamówienia z flagą „umowa".
   *
   * Pominięcie (albo dwie puste listy) znaczy: sekcji dodatkowej NIE MA
   * w dokumencie w ogóle — i numeracja paragrafów tego nie zauważa. Umowa
   * najemcy, który pól własnych nie założył, wygląda co do znaku tak samo jak
   * przed tą zmianą.
   */
  customFields?: { customer?: ContractCustomField[]; order?: ContractCustomField[] };
  terms: { version: string; body: string };
}

export type ContractLocale = ContractPdfProps["locale"];
