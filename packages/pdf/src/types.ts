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
export interface ContractPdfProps {
  locale: "en" | "pl";
  tenant: { name: string; address: string; nip: string | null; email: string };
  customer: { fullName: string; address: string | null; email: string };
  order: { number: string; startDate: string; endDate: string; days: number };
  items: {
    name: string;
    serialNumber: string | null;
    rentalGrosze: number;
    depositGrosze: number;
  }[];
  totals: {
    rentalGrosze: number;
    depositGrosze: number;
    deliveryGrosze: number;
    currency: string;
  };
  terms: { version: string; body: string };
}

export type ContractLocale = ContractPdfProps["locale"];
