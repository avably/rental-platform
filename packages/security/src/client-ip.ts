/**
 * Wyprowadzenie IP klienta do klucza rate-limitu (L2, ADR-106).
 *
 * PROBLEM: goły `headers().get("x-forwarded-for")` jest podrabialny — klient
 * może przysłać własny nagłówek i dostawać świeży licznik na każde żądanie
 * (albo resetować cudzy). Limit po IP przestaje wtedy istnieć.
 *
 * MODEL ZAUFANIA (kolejność świadoma):
 *  1. `x-real-ip` — na naszym hostingu (Vercel) ustawiany/nadpisywany przez
 *     platformę na brzegu; wartość od klienta nie przechodzi. Pierwszy wybór.
 *  2. `x-forwarded-for` — OSTATNI wpis listy. Każdy hop DOKLEJA adres, z
 *     którego faktycznie odebrał połączenie, na koniec listy; wpisy z lewej
 *     strony to deklaracje klienta (podrabialne), wpis ostatni pochodzi od
 *     najbliższego zaufanego proxy. Podrobiony prefiks nie zmienia więc
 *     klucza limitu.
 *  3. Brak obu nagłówków (dev bez proxy, testy) → "unknown" — wspólny
 *     kubełek; świadomie ostrzejszy niż osobne klucze, bo nie do podrobienia.
 *
 * OSOBNY entrypoint (`@avably/security/client-ip`): moduł nie potrzebuje
 * Next.js, a czytają go akcje serwerowe obu aplikacji.
 */

/** Minimalny odczyt nagłówków — pasuje do next/headers i do Map w testach. */
export interface HeaderReader {
  get(name: string): string | null | undefined;
}

export function clientIpFromHeaders(headers: HeaderReader): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    const lastHop = hops[hops.length - 1];
    if (lastHop) return lastHop;
  }

  return "unknown";
}
