// @vitest-environment jsdom

/**
 * KORZEŃ SKLEPU DA SIĘ ZAŁOŻYĆ Z PANELU (ADR-168) — i dalej tylko RAZ.
 *
 * ===================== WADA, KTÓRĄ TEN PLIK ODTWARZA =====================
 *
 * Najemca zakładany dziś ma ZERO stron: `app.create_tenant` (ostatnia
 * definicja — 0070) tworzy organizację, członkostwo, dowód akceptacji
 * regulaminu i subdomenę, ale ani jednego wiersza `sites`. Jedyną drogą do
 * strony była akcja `createSite` przez okno „Nowa strona", które WYMAGAŁO
 * niepustego adresu — a adresem strony głównej jest adres pusty. Korzeń sklepu
 * nowego konta zostawał więc pusty NA ZAWSZE, a operator nie dostawał ani
 * jednego sygnału: budował podstrony pod `/kontakt` i `/oferta`, i każda z nich
 * działała.
 *
 * ===================== DLACZEGO TEST IDZIE DROGĄ OPERATORA =====================
 *
 * Sama akcja `createSite({ name })` zakładała stronę główną także PRZED tą
 * poprawką (gałąź `?? HOME_PAGE_SLUG` istnieje od 0073) — test na poziomie
 * akcji byłby więc zielony przy wadzie w pełnej krasie. Wada mieszkała
 * w EKRANIE, który tej gałęzi nie umiał wywołać. Dlatego kontrolek szukamy po
 * DOSTĘPNEJ NAZWIE, klikamy `userEvent`-em, a mierzymy WYWOŁANIE AKCJI —
 * w szczególności to, czego w wywołaniu NIE MA (klucza `slug`).
 *
 * ===================== DRUGA POŁOWA: JEDNA STRONA GŁÓWNA =====================
 *
 * Zakaz pustego adresu w `contentPageSlugSchema` powstał po to, żeby nie dało
 * się założyć DRUGIEJ strony głównej — publikacja odrzuciłaby ją dopiero przez
 * 23505, już po zbudowaniu treści. Poprawka go NIE ZDEJMUJE, tylko zawęża:
 * pusty adres WPISANY W POLE dalej jest błędem, a droga bez adresu pokazuje się
 * wyłącznie wtedy, gdy strony głównej nie ma. Oba zdania stoją niżej i psują
 * się osobno.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

beforeAll(() => {
  // Radix (Dialog) woła te API wskaźnika i obserwatora — jsdom ich nie ma.
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

/** Strona treściowa — istnieje, działa i NIE JEST korzeniem sklepu. */
const KONTAKT: Row = {
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

const HOME: Row = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Strona główna",
  live: false,
  slug: "",
  slugPublished: null,
  redirectOldSlug: true,
  redirectedFrom: [],
  publishedAtLabel: null,
  createdAtLabel: "10.08.2026",
};

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

beforeEach(() => {
  actions.createSite.mockReset();
  actions.createSite.mockResolvedValue({ ok: true, siteId: HOME.id });
});
afterEach(cleanup);

describe("najemca bez ani jednej strony dochodzi do strony głównej (ADR-168)", () => {
  for (const [locale, messages] of [
    ["pl", plMessages],
    ["en", enMessages],
  ] as const) {
    it(`${locale}: droga do korzenia sklepu istnieje i wysyła wywołanie BEZ adresu`, async () => {
      const user = userEvent.setup();
      renderList([], locale);

      // Ekran NAZYWA stan po skutku dla klienta, a nie po braku wiersza.
      expect(screen.getByText(messages.site.pages.homeMissingTitle)).toBeTruthy();

      await user.click(screen.getByRole("button", { name: messages.site.pages.newHome }));

      const dialog = screen.getByRole("dialog");
      /*
        Adres jest WYGASZONY, a nie ukryty: `/` to informacja („tu stanie ta
        strona"), a nie brak funkcji. Ukryte pole kazałoby operatorowi zgadywać,
        czy strona główna w ogóle ma adres.
      */
      const address = within(dialog).getByLabelText(messages.site.pages.slugLabel);
      expect((address as HTMLInputElement).disabled, "pole adresu strony głównej jest edytowalne").toBe(
        true,
      );
      expect(dialog.textContent).toContain(messages.site.pages.slugHome);

      await user.click(
        within(dialog).getByRole("button", { name: messages.site.pages.newHomeConfirm }),
      );

      expect(actions.createSite).toHaveBeenCalledTimes(1);
      const input = actions.createSite.mock.calls[0]![0] as Record<string, unknown>;
      /*
        SEDNO CAŁEJ POPRAWKI. Klucz `slug` obecny z wartością `""` przechodzi
        przez `contentPageSlugSchema` i wraca odmową „Podaj adres strony…" —
        czyli dokładnie tym, co blokowało nowego najemcę. Intencję „strona
        główna" niesie POMINIĘCIE klucza, nie jego pusta wartość.
      */
      expect(Object.keys(input), "wywołanie niesie adres — schemat je odrzuci").toEqual(["name"]);
      expect(input.name).toBe(messages.site.pages.homeDefaultName);
    });
  }

  it("stan „są strony, nie ma korzenia” też jest złapany — nie tylko puste konto", () => {
    // Najemca, który zaczął od `/kontakt`, ma pod `/` dokładnie tę samą pustkę
    // co konto świeże. Warunek na `rows.length === 0` przepuściłby ten stan.
    const { container } = renderList([KONTAKT]);
    expect(container.querySelector("[data-site-home-missing]")).not.toBeNull();
  });

  it("strona główna PRZENIESIONA w szkicu pod inny adres nie liczy się jako brak", () => {
    // `slug` (szkic) mówi, co operator edytuje; `slug_published` — co klient
    // ma pod `/`. Pytanie „czy sklep ma stronę główną" musi objąć OBA, inaczej
    // ekran zaprasza do założenia drugiej strony pod adresem, który jest zajęty
    // ŻYWO i pada dopiero na publikacji (23505).
    const przeniesiona: Row = { ...HOME, slug: "o-nas", slugPublished: "", live: true };
    const { container } = renderList([przeniesiona]);
    expect(container.querySelector("[data-site-home-missing]")).toBeNull();
  });
});

describe("druga strona główna dalej niemożliwa z panelu (zawężenie, nie zdjęcie zakazu)", () => {
  it("przy istniejącej stronie głównej NIE MA kontrolki zakładającej ją bez adresu", () => {
    const { container } = renderList([HOME, KONTAKT]);

    expect(container.querySelector("[data-site-home-missing]")).toBeNull();
    expect(
      screen.queryByRole("button", { name: plMessages.site.pages.newHome }),
      "druga droga do strony głównej stoi otworem",
    ).toBeNull();
  });

  it("okno „Nowa strona” dalej ODMAWIA pustego adresu — z uzasadnieniem w polu", async () => {
    const user = userEvent.setup();
    renderList([HOME]);

    await user.click(screen.getByRole("button", { name: plMessages.site.pages.new }));
    const dialog = screen.getByRole("dialog");

    // „???" to nazwa, z której `suggestPageSlug` nie wyprowadzi ANI JEDNEGO
    // znaku — pole adresu zostaje puste bez udziału operatora. To jest ta
    // droga, którą wywołanie sprzed fazy 2 zakładało drugą stronę główną.
    await user.type(within(dialog).getByLabelText(plMessages.site.pages.nameLabel), "???");

    expect(
      within(dialog).getByText("Podaj adres strony — z tej nazwy nie da się go wyprowadzić."),
      "zakaz pustego adresu zniknął razem z poprawką",
    ).toBeTruthy();
    expect(
      within(dialog)
        .getByRole("button", { name: plMessages.site.pages.newConfirm })
        .hasAttribute("disabled"),
    ).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: plMessages.site.pages.newConfirm }));
    expect(actions.createSite, "pusty adres z pola poszedł do akcji").not.toHaveBeenCalled();
  });
});

describe("kontrola pozytywna kopii", () => {
  it("napisy PL i EN są RÓŻNE — inaczej obie pętle mierzą ten sam napis", () => {
    for (const key of ["homeMissingTitle", "homeMissingBody", "newHome", "newHomeTitle", "newHomeBody", "newHomeConfirm", "homeDefaultName"] as const) {
      expect(plMessages.site.pages[key], `brak tłumaczenia klucza ${key}`).not.toBe(
        enMessages.site.pages[key],
      );
    }
  });
});
