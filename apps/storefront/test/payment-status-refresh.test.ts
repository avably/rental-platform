/**
 * Zegar ekranu oczekiwania (F1, ADR-137) — trzy własności, każda z osobnym
 * powodem istnienia:
 *
 *   1. zegar PROSI o świeży render co interwał — bez tego klient BLIK/P24
 *      patrzy na prawdziwy, ale nieaktualny ekran „sprawdzamy", aż sam
 *      wciśnie F5 (webhook domyka płatność poza jego przeglądarką);
 *   2. zegar MILKNIE po limicie prób — porzucona karta nie może odpytywać
 *      serwera (a serwer — dostawcy) bez końca;
 *   3. funkcja sprzątająca zatrzymuje zegar NATYCHMIAST — unmount strony
 *      (nawigacja, zmiana stanu na `paid`) nie zostawia tykającego interwału.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PAYMENT_STATUS_REFRESH_ATTEMPT_LIMIT,
  PAYMENT_STATUS_REFRESH_INTERVAL_MS,
  startPaymentStatusRefresh,
} from "@/lib/checkout/status-refresh";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("zegar ekranu oczekiwania na płatność", () => {
  it("prosi o świeży render co interwał", () => {
    const refresh = vi.fn();
    const stop = startPaymentStatusRefresh(refresh);

    // Przed pierwszym pełnym interwałem — cisza (zero natychmiastowego
    // odpytania: serwer właśnie wyrenderował tę stronę).
    vi.advanceTimersByTime(PAYMENT_STATUS_REFRESH_INTERVAL_MS - 1);
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3 * PAYMENT_STATUS_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(4);

    stop();
  });

  it("milknie po limicie prób i nie odpytuje w nieskończoność", () => {
    const refresh = vi.fn();
    startPaymentStatusRefresh(refresh);

    // Dwukrotność limitu: gdyby ograniczenia nie było, licznik poszedłby
    // dalej — asercja równości na LIMICIE wykrywa i brak limitu, i limit
    // przesunięty mutacją.
    vi.advanceTimersByTime(
      2 * PAYMENT_STATUS_REFRESH_ATTEMPT_LIMIT * PAYMENT_STATUS_REFRESH_INTERVAL_MS,
    );

    expect(refresh).toHaveBeenCalledTimes(PAYMENT_STATUS_REFRESH_ATTEMPT_LIMIT);
  });

  it("funkcja sprzątająca zatrzymuje zegar natychmiast", () => {
    const refresh = vi.fn();
    const stop = startPaymentStatusRefresh(refresh);

    vi.advanceTimersByTime(PAYMENT_STATUS_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    stop();

    vi.advanceTimersByTime(10 * PAYMENT_STATUS_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
