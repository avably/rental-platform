/**
 * POWŁOKA SKLEPU JEDZIE TOREM NAJEMCY, NIE KOPERTĄ STRONY GŁÓWNEJ
 * (ADR-171, migracja 0079; wada K2 z audytu kreatora 2026-08-13).
 *
 * ==================== CZEGO PILNUJE TEN PLIK ====================
 *
 *   1. STAN DOMYŚLNY NOWEGO NAJEMCY — opublikowana PODSTRONA przy
 *      nieopublikowanej stronie głównej daje znak firmy i wybrany motyw.
 *      To jest przypadek, dla którego cała ta zmiana powstała: do 0079
 *      koperta strony głównej była pusta, a razem z nią znikał znak, motyw,
 *      akcent i kroje — na KAŻDEJ trasie sklepu, nie tylko pod `/`;
 *   2. NAJEMCA BEZ ANI JEDNEJ OPUBLIKOWANEJ STRONY też ma powłokę — trasy
 *      koszyka, kasy i dokumentów prawnych nie mają wiersza `sites` w ogóle,
 *      więc kopertą nie dało się ich obsłużyć nawet teoretycznie;
 *   3. ODCZYT IDZIE PO NAJEMCY Z NAGŁÓWKA — wywołanie RPC dostaje dokładnie
 *      ten identyfikator, który proxy wstrzyknęło, i żaden inny (bramka
 *      izolacji po stronie sklepu; bramka w bazie ma własny dowód mutacyjny
 *      w packages/db/test/tenant-appearance-read.test.ts);
 *   4. FAIL-SOFT — nieudany odczyt powłoki znaczy „sklep wygląda domyślnie",
 *      a nie „sklep nie działa": powłoka nie jest bramką dostępu do niczego;
 *   5. STOPKA ZOSTAJE PRZY STRONIE GŁÓWNEJ (ADR-154) — ta zmiana rozdziela
 *      wyłącznie tę część powłoki, której właścicielem jest NAJEMCA.
 *
 * ==================== NA CZYM TO MIERZYMY ====================
 *
 * Na PRODUKCYJNEJ drodze: atrapą jest klient Supabase, a nie kontekst. Test
 * przejeżdża prawdziwe `loadStorefrontContext` → `getTenantAppearance` →
 * `parseTenantAppearance` → `tenantAppearanceStyle` → `storeLogo`, czyli
 * dokładnie ten łańcuch, którym trasa składa powłokę. Atrapa kontekstu
 * dowodziłaby wyłącznie tego, że atrapa ma pole, które jej wpisano.
 */
import { DEFAULT_SITE_STYLE } from "@avably/core/site";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OBCY_TENANT = "22222222-2222-4222-8222-222222222222";
const UPLOAD = "33333333-3333-4333-8333-333333333333";
const LOGO_PATH = `${TENANT}/logo/${UPLOAD}.png`;
const SUPABASE_URL = "https://przyklad.supabase.co";

/** Wygląd spoza domyślnego motywu — widoczny w rozstrzygnięciu co do pola. */
const MOTYW = "noir-lux";
const AKCENT = "champagne";

/** Wywołania RPC w kolejności — bramka izolacji jest asercją o argumentach. */
let rpcCalls: { fn: string; args: unknown }[] = [];
/** Odpowiedzi per nazwa funkcji; brak wpisu = `{ data: null, error: null }`. */
let rpcAnswers: Record<string, { data: unknown; error: unknown }> = {};

const headerStore = { tenantId: TENANT as string | null };

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) => (name === "x-tenant-id" ? headerStore.tenantId : null),
    }),
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({
      schema: (name: string) => {
        if (name !== "app") throw new Error(`nieoczekiwany schemat: ${name}`);
        return {
          rpc: (fn: string, args: unknown) => {
            rpcCalls.push({ fn, args });
            return Promise.resolve(rpcAnswers[fn] ?? { data: null, error: null });
          },
        };
      },
    }),
}));

vi.mock("@/lib/checkout/catalog", () => ({
  getPublicCatalog: () =>
    Promise.resolve({
      tenant: { name: "Wypożyczalnia Kontrolna", locale: "pl", currency: "PLN" },
      custom_fields: [],
      categories: [],
      products: [],
      pickup_locations: [],
      delivery_methods: [],
    }),
}));

vi.mock("@/lib/legal/published", () => ({
  getPublishedLegalDocuments: () => Promise.resolve([]),
}));

/** Koperta powłoki najemcy — dokładnie to, co oddaje `app.get_tenant_appearance`. */
function powloka(overrides: Record<string, unknown> = {}) {
  return {
    template: "classic",
    style: { theme: MOTYW, accent: AKCENT },
    logo: { path: LOGO_PATH, inFooter: true },
    ...overrides,
  };
}

/** Koperta strony — po 0079 sklep bierze z niej TREŚĆ i stopkę, nie powłokę. */
function stronaGlowna() {
  return {
    template: "classic",
    published_at: "2026-08-13T10:00:00+00:00",
    sections: [
      { id: "44444444-4444-4444-8444-444444444444", type: "hero", position: 0, content: { heading: "Witaj" } },
    ],
  };
}

async function loadContext() {
  // Świeży import na KAŻDY przypadek: `loadStorefrontContext` jest owinięte
  // `cache` (per-żądanie), więc moduł zapamiętany między przypadkami oddawałby
  // wynik poprzedniego zestawu odpowiedzi i test mierzyłby własną atrapę.
  vi.resetModules();
  const { loadStorefrontContext } = await import("@/lib/storefront/context");
  return loadStorefrontContext();
}

beforeEach(() => {
  rpcCalls = [];
  rpcAnswers = {};
  headerStore.tenantId = TENANT;
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("najemca z opublikowaną PODSTRONĄ i nieopublikowaną stroną główną", () => {
  beforeEach(() => {
    // Stan domyślny nowego najemcy: strona główna NIE jest opublikowana, więc
    // `app.get_published_page(tenant, '')` oddaje NULL. Wygląd i znak leżą
    // w wierszu najemcy i są opublikowane.
    rpcAnswers.get_tenant_appearance = { data: powloka(), error: null };
    rpcAnswers.get_published_page = { data: null, error: null };
  });

  it("WIDZI ZNAK FIRMY — mimo pustej koperty strony głównej", async () => {
    const ctx = await loadContext();
    const { storeLogo } = await import("@/lib/site/store-logo");

    expect(ctx, "brak kontekstu — dowód po pustym zbiorze").not.toBeNull();
    expect(ctx!.site, "kontrola pozytywna: strona główna MA być nieopublikowana").toBeNull();

    const logo = storeLogo(ctx!);
    expect(logo, "znak zniknął razem z nieopublikowaną stroną główną").not.toBeNull();
    expect(logo!.src).toContain(LOGO_PATH);
    expect(logo!.alt).toBe("Wypożyczalnia Kontrolna");
    expect(logo!.inFooter).toBe(true);
  });

  it("WIDZI WYBRANY MOTYW I AKCENT — nie motyw domyślny", async () => {
    const ctx = await loadContext();

    expect(ctx!.style.theme, "sklep spadł na motyw domyślny").toBe(MOTYW);
    expect(ctx!.style.accent).toBe(AKCENT);
    expect(ctx!.style.theme, "kontrola pozytywna: motyw jest inny niż domyślny").not.toBe(
      DEFAULT_SITE_STYLE.theme,
    );
  });

  it("STOPKI NIE MA, i to jest poprawne — jej właścicielem została strona główna", async () => {
    const ctx = await loadContext();
    const { shellSections } = await import("@/lib/site/page-sections");

    // ADR-154: stopka jest sekcją POWŁOKI, ale mieszka na stronie głównej.
    // Ta zmiana rozdziela wyłącznie tę część powłoki, która należy do najemcy.
    expect(shellSections(ctx!.site)).toEqual([]);
  });
});

describe("najemca bez ANI JEDNEJ opublikowanej strony", () => {
  it("ma znak i motyw — koszyk, kasa i dokumenty prawne nie mają wiersza sites", async () => {
    rpcAnswers.get_tenant_appearance = { data: powloka(), error: null };
    rpcAnswers.get_published_page = { data: null, error: null };

    const ctx = await loadContext();
    const { storeLogo } = await import("@/lib/site/store-logo");

    expect(ctx!.style.theme).toBe(MOTYW);
    expect(storeLogo(ctx!)).not.toBeNull();
  });
});

describe("najemca z opublikowaną stroną główną (brak regresu)", () => {
  it("bierze wygląd z toru najemcy, a treść i stopkę dalej z koperty strony", async () => {
    rpcAnswers.get_tenant_appearance = { data: powloka(), error: null };
    rpcAnswers.get_published_page = { data: stronaGlowna(), error: null };

    const ctx = await loadContext();

    expect(ctx!.style.theme).toBe(MOTYW);
    expect(ctx!.site?.sections).toHaveLength(1);
  });
});

describe("izolacja odczytu powłoki", () => {
  it("RPC dostaje najemcę Z NAGŁĄWKA i żadnego innego", async () => {
    rpcAnswers.get_tenant_appearance = { data: powloka(), error: null };
    rpcAnswers.get_published_page = { data: null, error: null };

    await loadContext();

    const appearance = rpcCalls.filter((call) => call.fn === "get_tenant_appearance");
    expect(appearance, "powłoka nie została w ogóle odczytana").toHaveLength(1);
    expect(appearance[0]!.args).toEqual({ p_tenant_id: TENANT });
    expect(JSON.stringify(rpcCalls), "w wywołaniach pojawił się obcy najemca").not.toContain(
      OBCY_TENANT,
    );
  });

  it("bez nagłówka najemcy nie ma kontekstu i nie ma ani jednego odczytu", async () => {
    headerStore.tenantId = null;

    expect(await loadContext()).toBeNull();
    expect(rpcCalls).toEqual([]);
  });
});

describe("fail-soft powłoki", () => {
  it("błąd RPC → wygląd domyślny i brak znaku, a nie wywrócona trasa", async () => {
    rpcAnswers.get_tenant_appearance = { data: null, error: { message: "boom" } };
    rpcAnswers.get_published_page = { data: null, error: null };

    const ctx = await loadContext();
    const { storeLogo } = await import("@/lib/site/store-logo");

    expect(ctx).not.toBeNull();
    expect(ctx!.style).toEqual(DEFAULT_SITE_STYLE);
    expect(storeLogo(ctx!)).toBeNull();
  });

  it("koperta w nieznanym kształcie degraduje się polami, a nie w całości", async () => {
    rpcAnswers.get_tenant_appearance = {
      data: powloka({ template: "motyw-z-przyszłości", logo: { path: "nie-taka-ścieżka" } }),
      error: null,
    };
    rpcAnswers.get_published_page = { data: null, error: null };

    const ctx = await loadContext();
    const { storeLogo } = await import("@/lib/site/store-logo");

    // Styl przeżył, szablon spadł na zastany, znak w nierozpoznanym kształcie
    // znika (jak w ADR-160) — sklep bez znaku jest stanem NORMALNYM.
    expect(ctx!.style.theme).toBe(MOTYW);
    expect(storeLogo(ctx!)).toBeNull();
  });
});
