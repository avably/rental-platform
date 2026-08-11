/**
 * Zegar ekranu oczekiwania na płatność (F1, ADR-137) — czysta logika, bez
 * Reacta i bez DOM, żeby reguła miała test (wzorzec payment-status-view.ts).
 *
 * PO CO: metody asynchroniczne (BLIK — push w aplikacji banku, P24 — powrót
 * z przekierowania przed potwierdzeniem rozliczeniowym) domykają się
 * webhookiem POZA przeglądarką klienta. Strona statusu w stanie „sprawdzamy"
 * ma więc prosić serwer o świeży render, zamiast kazać klientowi wciskać F5.
 *
 * CZEGO TU NIE MA (ADR-049): żadnego stanu płatności i żadnej drogi, żeby
 * powstał. Jedyną akcją jest wywołanie `refresh` — u wołającego to
 * `router.refresh()`, czyli PONOWNY render na serwerze, gdzie werdykt jak
 * zawsze bierze się z naszej bazy.
 *
 * LIMIT PRÓB zamiast pętli bez końca: porzucona karta nie może odpytywać
 * serwera (a serwer — dostawcy, bo strona statusu wykonuje odczyt intentu)
 * do końca świata. Po limicie zegar cichnie; klient ma na ekranie stały
 * link „Sprawdź stan płatności".
 */

/** Co ile prosić serwer o świeży render. */
export const PAYMENT_STATUS_REFRESH_INTERVAL_MS = 5_000;

/**
 * Ile razy najwyżej. 60 × 5 s = 5 minut — BLIK potwierdza się w minutę,
 * P24 w kilka; dłuższe czekanie i tak kończy się ręcznym sprawdzeniem.
 */
export const PAYMENT_STATUS_REFRESH_ATTEMPT_LIMIT = 60;

/**
 * Uruchamia zegar i zwraca funkcję sprzątającą (dla `useEffect`).
 *
 * Licznik prób żyje w domknięciu: odświeżenie nie ma prawa powodować
 * re-renderu komponentu, który zegar trzyma — jedyny render, o który tu
 * chodzi, robi serwer.
 */
export function startPaymentStatusRefresh(refresh: () => void): () => void {
  let attempts = 0;
  const timer = setInterval(() => {
    if (attempts >= PAYMENT_STATUS_REFRESH_ATTEMPT_LIMIT) {
      clearInterval(timer);
      return;
    }
    attempts += 1;
    refresh();
  }, PAYMENT_STATUS_REFRESH_INTERVAL_MS);

  return () => clearInterval(timer);
}
