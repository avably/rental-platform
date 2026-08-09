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
 * DWA SYGNAŁY, BO `Origin` NIE WYSTARCZA — i to jest lekcja z żywej strony,
 * nie teoria. Przeglądarka wysyła `Origin` na KAŻDYM żądaniu cross-origin
 * (także GET) oraz na każdym POST, ale POMIJA go przy same-origin GET. Sama
 * reguła „brak Origin = odmowa" odbijała więc odczyty NASZEJ WŁASNEJ ramki —
 * kalendarz stał na „sprawdzanie dostępności", a serwer logował 403.
 *
 * Rozstrzygnięcie:
 *   1. `Origin` obecny  → MUSI zgadzać się z hostem. Obcy = odmowa, koniec.
 *      (Ten warunek jest pierwszy, więc obce źródło nie prześlizgnie się,
 *      dokładając sobie `Sec-Fetch-Site`.)
 *   2. `Origin` nieobecny → `Sec-Fetch-Site` MUSI brzmieć `same-origin`.
 *      Ten nagłówek ustawia wyłącznie przeglądarka i kod strony nie ma jak go
 *      podrobić (`Origin` i `Sec-Fetch-*` są na liście nagłówków zabronionych).
 *   3. Żaden z dwóch → ODMOWA. Deny-by-default zostaje.
 *
 * Koszt: klient bez `Sec-Fetch-*` i bez `Origin` (przeglądarki sprzed ~2020,
 * Safari sprzed 16.4) nie obsłuży embedu. Przyjęte świadomie — alternatywą
 * było wpuszczanie żądań, o których nie wiemy nic.
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
  fetchSiteHeader: string | null = null,
): OriginDecision {
  const host = (hostHeader ?? "").trim().toLowerCase();

  if (originHeader !== null && originHeader !== "") {
    const origin = authorityOfOrigin(originHeader);
    if (origin === null) return { allowed: false, reason: "malformed" };
    if (host === "") return { allowed: false, reason: "foreign" };
    return origin === host ? { allowed: true } : { allowed: false, reason: "foreign" };
  }

  // Brak Origin — jedyny legalny przypadek to same-origin GET z naszej ramki.
  if (fetchSiteHeader === "same-origin") return { allowed: true };

  return { allowed: false, reason: "missing" };
}

/** Skrót dla route handlerów — czyta komplet nagłówków rozstrzygających. */
export function embedOriginAllowed(request: Request): boolean {
  return decideEmbedOrigin(
    request.headers.get("origin"),
    request.headers.get("host"),
    request.headers.get("sec-fetch-site"),
  ).allowed;
}
