/**
 * Nazwa ukrytego pola z nonce onboardingu Connect — KONTRAKT między
 * formularzem (`payments-panel.tsx`, klient) a akcją (`payments-actions.ts`,
 * serwer). Nonce jest świeży per render (patrz `page.tsx`) i wchodzi do klucza
 * idempotencji zakładania konta (ADR-216).
 *
 * Osobny plik z rozmysłu: `payments-config.ts` ciągnie `next/headers`, więc nie
 * wejdzie do komponentu klienckiego, a `payments-actions.ts` jest `"use server"`
 * i nie może eksportować stałej (eksport nie-async wywraca cały moduł akcji).
 * Ten plik nie ma ŻADNYCH importów, więc bezpiecznie dzielą go obie strony.
 */
export const ONBOARDING_NONCE_FIELD = "onboardingNonce";
