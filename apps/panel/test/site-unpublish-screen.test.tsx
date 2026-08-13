// @vitest-environment jsdom

/**
 * ZDJĘCIE STRONY ZE SKLEPU NA EKRANIE STRON (0078, ADR-170).
 *
 * ===================== WADA, KTÓRĄ TEN PLIK ZAMYKA =====================
 *
 * Do 0078 czasownika zdjęcia nie było ANI W BAZIE, ANI NA EKRANIE. Operator,
 * który opublikował stronę przez pomyłkę, widział przy niej wyłącznie wyłączony
 * przycisk usunięcia i — po kliknięciu drogą okrężną — zdanie „Najpierw
 * opublikuj inną". Rada była prawdziwa do 0073, gdy publikacja PRZEŁĄCZAŁA
 * żywą stronę; od 0074 strony współistnieją, więc operator wykonywał polecenie
 * i wracał w to samo miejsce.
 *
 * ===================== CO JEST MIERZONE =====================
 *
 * Trzy zdania, które psują się OSOBNO:
 *
 *   1. CZASOWNIK STOI TAM, GDZIE OPERATOR PATRZY — przy stronie żywej, i tylko
 *      przy niej. Strona robocza ma zamiast niego zwykłe usunięcie: zdejmowanie
 *      ze sklepu czegoś, czego w sklepie nie ma, byłoby kontrolką bez skutku.
 *   2. OKNO MÓWI, CO SIĘ STANIE Z ADRESEM — i mówi to INACZEJ dla strony
 *      głównej. Zdjęcie korzenia sklepu przywraca stan naprawiony przez
 *      ADR-168, więc jego cena musi paść ZANIM operator kliknie, a nie
 *      w reklamacji klienta.
 *   3. OKNO MÓWI O PRZEKIEROWANIACH. `app.get_tenant_pages` wypuszcza 308
 *      wyłącznie dla strony, która dalej jest żywa (0075), więc zdjęcie gasi
 *      każdy stary adres prowadzący do tej strony.
 *
 * Kontrolki szukane po DOSTĘPNEJ NAZWIE i klikane `userEvent`-em — mierzone
 * jest wywołanie akcji, a nie wewnętrzny stan komponentu.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

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

const actions = vi.hoisted(() => ({
  createSite: vi.fn(),
  deleteSite: vi.fn(),
  publishSite: vi.fn(),
  unpublishSite: vi.fn(),
  renameSite: vi.fn(),
}));
vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { SitePages } = await import("@/app/[locale]/(panel)/strona/site-pages");

type Row = Parameters<typeof SitePages>[0]["rows"][number];

const HOME_LIVE: Row = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Strona główna",
  live: true,
  slug: "",
  slugPublished: "",
  redirectOldSlug: true,
  redirectedFrom: [],
  publishedAtLabel: "12.08.2026",
  createdAtLabel: "10.08.2026",
};

const KONTAKT_LIVE: Row = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Kontakt",
  live: true,
  slug: "kontakt",
  slugPublished: "kontakt",
  redirectOldSlug: true,
  redirectedFrom: [],
  publishedAtLabel: "12.08.2026",
  createdAtLabel: "11.08.2026",
};

const KONTAKT_DRAFT: Row = { ...KONTAKT_LIVE, live: false, slugPublished: null, publishedAtLabel: null };

function renderList(rows: Row[], locale: "pl" | "en" = "pl") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "pl" ? plMessages : enMessages}
      timeZone="Europe/Warsaw"
    >
      <SitePages rows={rows} />
    </NextIntlClientProvider>,
  );
}

function rowOf(id: string): HTMLElement {
  const node = document.querySelector(`[data-site-page="${id}"]`);
  if (!node) throw new Error(`brak wiersza strony ${id}`);
  return node as HTMLElement;
}

beforeEach(() => {
  actions.unpublishSite.mockReset();
  actions.unpublishSite.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("czasownik zdjęcia ze sklepu (ADR-170)", () => {
  for (const [locale, messages] of [
    ["pl", plMessages],
    ["en", enMessages],
  ] as const) {
    it(`[${locale}] stoi przy stronie ŻYWEJ i prowadzi do akcji`, async () => {
      const user = userEvent.setup();
      renderList([KONTAKT_LIVE], locale);

      const label = messages.site.pages.unpublish;
      await user.click(within(rowOf(KONTAKT_LIVE.id)).getByRole("button", { name: label }));
      await user.click(
        screen.getByRole("button", { name: messages.site.pages.unpublishConfirm }),
      );

      expect(actions.unpublishSite).toHaveBeenCalledTimes(1);
      expect(actions.unpublishSite).toHaveBeenCalledWith(KONTAKT_LIVE.id);
    });
  }

  it("strona ROBOCZA go nie ma — w sklepie nie ma czego zdejmować", () => {
    renderList([KONTAKT_DRAFT]);

    expect(
      within(rowOf(KONTAKT_DRAFT.id)).queryByRole("button", {
        name: plMessages.site.pages.unpublish,
      }),
      "czasownik zdjęcia przy stronie, której klienci nie widzą",
    ).toBeNull();
    // Kontrola pozytywna: przy roboczej stoi za to usunięcie, więc brak wyżej
    // nie znaczy „wiersz nie ma żadnych przycisków".
    expect(
      within(rowOf(KONTAKT_DRAFT.id)).getByRole("button", { name: plMessages.site.pages.delete }),
    ).toBeTruthy();
  });

  it("przy stronie żywej usunięcie dalej jest zablokowane — czasownik go nie zastępuje", () => {
    renderList([KONTAKT_LIVE]);

    const row = rowOf(KONTAKT_LIVE.id);
    expect(row.querySelector(`[data-delete-site-blocked="${KONTAKT_LIVE.id}"]`)).toBeTruthy();
    expect(row.querySelector("[data-unpublish-site]")).toBeTruthy();
  });
});

describe("okno mówi, co się stanie z adresem", () => {
  it("podstrona: zdanie niesie JEJ adres", async () => {
    const user = userEvent.setup();
    renderList([KONTAKT_LIVE]);

    await user.click(
      within(rowOf(KONTAKT_LIVE.id)).getByRole("button", { name: plMessages.site.pages.unpublish }),
    );

    const opis = document.querySelector("[data-unpublish-scope]");
    expect(opis?.getAttribute("data-unpublish-scope")).toBe("page");
    expect(opis?.textContent).toContain("/kontakt");
  });

  it("STRONA GŁÓWNA: zdanie nazywa los korzenia sklepu, zanim operator kliknie", async () => {
    const user = userEvent.setup();
    renderList([HOME_LIVE]);

    await user.click(
      within(rowOf(HOME_LIVE.id)).getByRole("button", { name: plMessages.site.pages.unpublish }),
    );

    const opis = document.querySelector("[data-unpublish-scope]");
    expect(
      opis?.getAttribute("data-unpublish-scope"),
      "strona główna dostała zdanie zwykłej podstrony",
    ).toBe("home");
    expect(opis?.textContent).toContain("„/”");
    expect(opis?.textContent).toContain("katalog jest w przygotowaniu");
  });

  it("stare adresy: zdanie pojawia się TYLKO wtedy, gdy naprawdę istnieją", async () => {
    const user = userEvent.setup();

    // Kontrola po pustym zbiorze — bez niej „jest zdanie" niżej mogłoby znaczyć
    // „jest zawsze".
    renderList([KONTAKT_LIVE]);
    await user.click(
      within(rowOf(KONTAKT_LIVE.id)).getByRole("button", { name: plMessages.site.pages.unpublish }),
    );
    expect(document.querySelector("[data-unpublish-redirects]")).toBeNull();
    cleanup();

    renderList([{ ...KONTAKT_LIVE, redirectedFrom: ["kontakt-stary", "napisz-do-nas"] }]);
    await user.click(
      within(rowOf(KONTAKT_LIVE.id)).getByRole("button", { name: plMessages.site.pages.unpublish }),
    );
    const zdanie = document.querySelector("[data-unpublish-redirects]");
    expect(zdanie?.textContent).toContain("/kontakt-stary");
    expect(zdanie?.textContent).toContain("/napisz-do-nas");
  });
});

describe("ekran mówi, że korzeń sklepu jest pusty (ADR-170)", () => {
  it("strona główna istnieje, ale nie stoi w sklepie → zdanie o adresie „/”", () => {
    renderList([{ ...HOME_LIVE, live: false, slugPublished: null, publishedAtLabel: null }]);

    // Nie jest to stan „nie ma strony głównej" (ADR-168) — wiersz istnieje,
    // więc tamten baner ma milczeć, a ten mówić.
    expect(document.querySelector("[data-site-home-missing]")).toBeNull();
    expect(document.querySelector("[data-site-home-not-live]")?.textContent).toContain("„/”");
  });

  it("strona główna stoi w sklepie → zdania nie ma", () => {
    renderList([HOME_LIVE, KONTAKT_LIVE]);
    expect(document.querySelector("[data-site-home-not-live]")).toBeNull();
  });

  it("żywa PODSTRONA nie zastępuje strony głównej", () => {
    // Publikacja `/kontakt` nie stawia niczego pod `/` — od 0074 strony
    // współistnieją, a korzeń obsługuje wyłącznie strona z pustym adresem.
    renderList([{ ...HOME_LIVE, live: false, slugPublished: null }, KONTAKT_LIVE]);
    expect(document.querySelector("[data-site-home-not-live]")).toBeTruthy();
  });
});
