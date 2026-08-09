import type { ContractLocale } from "./types";

/**
 * Etykiety dokumentu (nagłówki sekcji, nazwy pól, stopka) w obu językach.
 *
 * Treść WARUNKÓW najmu przychodzi z zewnątrz w `terms.body` — tu żyją wyłącznie
 * stałe etykiety samego formularza umowy. `Record<ContractLocale, …>` gwarantuje,
 * że brak tłumaczenia to błąd kompilacji, nie pusty string na produkcji.
 */
export interface ContractLabels {
  documentTitle: string;
  parties: string;
  lessor: string;
  lessee: string;
  company: string;
  taxId: string;
  email: string;
  fullName: string;
  address: string;
  subject: string;
  serialNumber: string;
  itemRental: string;
  itemDeposit: string;
  noItems: string;
  period: string;
  startDate: string;
  endDate: string;
  days: string;
  charges: string;
  rentalFee: string;
  deposit: string;
  delivery: string;
  terms: string;
  termsVersion: string;
  generatedNote: string;
  /** Sekcja pól własnych najemcy (C6-A2). */
  additionalDetails: string;
  customerDetails: string;
  orderDetails: string;
}

export const CONTRACT_LABELS: Record<ContractLocale, ContractLabels> = {
  pl: {
    documentTitle: "UMOWA NAJMU",
    parties: "Strony umowy",
    lessor: "Wynajmujący",
    lessee: "Najemca",
    company: "Firma",
    taxId: "NIP",
    email: "E-mail",
    fullName: "Imię i nazwisko",
    address: "Adres",
    subject: "Przedmiot najmu",
    serialNumber: "Nr seryjny",
    itemRental: "Najem",
    itemDeposit: "Kaucja",
    noItems: "Brak pozycji w zamówieniu.",
    period: "Okres najmu",
    startDate: "Rozpoczęcie",
    endDate: "Zakończenie",
    days: "Liczba dni",
    charges: "Wynagrodzenie i kaucja",
    rentalFee: "Opłata za najem",
    deposit: "Kaucja zwrotna",
    delivery: "Dostawa",
    terms: "Regulamin najmu",
    termsVersion: "Wersja",
    generatedNote: "Dokument wygenerowany automatycznie",
    additionalDetails: "Dane dodatkowe",
    customerDetails: "Klient",
    orderDetails: "Zamówienie",
  },
  en: {
    documentTitle: "RENTAL AGREEMENT",
    parties: "Parties",
    lessor: "Lessor",
    lessee: "Lessee",
    company: "Company",
    taxId: "Tax ID",
    email: "Email",
    fullName: "Full name",
    address: "Address",
    subject: "Rented items",
    serialNumber: "Serial no.",
    itemRental: "Rental",
    itemDeposit: "Deposit",
    noItems: "No items in the order.",
    period: "Rental period",
    startDate: "Start",
    endDate: "End",
    days: "Days",
    charges: "Charges and deposit",
    rentalFee: "Rental fee",
    deposit: "Refundable deposit",
    delivery: "Delivery",
    terms: "Rental terms",
    termsVersion: "Version",
    generatedNote: "Document generated automatically",
    additionalDetails: "Additional details",
    customerDetails: "Customer",
    orderDetails: "Order",
  },
};
