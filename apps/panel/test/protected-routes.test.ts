/**
 * Bramka CI: KAŻDA chroniona trasa panelu odsyła anonima na logowanie — i to
 * na logowanie w JEGO języku.
 *
 * Guard nie siedzi w layoucie (patrz app/[locale]/(superadmin)/layout.tsx):
 * każda strona woła go u siebie. To znaczy, że nowa strona bez guarda jest
 * cicho publiczna — nic jej nie łapie: ani typy, ani build. Ten plik jest
 * jedynym miejscem, które to wyłapie.
 *
 * LISTA TRAS POWSTAJE Z INTROSPEKCJI, NIE Z RĘCZNEGO WYLICZENIA (1.5.7).
 * Do tej pory trasy były wpisywane ręcznie i bramka po cichu przestała pilnować
 * PIĘCIU z nich (`/strona`, `/ustawienia-emaili`, `/ustawienia-dostaw`,
 * `/historia-emaili`, `/katalog/[id]/zdjecia`) — każda miała własny guard, ale
 * nikt tego nie sprawdzał, więc następna trasa mogła wjechać bez ochrony przy
 * zielonej bramce. Lista, którą trzeba PAMIĘTAĆ o uzupełnieniu, jest dokładnie
 * tak dobra jak pamięć autora PR-a.
 *
 * Teraz `import.meta.glob` zbiera wszystkie strony spod `app/[locale]`, a
 * domyślność jest odwrócona: trasa jest chroniona, chyba że stoi na jawnej
 * liście PUBLIC_ROUTES niżej. Nowa strona bez guarda pali ten test sama z
 * siebie. Zwolnienie jej z wymogu nadal jest możliwe, ale kosztuje ŚWIADOMĄ
 * linię w teście bezpieczeństwa — a to jest dokładnie ta decyzja, którą
 * recenzent ma zobaczyć w diffie.
 *
 * Testowane bez Supabase (klient zamockowany na „brak sesji"), więc bramka
 * działa w jobie `ci`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/lib/auth";

/**
 * `import.meta.glob` dostarcza Vite (a więc i Vitest) w czasie transformacji.
 * Typ deklarujemy tu punktowo, zamiast wciągać `vite/client` do `types`
 * tsconfiga panelu: Vite nie jest zależnością aplikacji, tylko runnera testów,
 * a globalne typy z jego pakietu (`ImportMetaEnv`, moduły `*.svg` itd.)
 * rozlałyby się na cały build produkcyjny.
 */
declare global {
  interface ImportMeta {
    glob<T>(pattern: string): Record<string, () => Promise<T>>;
  }
}

let currentLocale = "pl";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}
class NotFoundSignal extends Error {}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  permanentRedirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new NotFoundSignal("NOT_FOUND");
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => currentLocale,
  // Strony wołają tłumaczenia dopiero PO guardzie — gdyby któraś zawołała je
  // wcześniej, ta atrapa i tak nie przepuści testu na zielono przez przypadek.
  getTranslations: async () => (key: string) => key,
}));

/** Sesji nie ma: getClaims zwraca pustkę, guardy rzucają 401. */
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: null, error: null }),
      mfa: { listFactors: async () => ({ data: { totp: [] } }) },
    },
  }),
  requireMember: async () => {
    throw new AuthError(401, "Wymagane zalogowanie.");
  },
  requireSuperadmin: async () => {
    throw new AuthError(401, "Wymagane zalogowanie.");
  },
}));

/**
 * Trasy ŚWIADOMIE publiczne — jedyne miejsce, gdzie wolno zdjąć wymóg guarda.
 * Każdy wpis niesie powód, więc wpis bez powodu jest sam w sobie sygnałem.
 */
const PUBLIC_ROUTES = new Map<string, string>([
  ["/login", "ekran logowania — z definicji dla niezalogowanych"],
  ["/register", "rejestracja konta — j.w."],
  ["/register/sprawdz-skrzynke", "potwierdzenie wysyłki maila rejestracyjnego, zero danych"],
  ["/reset", "prośba o reset hasła — użytkownik nie ma jak się zalogować"],
  ["/reset/confirm", "ustawienie nowego hasła z linku e-mail (sesja recovery)"],
  ["/design-system", "galeria komponentów @avably/ui — statyczna, zero danych tenanta"],
]);

/**
 * Wszystkie strony panelu. Wzorzec `../app/*` zamiast dosłownego `[locale]`:
 * nawiasy kwadratowe w globie znaczyłyby klasę znaków, a jedynym katalogiem na
 * tym poziomie jest właśnie segment locale.
 */
const pageModules = import.meta.glob<{ default: (props: never) => Promise<unknown> }>(
  "../app/*/**/page.tsx",
);

/** `../app/[locale]/(superadmin)/admin/tenants/[id]/page.tsx` → `/admin/tenants/[id]`. */
function routePathOf(moduleKey: string): string {
  const trimmed = moduleKey.replace("../app/[locale]", "").replace(/\/page\.tsx$/, "");
  // Grupy tras `(nazwa)` nie istnieją w URL-u.
  const path = trimmed.replace(/\/\([^)]+\)/g, "");
  return path === "" ? "/" : path;
}

/**
 * Wartości segmentów dynamicznych. Guard biegnie PRZED jakimkolwiek użyciem
 * tych wartości, więc wystarczy poprawny kształt (uuid tam, gdzie strona
 * poda go dalej do zapytania).
 */
function paramsOf(routePath: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [, name] of routePath.matchAll(/\[([^\]]+)\]/g)) {
    params[name] = /id$/i.test(name) ? "00000000-0000-4000-8000-000000000001" : "wartosc-testowa";
  }
  return params;
}

/**
 * ROUTE HANDLERY (`route.ts`) NIE SĄ STRONAMI i glob wyżej ich nie widzi —
 * a to znaczy, że do 1.5.8 bramka nie miała o nich POJĘCIA. Endpoint dopisany
 * pod `app/api/**` byłby dla niej niewidzialny dokładnie tak, jak wcześniej
 * niewidzialne były strony bez guarda: cicho publiczny, przy zielonym CI.
 *
 * Handlerów nie da się odpytać tak jak stron (nie przekierowują anonima —
 * część z nich Z DEFINICJI obsługuje żądania bez sesji: webhook woła obcy
 * system, callback e-maila woła użytkownik, który sesji jeszcze nie ma).
 * Wymóg jest więc inny, ale równie twardy: każdy handler musi mieć w tej mapie
 * JAWNY wpis nazywający, CO go chroni. Nowy endpoint bez wpisu pali test —
 * i to jest ta linia, którą recenzent ma zobaczyć w diffie.
 */
const API_ROUTE_PROTECTION = new Map<string, string>([
  [
    "/api/jobs/product-image-uploads",
    "Cykliczne sprzątanie uploadów zdjęć (ADR-078) — endpoint nie używa " +
      "sesji operatora, bo wywołuje go harmonogram Vercel. Chroni go " +
      "Authorization: Bearer porównywany stałoczasowo z CRON_SECRET; brak " +
      "sekretu wyłącza trasę kodem 503, a brak lub zły nagłówek daje 401. " +
      "Klient service_role pozostaje wyłącznie w src/jobs/**.",
  ],
  [
    "/api/jobs/site-image-uploads",
    "Cykliczne sprzątanie uploadów zdjęć SEKCJI (0043, ADR-082) — bliźniak " +
      "crona zdjęć produktów. Endpoint nie używa sesji operatora (wywołuje go " +
      "harmonogram Vercel); chroni go Authorization: Bearer porównywany " +
      "stałoczasowo z CRON_SECRET (brak sekretu → 503, zły/brak nagłówka → 401). " +
      "Klient service_role pozostaje wyłącznie w src/jobs/**.",
  ],
  [
    "/api/jobs/payment-reconciliation",
    "Rekoncyliacja płatności utkniętych w pending (L11, ADR-104) — endpoint " +
      "nie używa sesji operatora, bo wywołuje go harmonogram. Chroni go " +
      "Authorization: Bearer porównywany stałoczasowo z CRON_SECRET (brak " +
      "sekretu → 503, zły/brak nagłówka → 401), a każdy przypadek negatywny " +
      "jest dowiedziony BRAKIEM WYWOŁANIA rdzenia, nie samym kodem odpowiedzi " +
      "(payment-reconciliation-route.test.ts). Klient service_role pozostaje " +
      "wyłącznie w src/jobs/**; stan zapisywany wyłącznie z odczytu u dostawcy, " +
      "kontem connected właściciela zamówienia.",
  ],
  [
    "/api/webhooks/supabase-email",
    "Send Email Hook Supabase Auth (ADR-048) — woła go GoTrue, nie zalogowany " +
      "operator, więc guard sesji nie ma tu zastosowania. Chroni PODPIS " +
      "(Standard Webhooks) w trybie fail-closed: brak albo zły podpis = odmowa " +
      "bez wysyłki, brak skonfigurowanego sekretu = endpoint nie działa wcale.",
  ],
  [
    "/api/webhooks/stripe",
    "Webhook płatności (Z4, ADR-067) — woła go dostawca płatności, nie " +
      "zalogowany operator, więc guard sesji nie ma tu zastosowania. Chroni " +
      "PODPIS (Stripe-Signature, HMAC-SHA256 z sekretu endpointu) w trybie " +
      "fail-closed: brak albo zły podpis = 400 i ZERO zapisu, także w rejestrze " +
      "zdarzeń; brak skonfigurowanego sekretu = endpoint nie działa wcale. " +
      "To jedyna trasa panelu pisząca payment_status='paid' — rolą service_role, " +
      "jedyną, którą baza do tego przejścia dopuszcza (migracja 0030).",
  ],
  [
    "/auth/confirm",
    "Callback linku z e-maila (potwierdzenie rejestracji i reset hasła) — " +
      "użytkownik z definicji nie ma jeszcze sesji, uwierzytelnia go " +
      "jednorazowy token_hash z wiadomości, weryfikowany przez verifyOtp.",
  ],
  [
    "/zamowienia/[id]/delivery-label",
    "Etykieta przewozowa PDF (ADR-031) — CHRONIONA SESJĄ: handler woła " +
      "requireMember() i zwraca 401 anonimowi, a przesyłkę filtruje po " +
      "zamówieniu, więc RLS domyka zasięg do własnego tenanta.",
  ],
  [
    "/ustawienia-platnosci/powrot",
    "Powrót z onboardingu KYC (ADR-065) — CHRONIONY SESJĄ: handler woła " +
      "requireMember() i odsyła anonima na logowanie. Adres nie niesie ŻADNEGO " +
      "stanu: handler nie czyta z niego parametrów, tylko wykonuje " +
      "GET /v1/accounts/{id} po stronie serwera i zapisuje wynik odczytu, " +
      "więc wklejenie go ręcznie nie ustawia gotowości konta.",
  ],
  [
    "/api/review/comments",
    "Uwagi przeglądu produktu (ADR-071) — CHRONIONY SESJĄ SUPERADMINA: " +
      "reviewGuard() wymaga REVIEW_MODE=1 w env ORAZ requireSuperadmin() " +
      "(claim + aal2); każdy inny przypadek to 404, nie 403 — narzędzie " +
      "wewnętrzne nie zdradza istnienia. Dane i Storage niezależnie domyka " +
      "RLS 0033 (app.is_superadmin()), zero service_role na tej drodze.",
  ],
  [
    "/api/review/comments/[id]",
    "Zmiana uwagi przeglądu (ADR-071) — ta sama bramka co /api/review/comments: " +
      "REVIEW_MODE=1 + sesja superadmina (reviewGuard), egzekucja w RLS 0033; " +
      "poza trybem przeglądu endpoint odpowiada 404.",
  ],
  [
    "/api/review/ingest/comments",
    "Ingest uwag przeglądu od relaya storefrontu (ADR-099/ADR-115) — endpoint " +
      "nie używa sesji operatora, bo woła go serwer storefrontu (aplikacja " +
      "publiczna bez sekretu bazy). Chroni go Authorization: Bearer " +
      "porównywany stałoczasowo z REVIEW_INGEST_TOKEN (brak sekretu → 503, " +
      "zły/brak nagłówka → 401) ORAZ bramka REVIEW_MODE po stronie panelu " +
      "(tryb wyłączony → 404 nawet z poprawnym tokenem). Każdy przypadek " +
      "negatywny dowiedziony BRAKIEM WYWOŁANIA warstwy zapisu " +
      "(review-ingest-route.test.ts). Payload przechodzi schemat @avably/review " +
      "(zamknięta lista powierzchni, obce pola wycięte), tabele 0033 są " +
      "platformowe bez tenant_id — token nie daje drogi do danych najemców.",
  ],
  [
    "/api/review/ingest/comments/[id]",
    "Zmiana uwagi przeglądu od relaya storefrontu (ADR-099/ADR-115) — ta sama " +
      "bramka co /api/review/ingest/comments: REVIEW_MODE po stronie panelu + " +
      "wspólny sekret stałoczasowo; poza trybem przeglądu 404.",
  ],
  [
    "/zamowienia/[id]/contract/[documentId]",
    "Prywatny PDF umowy (ADR-061) — handler wymaga sesji członka, filtruje " +
      "metadane po tenant_id, order_id i document_id, a RLS tabeli i Storage " +
      "niezależnie blokują cudzy dokument. Przed odpowiedzią weryfikuje SHA-256.",
  ],
  [
    "/eksport-danych/zamowienia",
    "Eksport CSV zamówień (C2, ADR-111) — CHRONIONY SESJĄ: handler woła " +
      "requireMember() PRZED odczytem formularza (anonim dostaje 401 zanim " +
      "cokolwiek się policzy), rdzeń filtruje po tenant_id niezależnie od RLS " +
      "(dowód mutacyjny M1), a POST zamiast GET trzyma parametry poza URL-em.",
  ],
  [
    "/eksport-danych/klienci",
    "Eksport CSV klientów (C2, ADR-111) — CHRONIONY SESJĄ WŁAŚCICIELA: " +
      "hurtowy zrzut danych osobowych, więc requireMember(\"owner\") w " +
      "handlerze ORAZ autorytatywna bramka roli w rdzeniu eksportu " +
      "(lib/export/customers, dowód mutacyjny M3); staff dostaje 403.",
  ],
  [
    "/eksport-danych/katalog",
    "Eksport CSV katalogu (C2, ADR-111) — CHRONIONY SESJĄ: requireMember() " +
      "przed jakąkolwiek pracą, rdzeń filtruje po tenant_id niezależnie od " +
      "RLS; zbiór nie zawiera danych osobowych (produkty i progi cenowe).",
  ],
  [
    "/ustawienia-api/wtyczka",
    "Paczka instalacyjna wtyczki WordPress (M2, ADR-110) — CHRONIONY SESJĄ: " +
      "requireMember() PRZED złożeniem odpowiedzi (anonim dostaje 401 i zero " +
      "bajtów). Zawartość jest ta sama dla każdego najemcy — to publiczny kod " +
      "wtyczki, NIE dane tenanta: paczka nie niesie klucza API ani niczego, " +
      "co zależy od organizacji (bramka zawartości w " +
      "test/wordpress-plugin-package.test.ts). Bramka sesji jest tu higieną " +
      "panelu (zero anonimowych pobrań z naszego hostingu), nie granicą " +
      "izolacji — dlatego handler nie potrzebuje roli ani filtra tenant_id.",
  ],
]);

const routeHandlerModules = import.meta.glob<unknown>("../app/**/route.ts");

/**
 * `../app/api/webhooks/supabase-email/route.ts` → `/api/webhooks/supabase-email`.
 * Segment locale zdejmowany jak w `routePathOf`, żeby ścieżki handlerów i stron
 * czytało się tak samo.
 */
function handlerPathOf(moduleKey: string): string {
  return moduleKey
    .replace("../app", "")
    .replace("/[locale]", "")
    // Grupy tras `(nazwa)` nie istnieją w URL-u — tak samo jak w `routePathOf`.
    // Bez tego handler przeniesiony do grupy `(panel)` (shell, ADR-056) miałby
    // klucz `/(panel)/…` i wypadł z klasyfikacji ochrony, mimo że jego adres
    // nie zmienił się o znak.
    .replace(/\/\([^)]+\)/g, "")
    .replace(/\/route\.ts$/, "");
}

const API_ROUTES = Object.keys(routeHandlerModules).map(handlerPathOf).sort();

const ROUTES = Object.entries(pageModules)
  .map(([moduleKey, load]) => ({ path: routePathOf(moduleKey), load }))
  .sort((a, b) => a.path.localeCompare(b.path));

const PROTECTED_ROUTES = ROUTES.filter((route) => !PUBLIC_ROUTES.has(route.path));

// Bez vi.resetModules(): reset dałby stronom ŚWIEŻY moduł @/lib/auth, a wtedy
// `err instanceof AuthError` w stronach porównywałoby dwie różne klasy o tej
// samej nazwie i nigdy nie trafiało. Moduły nie trzymają tu stanu — locale
// czyta się przez getLocale() przy każdym wywołaniu.
beforeEach(() => {
  currentLocale = "pl";
});

describe("introspekcja tras", () => {
  it("widzi strony panelu — glob nie może cicho zwrócić pustki", () => {
    // Pusty glob wygasiłby CAŁĄ bramkę bez jednego czerwonego testu: to jest
    // dokładnie ten sposób, w jaki introspekcja mogłaby maskować brak guarda.
    expect(ROUTES.length).toBeGreaterThan(20);
    expect(ROUTES.map((route) => route.path)).toContain("/zamowienia");
    expect(PROTECTED_ROUTES.length).toBeGreaterThan(15);
  });

  it("każdy wyjątek z PUBLIC_ROUTES wskazuje na istniejącą trasę", () => {
    const known = new Set(ROUTES.map((route) => route.path));
    const stale = [...PUBLIC_ROUTES.keys()].filter((path) => !known.has(path));
    expect(stale, `wyjątki wskazujące na nieistniejące trasy: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("route handlery — klasyfikacja ochrony", () => {
  it("widzi handlery — pusty glob wygasiłby tę bramkę bez czerwonego testu", () => {
    expect(API_ROUTES).toContain("/api/webhooks/supabase-email");
    expect(API_ROUTES).toContain("/auth/confirm");
  });

  it("każdy handler ma jawny wpis mówiący, co go chroni", () => {
    const unclassified = API_ROUTES.filter((path) => !API_ROUTE_PROTECTION.has(path));
    expect(
      unclassified,
      `handlery bez świadomej klasyfikacji ochrony: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("każdy wpis klasyfikacji wskazuje na istniejący handler", () => {
    const known = new Set(API_ROUTES);
    const stale = [...API_ROUTE_PROTECTION.keys()].filter((path) => !known.has(path));
    expect(stale, `klasyfikacje wskazujące na nieistniejące handlery: ${stale.join(", ")}`).toEqual(
      [],
    );
  });

  it("wpis klasyfikacji niesie POWÓD, nie samą ścieżkę", () => {
    // Wpis pusty albo jednosłowny byłby wpisem-atrapą: bramka świeciłaby na
    // zielono, a decyzja o publiczności trasy nadal nie byłaby nigdzie
    // uzasadniona — dokładnie ten sam brak, który pozwolił pięciu stronom
    // wypaść spod ochrony przed 1.5.7.
    for (const [path, reason] of API_ROUTE_PROTECTION) {
      expect(reason.length, `wpis ${path} bez uzasadnienia`).toBeGreaterThan(40);
    }
  });
});

describe.each(["pl", "en"])("chronione trasy — anonim, locale %s", (locale) => {
  beforeEach(() => {
    currentLocale = locale;
  });

  it.each(PROTECTED_ROUTES.map((route) => [route.path, route] as const))(
    "%s odsyła anonima na logowanie w jego języku",
    async (path, route) => {
      const pageModule = await route.load();
      const props = {
        params: Promise.resolve(paramsOf(path)),
        searchParams: Promise.resolve({}),
      } as never;

      let target: string | null = null;
      try {
        await pageModule.default(props);
      } catch (error) {
        if (error instanceof RedirectSignal) target = error.url;
        else throw error;
      }

      expect(target, "trasa nie przekierowała anonima — brak guarda?").not.toBeNull();
      expect(target).toMatch(new RegExp(`^/${locale}/login(\\?|$)`));
    },
    // Pierwszy import strony ciągnie za sobą cały łańcuch modułów
    // (@avably/ui itd.) — na runnerze CI potrafi przekroczyć domyślne 5 s.
    15_000,
  );
});
