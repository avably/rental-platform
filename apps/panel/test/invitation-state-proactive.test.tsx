/**
 * Ekran akceptacji zaproszenia używa stanu PROAKTYWNIE (ADR-196, 0087):
 * zamiast kazać człowiekowi klikać „Dołącz" w martwy token, strona czyta
 * `app.invitation_state` JEDNYM zapytaniem i przy stanie ≠ `open` pokazuje
 * komunikat per stan ZAMIAST przycisku.
 *
 * KONTRAKT:
 *   * stan `open` → formularz (przycisk „Dołącz"), zero komunikatu odmowy;
 *   * pięć stanów martwych → komunikat per stan ze słownika (PL/EN), BEZ
 *     formularza — czyli też BEZ tokenu w HTML (token żyje wyłącznie
 *     w ukrytym polu formularza);
 *   * uszkodzony token (nie przechodzi walidacji formatu) → komunikat
 *     o uszkodzonym linku BEZ pytania bazy;
 *   * FAIL-OPEN NA FORMULARZ: błąd odczytu stanu albo etykieta spoza
 *     zamkniętego zbioru → formularz jak dotąd. Bramką wejścia jest
 *     `app.accept_invitation` przy kliknięciu — pokazanie przycisku niczego
 *     nie otwiera, a chowanie go na błędzie odczytu odcinałoby żywe
 *     zaproszenia przy usterce przejściowej;
 *   * bez sesji → redirect na logowanie z zachowanym `next` (bez zmian).
 *
 * Render przez `renderToStaticMarkup` na wyniku KOMPONENTU ASYNC (RSC) —
 * dokładnie ten JSX, który produkuje strona; formularz podmieniony na
 * znacznik (jego zachowanie ma własną suitę invitation-accept-denial).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";
import enMessages from "../messages/en.json";

const MESSAGES = { pl: plMessages, en: enMessages } as const;

const activeLocale = vi.hoisted(() => ({ current: "pl" as "pl" | "en" }));

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => activeLocale.current,
  getTranslations: async (namespace?: string) =>
    createTranslator({
      locale: activeLocale.current,
      messages: MESSAGES[activeLocale.current],
      namespace: namespace as never,
      onError: () => {},
    }),
}));

vi.mock("@/lib/navigation", () => ({
  localePath: async (pathname: string, query?: Record<string, string>) =>
    `/${activeLocale.current}${pathname}${query?.next ? `?next=${encodeURIComponent(query.next)}` : ""}`,
}));

const pageState = vi.hoisted(() => ({
  stateResult: { data: null as unknown, error: null as { message: string } | null },
  rpcCalls: [] as { fn: string; args: unknown }[],
  session: true,
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    schema: (name: string) => ({
      rpc: async (fn: string, args: unknown) => {
        pageState.rpcCalls.push({ fn: `${name}.${fn}`, args });
        return pageState.stateResult.error
          ? { data: null, error: pageState.stateResult.error }
          : { data: pageState.stateResult.data, error: null };
      },
    }),
  }),
}));

vi.mock("@/lib/auth", () => ({
  getAuthContext: async () =>
    pageState.session ? { user: { email: "zaproszony@test.local" } } : null,
}));

// Formularz jako znacznik: strona rozstrzyga formularz-vs-komunikat, a sam
// formularz (useActionState, ukryte pole tokenu) ma własną suitę.
vi.mock("@/app/[locale]/zaproszenie/[token]/form", () => ({
  AcceptInvitationForm: ({ token }: { token: string }) => (
    <div data-testid="accept-form" data-has-token={token ? "yes" : "no"} />
  ),
}));

const { default: AcceptInvitationPage } = await import(
  "@/app/[locale]/zaproszenie/[token]/page"
);

const TOKEN = "b".repeat(64);

async function renderPage(token: string): Promise<string> {
  const jsx = await AcceptInvitationPage({ params: Promise.resolve({ token }) });
  return renderToStaticMarkup(jsx);
}

beforeEach(() => {
  activeLocale.current = "pl";
  pageState.stateResult = { data: null, error: null };
  pageState.rpcCalls = [];
  pageState.session = true;
});

describe("stan ≠ open → komunikat per stan ZAMIAST przycisku", () => {
  const BLOCKED_STATES = [
    ["not_found", "stateNotFound"],
    ["used", "stateUsed"],
    ["revoked", "stateRevoked"],
    ["expired", "stateExpired"],
    ["email_mismatch", "stateEmailMismatch"],
  ] as const;

  for (const [state, key] of BLOCKED_STATES) {
    it(`PL: '${state}' → ${key}, bez formularza i bez tokenu w HTML`, async () => {
      pageState.stateResult = { data: state, error: null };

      const html = await renderPage(TOKEN);

      expect(html).toContain(plMessages.invitationAccept[key]);
      expect(html).toContain(`data-invitation-state="${state}"`);
      expect(html).not.toContain("accept-form");
      // Izolacja: bez formularza token nie ma prawa być w dokumencie —
      // komunikaty są stałymi słownika (ADR-181).
      expect(html).not.toContain(TOKEN);
    });
  }

  it("EN: 'expired' → komunikat ze słownika angielskiego", async () => {
    activeLocale.current = "en";
    pageState.stateResult = { data: "expired", error: null };

    const html = await renderPage(TOKEN);

    expect(html).toContain(enMessages.invitationAccept.stateExpired);
    expect(html).not.toContain("accept-form");
  });

  it("stan czyta się tym samym tokenem, którym przyszło żądanie", async () => {
    pageState.stateResult = { data: "expired", error: null };

    await renderPage(TOKEN);

    expect(pageState.rpcCalls).toEqual([
      { fn: "app.invitation_state", args: { p_token: TOKEN } },
    ]);
  });
});

describe("stan open i gałęzie fail-open — formularz jak dotąd", () => {
  it("'open' → formularz z tokenem, zero komunikatów odmowy", async () => {
    pageState.stateResult = { data: "open", error: null };

    const html = await renderPage(TOKEN);

    expect(html).toContain('data-testid="accept-form"');
    expect(html).toContain('data-has-token="yes"');
    expect(html).toContain('data-invitation-state="open"');
    expect(html).not.toContain(plMessages.invitationAccept.stateExpired);
    expect(html).not.toContain(plMessages.invitationAccept.denied);
  });

  it("błąd odczytu stanu → formularz (bramką pozostaje accept_invitation), stan 'unknown'", async () => {
    pageState.stateResult = { data: null, error: { message: "read exploded" } };

    const html = await renderPage(TOKEN);

    expect(html).toContain('data-testid="accept-form"');
    expect(html).toContain('data-invitation-state="unknown"');
    expect(html).not.toContain("read exploded");
  });

  it("etykieta SPOZA zamkniętego zbioru → formularz (fail-open na formularz)", async () => {
    pageState.stateResult = { data: "nowy-nieznany-stan", error: null };

    const html = await renderPage(TOKEN);

    expect(html).toContain('data-testid="accept-form"');
    expect(html).toContain('data-invitation-state="unknown"');
  });
});

describe("uszkodzony token i brak sesji", () => {
  it("token nieprzechodzący walidacji → invalidLink BEZ pytania bazy i bez formularza", async () => {
    const html = await renderPage("krotki");

    expect(html).toContain(plMessages.invitationAccept.invalidLink);
    expect(html).toContain('data-invitation-state="invalid"');
    expect(html).not.toContain("accept-form");
    expect(pageState.rpcCalls).toHaveLength(0);
  });

  it("bez sesji → redirect na logowanie z zachowanym next (token co do znaku)", async () => {
    pageState.session = false;

    await expect(renderPage(TOKEN)).rejects.toMatchObject({
      url: `/pl/login?next=${encodeURIComponent(`/zaproszenie/${TOKEN}`)}`,
    });
    expect(pageState.rpcCalls).toHaveLength(0);
  });
});
