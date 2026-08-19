/**
 * KONTRAKT (ADR-190): adres akceptacji w e-mailu zaproszenia ma host PANELU,
 * wyprowadzony z `PANEL_URL` — i ŻADEN ODNOŚNIK nie prowadzi na kanon
 * marketingowy. (Do ADR-210 zakaz obejmował bajty całej wiadomości; odkąd
 * mail platformowy niesie logo Avably, kanon występuje w treści LEGALNIE
 * jako `src` obrazu — nawigacja dalej nie ma tam czego szukać.)
 *
 * ================== DLACZEGO TEN TEST ISTNIEJE ==================
 *
 * H-FLOW-01 z audytu właściciela: `zaproszenia/actions.ts` składało adres
 * akceptacji przez `siteUrl()`, czyli kanon MARKETINGOWY (`www.avably.io`) —
 * a strona akceptacji żyje w panelu (`app.avably.io/{locale}/zaproszenie/…`).
 * Link z e-maila dawał 404 i blokował onboarding zespołu, a w panelu
 * zaproszenie wyglądało na wysłane (ta sama niema sygnatura co ADR-050).
 *
 * Istniejące suity były wtedy ZIELONE, bo fixture'y niosły zły host jako
 * wartość oczekiwaną. Dlatego ten test:
 *   1. woła PRAWDZIWE akcje (`inviteMemberAction`, `resendInvitationAction`),
 *      nie moduł e-maili z podanym z zewnątrz adresem — mutacja w akcji musi
 *      go zapalić,
 *   2. oczekiwanie WYPROWADZA ze stałych `PANEL_URL`/`CANONICAL_SITE_URL`,
 *      nie z wklejonego napisu — wklejony literał to znowu tylko przekonanie
 *      autora testu,
 *   3. czyta TREŚĆ WYSŁANEJ WIADOMOŚCI (html ORAZ text), nie wartość
 *      zwróconą z helpera — mutant składający link do szablonu inną drogą
 *      przeszedłby po cichu (lekcja z ADR-050).
 *
 * ================== PUŁAPKA ŚRODOWISKOWA ==================
 *
 * Poza produkcją `siteUrl()` i `panelBaseUrl()` zwracają TĘ SAMĄ wartość
 * (`http://127.0.0.1:3000`) — test bez wymuszenia gałęzi produkcyjnej niczego
 * nie odróżnia i jest wakacyjny. Dlatego przypadki kontraktowe stubują
 * `NODE_ENV=production` (wzorzec z account-email-hook.test.ts), a
 * `NEXT_PUBLIC_SITE_URL` jest stubowany na pusto, żeby kanon marketingowy
 * był w kontroli negatywnej wartością znaną, nie zależną od środowiska CI.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANONICAL_SITE_URL,
  PANEL_URL,
  type EmailTransport,
  type OutgoingEmail,
} from "@avably/core";

// Import STATYCZNY, nie dynamiczny w teście — celowo. Graf modułów (w tym
// szablony @avably/emails i runtime JSX Reacta) musi się załadować PRZED
// stubem `NODE_ENV=production`: transformacja vitesta woła `jsxDEV`, a react
// wybiera wariant runtime po NODE_ENV w chwili IMPORTU — dynamiczny import
// pod stubem ładował wariant produkcyjny bez `jsxDEV` i render padał.
// Stub zostaje tym, czym ma być: przełącznikiem gałęzi w chwili WYWOŁANIA
// (`siteUrl()`/`panelBaseUrl()` czytają env przy każdym wołaniu).
import {
  inviteMemberAction,
  resendInvitationAction,
} from "@/app/[locale]/(panel)/zaproszenia/actions";

const TENANT = "00000000-0000-4000-8000-00000000000a";

/** Wiadomości przechwycone na granicy transportu — to JE dostałby zaproszony. */
let sent: OutgoingEmail[] = [];
/** Transport podstawiany przez mock `resendTransport` (poniżej). */
let transportImpl: EmailTransport = { send: async (e) => (sent.push(e), { id: "t-1" }) };

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// Klasa definiowana W fabryce: przy imporcie statycznym akcji fabryki mocków
// wykonują się przed ciałem tego modułu (TDZ na zewnętrznej klasie).
vi.mock("@/lib/auth", () => ({ AuthError: class extends Error {} }));
vi.mock("@/lib/email-log", () => ({
  panelEmailLogRecorder: () => ({ record: async () => undefined }),
}));
vi.mock("@avably/security/rate-limit", () => ({
  PANEL_AUTH_RATE_LIMIT_PREFIX: "test",
  checkRateLimit: async () => ({ success: true }),
}));

// @avably/core zostaje PRAWDZIWE (w tym `siteUrl` — bez tego dowód mutacyjny
// mierzyłby atrapę, nie kod produkcyjny). Podmieniamy wyłącznie dostępność
// wysyłki i fabrykę transportu, żeby test nie wymagał RESEND_API_KEY i mógł
// przechwycić wiadomość.
vi.mock("@avably/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@avably/core")>();
  return {
    ...actual,
    emailAvailability: () => ({ available: true }),
    resendTransport: (): EmailTransport => ({ send: (e) => transportImpl.send(e) }),
  };
});

/**
 * Minimalny klient PostgREST (wzorzec api-keys-actions.test.ts): łańcuchy
 * `select/eq/is/maybeSingle` i thenable na końcu. Bez symulacji RLS — tu nie
 * o nią chodzi; testowane jest ZŁOŻENIE adresu w akcji.
 */
function chain(result: unknown) {
  const c = {
    select: () => c,
    eq: () => c,
    is: () => c,
    maybeSingle: () => Promise.resolve(result),
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return c;
}

/** Zaproszenie otwarte (pending) — resendInvitationAction musi je znaleźć. */
const OPEN_INVITATION = {
  id: "inv-1",
  email: "nowy@example.com",
  role: "staff",
  accepted_at: null,
  revoked_at: null,
  expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
};

const fakeSupabase = {
  from(table: string) {
    if (table === "invitations") {
      return {
        insert: () => chain({ error: null }),
        select: () => chain({ data: OPEN_INVITATION }),
        update: () => chain({ data: [{ id: "inv-1" }], error: null }),
      };
    }
    if (table === "tenants") {
      return { select: () => chain({ data: { name: "Wypożyczalnia Demo", locale: "pl" } }) };
    }
    if (table === "tenant_settings") {
      return { select: () => chain({ data: [] }) };
    }
    throw new Error(`nieoczekiwana tabela: ${table}`);
  },
};

vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => ({ supabase: fakeSupabase, tenantId: TENANT }),
}));

function inviteForm(): FormData {
  const data = new FormData();
  data.set("email", "nowy@example.com");
  data.set("role", "staff");
  return data;
}

function resendForm(): FormData {
  const data = new FormData();
  data.set("invitationId", "11111111-1111-4111-8111-111111111111");
  return data;
}

/** Pięć kanałów konsoli — przeciek tokenu jednym z nich to przejęcie konta. */
function captureConsole() {
  const lines: string[] = [];
  const channels = ["log", "info", "warn", "error", "debug"] as const;
  const originals = channels.map((ch) => console[ch]);
  for (const ch of channels) {
    console[ch] = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
  }
  return {
    lines,
    restore() {
      channels.forEach((ch, i) => {
        console[ch] = originals[i]!;
      });
    },
  };
}

const PANEL_ORIGIN = new URL(PANEL_URL).origin;
const MARKETING_ORIGIN = new URL(CANONICAL_SITE_URL).origin;

/** Surowy token wyjęty z TREŚCI wiadomości (64 hex — randomBytes(32)). */
function tokenFrom(html: string): string {
  const match = /\/zaproszenie\/([0-9a-f]{64})/.exec(html);
  expect(match, "treść nie zawiera linku /zaproszenie/<64-hex>").not.toBeNull();
  return match![1]!;
}

/**
 * Odnośniki (`href`) z treści — to JE klika zaproszony i to ONE dawały 404
 * w H-FLOW-01. Od ADR-210 kanon marketingowy występuje w wiadomości legalnie
 * jako `src` logo Avably (obraz, nie nawigacja), więc kontrola negatywna
 * patrzy na odnośniki. Wersja TEKSTOWA obrazów nie niesie w ogóle
 * (zmierzone: render tekstowy zaczyna się nagłówkiem, zero adresu logo),
 * dlatego dla `text` zakaz zostaje na całości.
 */
function hrefy(html: string): string[] {
  return Array.from(html.matchAll(/href="([^"]*)"/g)).map((m) => m[1] ?? "");
}

let consoleCapture: ReturnType<typeof captureConsole>;

/**
 * ROZGRZEWKA RENDERERA — WARUNEK POPRAWNOŚCI, NIE OPTYMALIZACJA. Pierwszy
 * render szablonu robi leniwy `import("react-dom/server")`, a react wybiera
 * wariant po `NODE_ENV` w chwili importu. Gdyby pierwszy render odbył się pod
 * stubem `NODE_ENV=production`, do cache modułów trafiłby wariant produkcyjny
 * niezgodny z już załadowanym DEV-runtime JSX ("dispatcher.getOwner is not
 * a function") — i zatruwał każdy KOLEJNY render w pliku, także bez stubów
 * (dlatego objaw wyglądał na interferencję między testami). Jeden render pod
 * niestubowanym env ładuje wariant właściwy dla transformacji vitesta.
 * Jawny budżet czasu: rozgrzewka w hooku obciąża limit HOOKA, nie przypadku.
 */
beforeAll(async () => {
  const { renderOrganizationInvitation } = await import("@avably/emails");
  await renderOrganizationInvitation({
    acceptanceUrl: "http://127.0.0.1:3000/zaproszenie/rozgrzewka",
    locale: "pl",
    organizationName: "Rozgrzewka",
    role: "staff",
  });
}, 15_000);

beforeEach(() => {
  sent = [];
  transportImpl = { send: async (e) => (sent.push(e), { id: "t-1" }) };
  consoleCapture = captureConsole();
});

afterEach(() => {
  consoleCapture.restore();
  vi.unstubAllEnvs();
});

describe("adres akceptacji zaproszenia — host panelu, nie kanon marketingowy (ADR-190)", () => {
  it("PRODUKCJA, nowe zaproszenie: link w wysłanej wiadomości stoi na hoście PANELU", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const state = await inviteMemberAction({}, inviteForm());

    expect(state.error).toBeUndefined();
    expect(sent).toHaveLength(1);
    const { html, text } = sent[0]!;
    const token = tokenFrom(html);
    // Oczekiwanie ze STAŁEJ, nie z wklejonego napisu.
    expect(html).toContain(`${PANEL_ORIGIN}/zaproszenie/${token}`);
    expect(text).toContain(`${PANEL_ORIGIN}/zaproszenie/${token}`);
    // Kontrola negatywna: ŻADEN odnośnik nie stoi na kanonie marketingowym —
    // to na nim trasa /zaproszenie/… nie istnieje (404, H-FLOW-01). Kontrola
    // pozytywna obok: link akceptacji naprawdę jest odnośnikiem, więc zakaz
    // nie może być zielony przez pusty wynik `hrefy()`.
    const linki = hrefy(html);
    expect(linki).toContain(`${PANEL_ORIGIN}/zaproszenie/${token}`);
    for (const link of linki) expect(link).not.toContain(MARKETING_ORIGIN);
    expect(text).not.toContain(MARKETING_ORIGIN);
  });

  it("PRODUKCJA, ponowienie zaproszenia: DRUGA ścieżka wysyłki ma tę samą gwarancję", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const state = await resendInvitationAction({}, resendForm());

    expect(state.error).toBeUndefined();
    expect(sent).toHaveLength(1);
    const { html, text } = sent[0]!;
    const token = tokenFrom(html);
    expect(html).toContain(`${PANEL_ORIGIN}/zaproszenie/${token}`);
    expect(text).toContain(`${PANEL_ORIGIN}/zaproszenie/${token}`);
    const linki = hrefy(html);
    expect(linki).toContain(`${PANEL_ORIGIN}/zaproszenie/${token}`);
    for (const link of linki) expect(link).not.toContain(MARKETING_ORIGIN);
    expect(text).not.toContain(MARKETING_ORIGIN);
  });

  it("PRODUKCJA, transport pada: link do RĘCZNEGO przekazania też stoi na hoście panelu", async () => {
    // Komunikat „Przekaż link ręcznie" idzie na EKRAN ownera — z tym samym
    // adresem, który polecieć nie zdołał. Zły host tutaj = owner własnoręcznie
    // wręcza zaproszonemu 404.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    transportImpl = {
      send: async () => {
        throw new Error("Dostawca odrzucił (HTTP 422).");
      },
    };
    const state = await inviteMemberAction({}, inviteForm());

    expect(state.success).toContain(`${PANEL_ORIGIN}/zaproszenie/`);
    expect(state.success).not.toContain(MARKETING_ORIGIN);
  });

  it("poza produkcją baza zostaje na localhoście — dev musi trafiać we własny serwer", async () => {
    // UWAGA: to NIE jest bramka kontraktu. Poza produkcją `siteUrl()`
    // i `panelBaseUrl()` są identyczne (localhost), więc ten przypadek nie
    // odróżnia poprawki od defektu — dokumentuje tylko, że dev nie ucieka
    // na produkcję. Bramką są przypadki PRODUKCJA wyżej.
    const state = await inviteMemberAction({}, inviteForm());

    expect(state.error).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain("http://127.0.0.1:3000/zaproszenie/");
    for (const link of hrefy(sent[0]!.html)) {
      expect(link).not.toContain(PANEL_ORIGIN);
      expect(link).not.toContain(MARKETING_ORIGIN);
    }
  });

  it("surowy token NIE wycieka do konsoli na żadnej z obu ścieżek", async () => {
    // Surowy token w logu = zaproszenie do przejęcia członkostwa dla każdego,
    // kto ma wgląd w logi (lustro decyzji z ADR-050 o token_hash).
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    await inviteMemberAction({}, inviteForm());
    await resendInvitationAction({}, resendForm());

    expect(sent).toHaveLength(2);
    for (const email of sent) {
      const token = tokenFrom(email.html);
      for (const line of consoleCapture.lines) {
        expect(line).not.toContain(token);
      }
    }
  });
});
