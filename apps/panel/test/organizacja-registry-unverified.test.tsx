// @vitest-environment jsdom

/**
 * WIDOCZNOŚĆ STANU DANYCH FIRMOWYCH na ekranie Organizacji (ADR-276).
 *
 * ═════════════════ PO CO TEN EKRAN COKOLWIEK MÓWI ═════════════════
 *
 * Decyzja właściciela (2026-08-26) wpuszcza do bazy organizacje, których
 * nazwy firmowej NIKT nie potwierdził w rejestrze — bo warunek „musi być
 * w wykazie VAT" odcinał podatników zwolnionych podmiotowo, czyli sporą
 * część grupy docelowej. Cena tej decyzji jest do przyjęcia WYŁĄCZNIE
 * wtedy, gdy stan jest WIDOCZNY: inaczej po miesiącu nikt (my ani operator)
 * nie odróżni danych z rejestru od danych wpisanych z palca.
 *
 * Znacznikiem jest `tenants.registry_verified_at` (0114): NULL = nikt tych
 * danych nie potwierdził. Ten plik mierzy TRASĘ `/organizacja`, a nie
 * preset komponentu — przejeżdża realny kształt zapytania do `tenants`
 * (kolumna musi być w `select`, inaczej byłaby `undefined` i pigułka
 * stałaby ZAWSZE) i realne złożenie pigułki obok chipa stanu konta.
 *
 * Cztery zdania, które psują się osobno:
 *   1. NIEZWERYFIKOWANE — pigułka i zdanie wyjaśnienia są na ekranie;
 *   2. ZWERYFIKOWANE — nie ma po nich śladu (stempel z rejestru);
 *   3. CHIP STANU KONTA nie znika przez dołożenie pigułki (dwa różne fakty,
 *      dwie osobne etykiety) i pigułka stoi też przy koncie NIEAKTYWNYM;
 *   4. TEKSTY są w obu językach i różne między nimi.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

interface TenantRow {
  id: string;
  name: string;
  status: string;
  registry_verified_at: string | null;
  subscriptions: { plan_id: string | null; status: string | null } | null;
}

const store: { tenant: TenantRow; selected: string | null } = {
  tenant: {
    id: TENANT_ID,
    name: "Wypożyczalnia nad jeziorem",
    status: "active",
    registry_verified_at: null,
    subscriptions: null,
  },
  selected: null,
};

/**
 * Atrapa PostgREST, która ZAPAMIĘTUJE listę kolumn. Bez tego test
 * przechodziłby także wtedy, gdyby trasa przestała pobierać
 * `registry_verified_at` — fikstura i tak podaje pole, a `undefined === null`
 * jest fałszem, więc pigułka po cichu zniknęłaby dopiero na produkcji.
 */
function table(name: string) {
  const chain = {
    select: (columns: string) => {
      if (name === "tenants") store.selected = columns;
      return chain;
    },
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve(name === "tenants" ? { data: store.tenant, error: null } : { data: null, error: null }),
  };
  return chain;
}

const supabase = { from: (name: string) => table(name) };
const roleRef = { current: "owner" as "owner" | "staff" };

vi.mock("@/lib/member-page", () => ({
  requireMemberPage: vi.fn(async () => ({ tenantId: TENANT_ID, supabase, role: roleRef.current })),
}));

const messagesFor = (locale: "pl" | "en") => (locale === "pl" ? plMessages : enMessages);
const localeRef = { current: "pl" as "pl" | "en" };

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const node = namespace
      .split(".")
      .reduce<Record<string, unknown>>(
        (acc, part) => acc[part] as Record<string, unknown>,
        messagesFor(localeRef.current) as unknown as Record<string, unknown>,
      );
    const t = (key: string) => {
      const value = key
        .split(".")
        .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], node);
      return String(value ?? key);
    };
    t.has = (key: string) =>
      key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], node) !==
      undefined;
    return t;
  },
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const OrganizationPage = (await import("@/app/[locale]/(panel)/organizacja/page")).default;

async function renderScreen(locale: "pl" | "en" = "pl") {
  localeRef.current = locale;
  const page = await OrganizationPage();
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Europe/Warsaw">
      {page}
    </NextIntlClientProvider>,
  );
}

function badge(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-registry-unverified]");
}

function note(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-registry-unverified-note]");
}

afterEach(() => {
  cleanup();
  store.tenant = {
    id: TENANT_ID,
    name: "Wypożyczalnia nad jeziorem",
    status: "active",
    registry_verified_at: null,
    subscriptions: null,
  };
  store.selected = null;
  roleRef.current = "owner";
});

describe("Organizacja — znacznik danych niezweryfikowanych w rejestrze (ADR-276)", () => {
  it("registry_verified_at = NULL: pigułka i ZDANIE WYJAŚNIENIA są na ekranie", async () => {
    await renderScreen();

    expect(badge()).not.toBeNull();
    expect(badge()!.textContent).toBe(plMessages.organization.registryUnverifiedBadge);
    // Sama pigułka mówi CO, ale nie mówi CO TO ZNACZY — brief wymagał obu.
    expect(note()).not.toBeNull();
    expect(note()!.textContent).toBe(plMessages.organization.registryUnverifiedNote);
  });

  it("trasa NAPRAWDĘ pobiera kolumnę registry_verified_at (inaczej pigułka stałaby zawsze)", async () => {
    await renderScreen();
    expect(store.selected).toContain("registry_verified_at");
  });

  it("registry_verified_at ustawione: ani pigułki, ani zdania", async () => {
    store.tenant.registry_verified_at = "2026-08-26T10:00:00Z";
    await renderScreen();

    expect(badge()).toBeNull();
    expect(note()).toBeNull();
    expect(screen.queryByText(plMessages.organization.registryUnverifiedNote)).toBeNull();
  });

  it("chip stanu konta ZOSTAJE obok pigułki — to dwa różne fakty", async () => {
    await renderScreen();

    const chip = document.querySelector<HTMLElement>('[data-secondary-status-axis="organization"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe(plMessages.secondaryStatus.organization.active);
    expect(badge()).not.toBeNull();
  });

  it("konto NIEAKTYWNE: chipa stanu nie ma, ale pigułka danych firmowych zostaje", async () => {
    // Dwa niezależne warunki w jednym slocie — łatwo napisać je tak, że jeden
    // gasi drugi. Ten przypadek pilnuje, że nie gasi.
    store.tenant.status = "suspended";
    await renderScreen();

    expect(document.querySelector('[data-secondary-status-axis="organization"]')).toBeNull();
    expect(badge()).not.toBeNull();
  });

  it("teksty są w OBU językach i różne między nimi", async () => {
    await renderScreen("en");
    expect(badge()!.textContent).toBe(enMessages.organization.registryUnverifiedBadge);
    expect(note()!.textContent).toBe(enMessages.organization.registryUnverifiedNote);

    expect(enMessages.organization.registryUnverifiedBadge).not.toBe(
      plMessages.organization.registryUnverifiedBadge,
    );
    expect(enMessages.organization.registryUnverifiedNote).not.toBe(
      plMessages.organization.registryUnverifiedNote,
    );
  });
});
