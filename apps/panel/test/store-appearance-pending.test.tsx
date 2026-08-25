// @vitest-environment jsdom

/**
 * WYGLĄD SKLEPU MA WIDOCZNY STAN, A OKNO PUBLIKACJI PRZESTAJE KŁAMAĆ O ZASIĘGU
 * (ADR-171, wada W1 z audytu kreatora 2026-08-13).
 *
 * ===================== WADA, KTÓRĄ TEN PLIK ZAMYKA =====================
 *
 * Dwa objawy jednego braku — zasięg publikacji nie był nigdzie nazwany:
 *
 *   1. `publishSite` po opublikowaniu TREŚCI woła bezargumentowe
 *      `app.publish_tenant_appearance()`, więc publikacja literówki na stronie
 *      kontaktowej przenosi na żywo motyw, akcent i kroje CAŁEGO sklepu.
 *      Okno potwierdzenia mówiło przy tym wprost: „Pozostałe strony sklepu
 *      zostają bez zmian." — zdanie fałszywe za każdym razem, gdy operator
 *      ruszył wygląd.
 *   2. W drugą stronę: `style_published`/`template_published` nie czytał ANI
 *      JEDEN ekran panelu (kolumny występowały w `apps/panel` wyłącznie
 *      w testach), więc operator, który zmienił kolory świadomie, nie miał jak
 *      sprawdzić, czy klienci już je mają.
 *
 * ===================== CO JEST MIERZONE I NA CZYM =====================
 *
 * Na TRASIE, nie na presecie. Test renderuje prawdziwy `SitePage`, więc
 * przejeżdża realny kształt zapytania do `tenants`, realne `appearancePending`
 * i realne przekazanie stanu do okna publikacji. Fikstury odtwarzają kolumny
 * tak, jak leżą w bazie po 0077 — łącznie z wierszem ŚWIEŻEGO najemcy
 * (`template = 'classic'`, `template_published = NULL`, oba style `{}`), na
 * którym porównanie surowych kolumn dałoby fałszywe „czeka na publikację"
 * każdemu najemcy od pierwszej sekundy.
 *
 * Pięć zdań, które psują się osobno:
 *
 *   1. ŚWIEŻY NAJEMCA NIE MA CZEGO PUBLIKOWAĆ — karta mówi „ten wygląd widzą
 *      klienci", okno uspokaja;
 *   2. ZMIENIONY MOTYW / AKCENT / KRÓJ daje stan oczekujący na karcie;
 *   3. OKNO PUBLIKACJI MÓWI O ZASIĘGU — w obie strony, i nigdy nie twierdzi
 *      „bez zmian", gdy wygląd czeka;
 *   4. NIEUDANY ODCZYT NIE JEST DOMYSŁEM — karta znika, a okno o zasięgu
 *      milczy (lista stron zostaje);
 *   5. TEKSTY SĄ W OBU JĘZYKACH i różne między nimi.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const HOME_ID = "aaaaaaaa-1111-4111-8111-111111111111";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

/* ============================== WIERSZ NAJEMCY ============================== */

interface TenantRow {
  logo_draft: unknown;
  logo_published: unknown;
  template: string | null;
  template_published: string | null;
  style_draft: unknown;
  style_published: unknown;
}

/**
 * ŚWIEŻY NAJEMCA — dokładnie to, co zakłada 0077: szablon zastany `classic`,
 * bliźniak NULL (nigdy nie publikował wyglądu), oba style puste. Sklep pokazuje
 * mu wtedy `coalesce(template_published, 'classic')`, czyli TEN SAM wygląd,
 * który widzi w panelu.
 */
const SWIEZY: TenantRow = {
  logo_draft: {},
  logo_published: {},
  template: "classic",
  template_published: null,
  style_draft: {},
  style_published: {},
};

const store: { tenant: TenantRow | null; tenantFails: boolean } = {
  tenant: SWIEZY,
  tenantFails: false,
};

/* ================================ MOCKI TRASY ================================ */

/** Atrapa PostgREST: łańcuch zawężeń jest przezroczysty, liczy się tabela. */
function table(name: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    // `in` doszło z odczytem sekcji stron ŻYWYCH (K-05): łańcuch jest tu
    // przezroczysty, liczy się wyłącznie tabela, na której się kończy.
    in: () => chain,
    not: () => chain,
    order: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () =>
      Promise.resolve(
        name === "tenants" && !store.tenantFails
          ? { data: store.tenant, error: null }
          : { data: null, error: { message: "odczyt zawiódł" } },
      ),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: [], error: null }),
  };
  return chain;
}

const supabase = { from: (name: string) => table(name) };

vi.mock("@/lib/member-page", () => ({
  requireMemberPage: vi.fn(async () => ({ tenantId: TENANT_ID, supabase })),
}));

vi.mock("@/lib/site-queries", () => ({
  listSites: vi.fn(async () => [
    {
      id: HOME_ID,
      name: "Strona główna",
      slug: "",
      slug_published: "",
      redirect_old_slug: true,
      published_at: "2026-08-12T09:00:00Z",
      created_at: "2026-08-10T10:00:00Z",
    },
  ]),
}));

/**
 * `getTranslations`/`getFormatter` oddają PRAWDZIWE napisy z plików wiadomości,
 * a nie identyfikatory kluczy: test o treści zdania, który mierzy klucz,
 * przechodzi także wtedy, gdy zdanie mówi coś przeciwnego.
 */
const messagesFor = (locale: "pl" | "en") => (locale === "pl" ? plMessages : enMessages);
const localeRef = { current: "pl" as "pl" | "en" };

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, string>) => {
    const raw = namespace
      .split(".")
      .reduce<Record<string, unknown>>(
        (node, part) => node[part] as Record<string, unknown>,
        messagesFor(localeRef.current) as unknown as Record<string, unknown>,
      );
    const text = String((raw as Record<string, string>)[key] ?? key);
    return values
      ? Object.entries(values).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, value), text)
      : text;
  },
  getFormatter: async () => ({ dateTime: () => "12.08.2026" }),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  // Od K-02 (audyt UX 2026-08-25) utworzenie strony NAWIGUJE do kreatora, więc
  // ekran woła `useRouter`. Atrapa jest niema z premedytacją: te pliki mierzą,
  // czy akcja poszła z właściwymi argumentami, a nie dokąd operator wylądował.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const actions = vi.hoisted(() => ({
  createSite: vi.fn(),
  deleteSite: vi.fn(),
  publishSite: vi.fn(),
  unpublishSite: vi.fn(),
  renameSite: vi.fn(),
}));
vi.mock("@/lib/actions/site", () => actions);

const SitePage = (await import("@/app/[locale]/(panel)/strona/page")).default;

async function renderScreen(locale: "pl" | "en" = "pl") {
  localeRef.current = locale;
  const page = await SitePage();
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="Europe/Warsaw">
      {page}
    </NextIntlClientProvider>,
  );
}

/** Otwiera potwierdzenie publikacji i oddaje jego węzeł (Radix portuje do body). */
function openPublishDialog(): HTMLElement {
  fireEvent.click(document.querySelector<HTMLElement>("[data-publish-site]")!);
  const dialog = document.querySelector<HTMLElement>("[role='dialog']");
  if (!dialog) throw new Error("okno publikacji się nie otworzyło");
  return dialog;
}

beforeEach(() => {
  store.tenant = SWIEZY;
  store.tenantFails = false;
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.publishSite.mockResolvedValue({ ok: true, publishedAt: "2026-08-13T10:00:00Z" });
});

afterEach(() => cleanup());

/* ===================== 1. STAN WYGLĄDU JEST WIDOCZNY ===================== */

describe("karta wyglądu sklepu na ekranie stron", () => {
  it("ŚWIEŻY NAJEMCA: brak różnicy mimo template_published = NULL", async () => {
    await renderScreen();

    const card = document.querySelector("[data-store-appearance]");
    expect(card, "karta wyglądu nie powstała").not.toBeNull();
    expect(
      card!.getAttribute("data-store-appearance-state"),
      "świeży najemca straszony publikacją wyglądu, której nie ma",
    ).toBe("live");
    expect(document.querySelector("[data-store-appearance-pending]")).toBeNull();
    expect(screen.getByText(plMessages.site.appearance.live)).toBeTruthy();
  });

  it("ZMIENIONY MOTYW: karta mówi, że wygląd czeka na publikację", async () => {
    store.tenant = { ...SWIEZY, style_draft: { theme: "noir-lux" } };
    await renderScreen();

    expect(
      document.querySelector("[data-store-appearance]")!.getAttribute("data-store-appearance-state"),
    ).toBe("pending");
    expect(screen.getByText(plMessages.site.appearance.pending)).toBeTruthy();
  });

  it("ZMIENIONY AKCENT przy tym samym motywie też liczy się jako różnica", async () => {
    store.tenant = {
      ...SWIEZY,
      style_draft: { theme: "classic", accent: "forest" },
      style_published: { theme: "classic" },
      template_published: "classic",
    };
    await renderScreen();

    expect(
      document.querySelector("[data-store-appearance]")!.getAttribute("data-store-appearance-state"),
    ).toBe("pending");
  });

  it("ten SAM wygląd zapisany dwiema drogami nie jest różnicą", async () => {
    // Szkic niesie motyw jawnie, bliźniak przez kolumnę zastaną — dla klienta
    // to jest dokładnie ten sam sklep, więc karta nie ma o czym mówić.
    store.tenant = {
      ...SWIEZY,
      style_draft: { theme: "classic" },
      style_published: {},
      template_published: "classic",
    };
    await renderScreen();

    expect(
      document.querySelector("[data-store-appearance]")!.getAttribute("data-store-appearance-state"),
    ).toBe("live");
  });

  it("NIEUDANY ODCZYT: karty nie ma, a lista stron zostaje", async () => {
    store.tenantFails = true;
    await renderScreen();

    expect(document.querySelector("[data-store-appearance]")).toBeNull();
    expect(document.querySelector("[data-site-pages]"), "odczyt najemcy zgasił ekran").not.toBeNull();
  });
});

/* ============== 2. OKNO PUBLIKACJI MÓWI PRAWDĘ O ZASIĘGU ============== */

describe("okno publikacji a zasięg wyglądu", () => {
  it("BEZ RÓŻNICY: uspokaja — i dopiero teraz to zdanie jest prawdziwe", async () => {
    await renderScreen();
    const dialog = openPublishDialog();

    expect(dialog.querySelector("[data-publish-appearance-scope]")!.getAttribute(
      "data-publish-appearance-scope",
    )).toBe("unchanged");
    expect(dialog.textContent).toContain(plMessages.site.pages.switchAppearanceUnchanged);
    expect(dialog.textContent).not.toContain(plMessages.site.pages.switchAppearanceChanges);
  });

  it("Z RÓŻNICĄ: mówi, że publikacja wypuszcza wygląd CAŁEGO sklepu", async () => {
    store.tenant = { ...SWIEZY, style_draft: { theme: "noir-lux" } };
    await renderScreen();
    const dialog = openPublishDialog();

    expect(dialog.querySelector("[data-publish-appearance-scope]")!.getAttribute(
      "data-publish-appearance-scope",
    )).toBe("changes");
    expect(dialog.textContent).toContain(plMessages.site.pages.switchAppearanceChanges);
    expect(
      dialog.textContent,
      "okno zapewnia o braku zmian, choć wygląd czeka na publikację",
    ).not.toContain(plMessages.site.pages.switchAppearanceUnchanged);
  });

  it("NIEUDANY ODCZYT: okno o zasięgu MILCZY, zamiast zgadywać", async () => {
    store.tenantFails = true;
    await renderScreen();
    const dialog = openPublishDialog();

    expect(dialog.querySelector("[data-publish-appearance-scope]")).toBeNull();
  });

  it("zdanie o zasięgu nie wróciło do treści zdania o adresie", async () => {
    // Kontrakt ADR-171: `switchBodyNew` mówi WYŁĄCZNIE o adresie tej strony.
    // Doklejenie do niego czegokolwiek o „pozostałych stronach" przywraca
    // zdanie bezwarunkowe, czyli dokładnie wadę W1.
    for (const copy of [plMessages, enMessages]) {
      expect(copy.site.pages.switchBodyNew).not.toMatch(/pozostał|other pages|stay as they are/i);
    }
  });
});

/* ===================== 3. PARYTET I ROZŁĄCZNOŚĆ JĘZYKÓW ===================== */

describe("teksty zasięgu w obu językach", () => {
  it("EN: karta i okno mówią po angielsku, innymi napisami niż PL", async () => {
    store.tenant = { ...SWIEZY, style_draft: { theme: "noir-lux" } };
    await renderScreen("en");

    expect(screen.getByText(enMessages.site.appearance.pending)).toBeTruthy();
    expect(openPublishDialog().textContent).toContain(
      enMessages.site.pages.switchAppearanceChanges,
    );

    expect(enMessages.site.appearance.pending).not.toBe(plMessages.site.appearance.pending);
    expect(enMessages.site.pages.switchAppearanceChanges).not.toBe(
      plMessages.site.pages.switchAppearanceChanges,
    );
    expect(enMessages.site.pages.switchAppearanceUnchanged).not.toBe(
      plMessages.site.pages.switchAppearanceUnchanged,
    );
  });
});
