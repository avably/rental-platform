/**
 * Stałe storefrontu (2.4b).
 *
 * TERMS_VERSION: wersja regulaminu utrwalana na zamówieniu (orders.terms_version,
 * ADR-042). Backend 2.4a nie narzuca konkretnej wartości — waliduje tylko
 * długość 1..100 — a repo nie miało wcześniej konwencji wersjonowania regulaminu.
 * Przyjmujemy '1.0' jako start; gdy pojawi się właściwy rejestr wersji regulaminu
 * (osobne zadanie), podmieni się to źródło bez zmiany kontraktu wejścia.
 */
export const STOREFRONT_TERMS_VERSION = "1.0";
