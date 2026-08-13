/**
 * RATE LIMIT JEST JEDYNĄ OBRONĄ LOGOWANIA — sonda bezpieczeństwa ADR-164.
 *
 * Od chwili, w której z logowania zszedł Turnstile, pod formularzem hasła nie
 * stoi już nic poza tym licznikiem. Dotąd wystarczało zdanie „limit jest
 * w kodzie": obok stała CAPTCHA, więc pomyłka w progu kosztowałaby mniej.
 * Teraz pomyłka w progu to otwarta zgadywanka haseł, dlatego ten plik NIE
 * mierzy wywołań limitera — mierzy JEGO ZACHOWANIE.
 *
 * CO JEST PRAWDZIWE, A CO ATRAPĄ. `@avably/security/rate-limit` jest tu
 * PRAWDZIWY (świadomie bez `vi.mock` — inaczej test sprawdzałby własną
 * atrapę), tak samo `@avably/security/client-ip` i cała akcja logowania.
 * Zamockowana jest wyłącznie granica sieci: dostawca auth, tłumaczenia
 * i nagłówki żądania.
 *
 * DLACZEGO LICZNIK IDZIE W PAMIĘĆ, NIE W BAZĘ. `checkRateLimit` schodzi na
 * licznik in-memory, gdy nie ma konfiguracji bazy — i to jest jedyna ścieżka,
 * w której ten test jest deterministyczny. Konfiguracja jest tu WYGASZANA
 * jawnie (`vi.stubEnv` niżej), bo job `rls` w CI ustawia `SUPABASE_LOCAL_*`
 * i bez tego kubełki lądowałyby w bazie WSPÓŁDZIELONEJ z innymi suitami:
 * wynik zależałby od tego, kto zdążył się wcześniej zalogować. Mechanika
 * okna jest ta sama w obu backendach (stałe okno, licznik na klucz), więc
 * mierzymy regułę, a nie transport.
 *
 * OSOBNO DLA KAŻDEGO WYMIARU — i to jest sedno. Progi są dwa (10/min na IP,
 * 5/min na adres) i pilnują dwóch różnych ataków: rozproszonego po kontach
 * z jednego łącza i rozproszonego po łączach na jedno konto. Test, który
 * dobija oba naraz, nie odróżni działającego limitu od jednego działającego
 * i jednego martwego. Każdy przypadek nasyca WYŁĄCZNIE swój wymiar:
 *   • wymiar IP  — jedno IP, za każdym razem INNY adres (kubełek konta = 1),
 *   • wymiar konta — jeden adres, za każdym razem INNE IP (kubełek IP = 1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import pl from "../messages/pl.json";

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  permanentRedirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "pl",
  getTranslations: async (namespace: string) => (key: string) => {
    const dictionary = (pl as unknown as Record<string, Record<string, string>>)[namespace];
    const value = dictionary?.[key];
    if (!value) throw new Error(`Brak klucza ${namespace}.${key} w messages/pl.json`);
    return value;
  },
}));

/** Nagłówki żądania — sterowane per żądanie (różne IP w wymiarze konta). */
let currentHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => currentHeaders,
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

/** Dostawca auth — logowanie zawsze „udane", żeby liczyła się tylko bramka. */
const signInWithPassword = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithPassword } }),
}));
vi.mock("@/lib/auth", () => ({ getAuthContext: async () => null }));

const { loginAction } = await import("@/app/[locale]/(auth)/login/actions");
const { __resetMemoryRateLimitForTests } = await import("@avably/security/rate-limit");

const TOO_MANY = pl.authError.tooManyRequests;

/** Progi z ADR-106 — przepisane tu świadomie, żeby zmiana bolała w teście. */
const LIMIT_PER_IP = 10;
const LIMIT_PER_EMAIL = 5;

type Outcome = "przeszło" | { error?: string };

/** Jedno żądanie logowania z zadanego IP na zadany adres. */
async function attempt(ip: string, email: string): Promise<Outcome> {
  currentHeaders = new Map([["x-real-ip", ip]]);
  const form = new FormData();
  form.set("email", email);
  form.set("password", "Haslo!12345678");
  try {
    return (await loginAction({}, form)) as Outcome;
  } catch (error) {
    if (error instanceof RedirectSignal) return "przeszło";
    throw error;
  }
}

beforeEach(() => {
  // Bez tego licznik in-memory jest współdzielony między przypadkami
  // (mapa modułu), a kolejność wykonania decydowałaby o wyniku.
  __resetMemoryRateLimitForTests();
  signInWithPassword.mockClear();
  // Wygaszenie konfiguracji bazy — patrz docblock. Puste stringi, bo
  // `firstNonEmptyEnv` traktuje "" jak brak.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_LOCAL_API_URL", "");
  vi.stubEnv("VERCEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("wymiar IP: 10 prób na minutę z jednego łącza", () => {
  it("dziesiąta próba przechodzi, jedenasta jest ODRZUCONA", async () => {
    const ip = "198.51.100.10";
    // Za każdym razem INNY adres — kubełek konta zostaje na 1 z 5, więc
    // odcięcie może pochodzić WYŁĄCZNIE z wymiaru IP.
    for (let i = 1; i < LIMIT_PER_IP; i += 1) {
      expect(await attempt(ip, `kto-${i}@test.local`), `próba ${i} odcięta przedwcześnie`).toBe(
        "przeszło",
      );
    }

    // KONTROLA POZYTYWNA: ostatnia próba MIEŚCI się w oknie. Bez niej test
    // byłby zielony także dla limitu ustawionego na 1 — czyli mierzyłby
    // „cokolwiek blokuje", a nie „blokuje po dziesiątej".
    expect(
      await attempt(ip, `kto-${LIMIT_PER_IP}@test.local`),
      "limit odciął PRZED progiem z ADR-106",
    ).toBe("przeszło");

    const overLimit = await attempt(ip, `kto-${LIMIT_PER_IP + 1}@test.local`);
    expect(overLimit, "jedenaste żądanie z tego samego IP przeszło — limit IP nie działa").toEqual({
      error: TOO_MANY,
    });
  });

  it("po odcięciu limitem NIC nie idzie do dostawcy auth", async () => {
    const ip = "198.51.100.11";
    for (let i = 1; i <= LIMIT_PER_IP; i += 1) await attempt(ip, `kto-${i}@test.local`);
    signInWithPassword.mockClear();

    await attempt(ip, "kto-nowy@test.local");

    // Odcięcie MUSI być przed dostawcą: inaczej odrzucone żądanie i tak
    // sprawdza hasło, a różnica czasu odpowiedzi zdradza istnienie konta.
    expect(signInWithPassword, "odcięte żądanie i tak poszło sprawdzić hasło").not.toHaveBeenCalled();
  });

  it("inne IP ma WŁASNY kubełek — odcięcie nie jest globalne", async () => {
    const zajete = "198.51.100.12";
    for (let i = 1; i <= LIMIT_PER_IP + 1; i += 1) await attempt(zajete, `kto-${i}@test.local`);
    expect(await attempt(zajete, "jeszcze@test.local")).toEqual({ error: TOO_MANY });

    // Gdyby licznik zliczał wszystko do jednego worka, jedno łącze
    // wyłączałoby logowanie CAŁEMU światu — to nie jest limit, to awaria.
    expect(await attempt("203.0.113.99", "kto-inny@test.local")).toBe("przeszło");
  });

  it("okno jest MINUTOWE — po jego upływie licznik rusza od nowa", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T09:00:00Z"));
    const ip = "198.51.100.13";
    for (let i = 1; i <= LIMIT_PER_IP + 1; i += 1) await attempt(ip, `kto-${i}@test.local`);
    expect(await attempt(ip, "zablokowany@test.local")).toEqual({ error: TOO_MANY });

    // 61 s później: to ma być dławienie, nie dożywotnia blokada konta/łącza.
    vi.setSystemTime(new Date("2026-08-13T09:01:01Z"));
    expect(await attempt(ip, "po-oknie@test.local"), "okno limitu nigdy się nie zamyka").toBe(
      "przeszło",
    );
  });
});

describe("wymiar konta: 5 prób na minutę na jeden adres", () => {
  it("piąta próba przechodzi, szósta jest ODRZUCONA — mimo INNEGO IP za każdym razem", async () => {
    const email = "ofiara@test.local";
    // Każde żądanie z innego łącza: kubełek IP zostaje na 1 z 10, więc
    // odcięcie może pochodzić WYŁĄCZNIE z wymiaru konta. To jest atak, który
    // CAPTCHA i tak by nie zatrzymała, a limit IP sam z siebie przepuszcza.
    for (let i = 1; i < LIMIT_PER_EMAIL; i += 1) {
      expect(await attempt(`203.0.113.${i}`, email), `próba ${i} odcięta przedwcześnie`).toBe(
        "przeszło",
      );
    }

    // KONTROLA POZYTYWNA — jak wyżej: próg jest przy piątej, nie „gdziekolwiek".
    expect(
      await attempt(`203.0.113.${LIMIT_PER_EMAIL}`, email),
      "limit odciął PRZED progiem z ADR-106",
    ).toBe("przeszło");

    const overLimit = await attempt(`203.0.113.${LIMIT_PER_EMAIL + 1}`, email);
    expect(
      overLimit,
      "szóste żądanie na ten sam adres przeszło — limit kontowy nie działa",
    ).toEqual({ error: TOO_MANY });
  });

  it("wielkość liter nie rozbija kubełka — kluczem jest adres znormalizowany", async () => {
    const warianty = [
      "Ofiara@Test.Local",
      "OFIARA@TEST.LOCAL",
      "ofiara@test.local",
      "  ofiara@test.local  ",
      "oFiArA@tEsT.lOcAl",
    ];
    for (const [index, wariant] of warianty.entries()) {
      expect(await attempt(`203.0.113.${100 + index}`, wariant)).toBe("przeszło");
    }

    // Szósty wariant tego samego adresu — gdyby klucz brał surowy tekst
    // z formularza, atakujący dostawałby świeży licznik za samą zmianę
    // wielkości liter.
    expect(
      await attempt("203.0.113.200", "ofiara@TEST.local"),
      "zmiana wielkości liter dała świeży kubełek limitu",
    ).toEqual({ error: TOO_MANY });
  });

  it("po odcięciu adresu NIC nie idzie do dostawcy auth", async () => {
    const email = "ofiara2@test.local";
    for (let i = 1; i <= LIMIT_PER_EMAIL; i += 1) await attempt(`203.0.113.${i}`, email);
    signInWithPassword.mockClear();

    await attempt("203.0.113.77", email);

    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("inny adres ma WŁASNY kubełek — odcięcie nie zamyka logowania wszystkim", async () => {
    const email = "ofiara3@test.local";
    for (let i = 1; i <= LIMIT_PER_EMAIL + 1; i += 1) await attempt(`203.0.113.${i}`, email);
    expect(await attempt("203.0.113.60", email)).toEqual({ error: TOO_MANY });

    expect(await attempt("203.0.113.61", "ktos.inny@test.local")).toBe("przeszło");
  });
});

describe("odpowiedź po odcięciu nie zdradza, KTÓRY wymiar strzelił", () => {
  it("odcięcie po IP i odcięcie po adresie brzmią identycznie", async () => {
    const poIp = await (async () => {
      const ip = "198.51.100.20";
      for (let i = 1; i <= LIMIT_PER_IP; i += 1) await attempt(ip, `kto-${i}@test.local`);
      return attempt(ip, "kolejny@test.local");
    })();

    __resetMemoryRateLimitForTests();

    const poAdresie = await (async () => {
      const email = "ofiara4@test.local";
      for (let i = 1; i <= LIMIT_PER_EMAIL; i += 1) await attempt(`203.0.113.${i}`, email);
      return attempt("203.0.113.50", email);
    })();

    expect(poIp).toEqual({ error: TOO_MANY });
    expect(poAdresie, "komunikat zdradza, który limit strzelił (enumeracja kont)").toEqual(poIp);
  });
});
