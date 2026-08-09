/**
 * Granica zaufania embedu (M3, ADR-120) — kto może wołać trasy danych.
 *
 * ROZSTRZYGNIĘCIE: trasy danych embedu przyjmują WYŁĄCZNIE żądania
 * same-origin, czyli z naszej własnej ramki. Nie ma listy dozwolonych domen
 * najemcy, bo nie ma czego nią poluzować — legalny wołający jest dokładnie
 * jeden i jest nim dokument, który sami wyrenderowaliśmy. To jest polityka
 * OSTRZEJSZA niż jakakolwiek lista, a nie jej brak.
 *
 * DLACZEGO TO W OGÓLE DZIAŁA: fragment do wklejenia tworzy ramkę na naszym
 * origin. Formularz rezerwacji żyje więc w naszym dokumencie i jego `fetch`
 * jest same-origin — strona gospodarza nie ma jak przeczytać ani tego, co
 * klient wpisuje, ani odpowiedzi. Gdyby embed renderował w DOM gospodarza,
 * ta granica nie istniałaby wcale (patrz ADR-120, rozważone alternatywy).
 *
 * CZEGO TA BRAMKA NIE ROBI — i to jest wpisane w decyzję, nie przeoczone:
 * nagłówek `Origin` ustawia PRZEGLĄDARKA, więc bramka wiąże ręce przeglądarce,
 * a nie curlowi, który poda dowolną wartość. Serwerowym zabezpieczeniem przed
 * klientem spoza przeglądarki jest to, że (a) odczyty embedu wystawiają
 * dokładnie te dane, które publiczny sklep najemcy i tak pokazuje anonimowi,
 * (b) zapis idzie tym samym rdzeniem checkoutu i tym samym dławieniem co
 * storefront, (c) nie ma tu żadnego sekretu do wyniesienia. Bramka origin jest
 * warstwą higieny przeglądarkowej i deklaracją kontraktu, nie uwierzytelnieniem —
 * i tak jest opisana w ADR.
 *
 * DENY-BY-DEFAULT: brak nagłówka `Origin` to ODMOWA, nie przepustka. `fetch`
 * z metodą POST wysyła `Origin` zawsze (także same-origin), a nasz front woła
 * obie trasy przez `fetch` — więc „bez origin" nie jest przypadkiem naszego
 * klienta i nie ma powodu go wpuszczać.
 */

/** Wynik rozstrzygnięcia — rozdzielony od odpowiedzi HTTP, żeby dało się go testować bez Response. */
export type OriginDecision = { allowed: true } | { allowed: false; reason: OriginRefusal };

export type OriginRefusal = "missing" | "malformed" | "foreign";

/**
 * Autorytet, z którym porównujemy `Origin`. Bierzemy go z nagłówka `Host`
 * ŻĄDANIA, nie z konfiguracji — storefront odpowiada pod wieloma hostami
 * (subdomena najemcy, własna domena najemcy, localhost w dev) i każdy z nich
 * jest dla siebie „swój". Porównanie idzie po AUTORYTECIE (host:port), bez
 * schematu: lokalnie stoimy na http, produkcyjnie na https, a o schemat dba
 * HSTS + `upgrade-insecure-requests`, nie ta funkcja.
 */
function authorityOfOrigin(rawOrigin: string): string | null {
  try {
    const url = new URL(rawOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // `new URL("https://a.example/x")` połknąłby ścieżkę — Origin jej nie ma.
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Czy żądanie wolno obsłużyć. `null` w `hostHeader` (żądanie bez Hosta —
 * nie zdarza się w HTTP/1.1 i HTTP/2) domyka się w stronę odmowy.
 */
export function decideEmbedOrigin(
  originHeader: string | null,
  hostHeader: string | null,
): OriginDecision {
  if (originHeader === null || originHeader === "") {
    return { allowed: false, reason: "missing" };
  }
  const origin = authorityOfOrigin(originHeader);
  if (origin === null) return { allowed: false, reason: "malformed" };

  const host = (hostHeader ?? "").trim().toLowerCase();
  if (host === "") return { allowed: false, reason: "foreign" };

  return origin === host ? { allowed: true } : { allowed: false, reason: "foreign" };
}

/** Skrót dla route handlerów — czyta oba nagłówki z żądania. */
export function embedOriginAllowed(request: Request): boolean {
  return decideEmbedOrigin(
    request.headers.get("origin"),
    request.headers.get("host"),
  ).allowed;
}
