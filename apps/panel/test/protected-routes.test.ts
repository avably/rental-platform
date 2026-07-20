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
