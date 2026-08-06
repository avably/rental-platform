import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * PŁÓTNO STOI, STRONA SIĘ RUSZA (E8 — przewód i bramka pod E9).
 *
 * ==================== O CO TOCZY SIĘ GRA ====================
 *
 * Animacje wejścia sekcji są DANYMI MOTYWU (K6, ADR-092): jedna rodzina klatek
 * w arkuszu czyta liczby z presetu, który wskazał motyw, a ostatnie słowo ma
 * `prefers-reduced-motion` czytelnika. Kontrakt tamtej warstwy stoi w pakiecie
 * renderu (`site-motion.test.tsx`) i dowodzi, że `motion="off"` wystawia
 * znacznik, którego reguła wejścia nie obejmuje.
 *
 * Czego on NIE dowodzi — i po co jest ten plik: że KREATOR ten znacznik
 * naprawdę podaje. Do E8 pilnowała tego uczciwość trzech miejsc w panelu.
 * Trzy miejsca to trzy okazje do pomyłki, a jej objaw jest podstępny: strona
 * wygląda normalnie, tylko przy każdym przewinięciu palety sekcje przenikają,
 * więc nie da się w nich nic ustawić. Zrzut ekranu tego nie pokaże.
 *
 * ==================== TRZY ZDANIA SPRAWDZALNE ====================
 *
 *   1. KAŻDY korzeń strony wyrenderowany w powierzchni EDYCYJNEJ (płótno,
 *      podglądy pickera, miniatury galerii szablonów) niesie `off`;
 *   2. ŻADNA ścieżka płótna nie ma jak przepuścić czegoś innego — sprawdzane
 *      w ŹRÓDLE, bo test DOM-u broni wyłącznie powierzchni, które już
 *      istnieją, a czwarta dopisana jutro weszłaby pod nim bez słowa;
 *   3. PODGLĄD SZKICU i SKLEP znacznika NIE niosą — ruch jedzie tam z motywu.
 *      Bez tej kontroli negatywnej „wszędzie off" spełniałby też kreator,
 *      który wyłączył animacje CAŁEMU produktowi.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

const STYL = DEFAULT_SITE_STYLE;
const MONEY = { currency: "PLN", locale: "pl" } as const;
const SITE_ID = "99999999-9999-4999-8999-999999999999";
const FAQ_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const GALLERY_ID = "cccccccc-3333-4333-8333-333333333333";

const panelRoot = process.cwd();
const repositoryRoot = resolve(panelRoot, "../..");
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

/** Katalog PŁÓTNA — wszystko, co rysuje powierzchnię edycyjną kreatora. */
const KATALOG_PLOTNA = "apps/panel/app/[locale]/(kreator)/strona/[siteId]/kreator";
const TRASA_PODGLADU = "apps/panel/app/[locale]/(kreator)/strona/[siteId]/podglad/page.tsx";
const POWLOKA_SKLEPU = "apps/storefront/components/storefront/store-chrome.tsx";

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
  upsertSection: vi.fn(),
  reorderSections: vi.fn(),
  toggleSection: vi.fn(),
  duplicateSection: vi.fn(),
  deleteSection: vi.fn(),
  restoreSection: vi.fn(),
  updateSiteStyle: vi.fn(),
  applyStarterTemplate: vi.fn(),
  publishSite: vi.fn(),
}));

vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");
const { SiteRenderer } = await import("@avably/ui");
const { structuredPresetFor } = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

function faqSection(): Section {
  return {
    id: FAQ_ID,
    type: "faq",
    position: 0,
    enabled: true,
    content: structuredPresetFor("faq", "pl"),
  } as Section;
}

/**
 * FIKSTURA RÓŻNICUJĄCA — galeria z powiększeniem zdjęcia.
 *
 * Wnosi na płótno DRUGI, ZAGNIEŻDŻONY korzeń strony (panel powiększenia).
 * Bez niej kontrakt chodziłby po drzewie z jednym korzeniem i nie odróżniłby
 * „każdy korzeń ma off" od „każdy korzeń NAD SEKCJĄ ma off" — a to jest cała
 * różnica między zdaniem prawdziwym a takim, które wywraca się przy pierwszej
 * galerii na stronie (znalezione na buildzie produkcyjnym).
 */
function gallerySection(): Section {
  return {
    id: GALLERY_ID,
    type: "gallery",
    position: 1,
    enabled: true,
    content: structuredPresetFor("gallery", "pl"),
  } as Section;
}

function renderBuilder(sections: Section[]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={SITE_ID}
        siteName="Strona sklepu"
        style={STYL}
        sections={sections}
        products={[]}
        money={MONEY}
      />
    </NextIntlClientProvider>,
  );
}

/**
 * Wywołania wspólnego renderera w pliku, BEZ komentarzy w środku.
 *
 * Komentarze trzeba zdjąć w obie strony: proza cytująca `motion="off"` w
 * uzasadnieniu spełniłaby asercję o obecności flagi tam, gdzie flagi nie ma —
 * i wywróciłaby asercję o jej braku tam, gdzie jej naprawdę nie ma. Skan po
 * źródle ma czytać KOD.
 */
function wywolaniaRenderera(source: string): string[] {
  const bezKomentarzy = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  return bezKomentarzy.match(/<SiteRenderer[\s\S]*?\/>/g) ?? [];
}

/**
 * Tryby ruchu WSZYSTKICH korzeni strony NAD każdą sekcją w poddrzewie.
 *
 * Nie „każdy korzeń w drzewie", tylko dokładnie to, co mówi selektor arkusza:
 * `[data-site-reveal="armed"] .site-root:not([data-site-motion="off"]) [data-section-reveal]`
 * zapala się, gdy
 * ISTNIEJE przodek-korzeń bez znacznika. Korzenie bywają zagnieżdżone —
 * powiększenie zdjęcia w galerii wystawia własny (`site-lightbox`) i nie niesie
 * znacznika, bo nie ma pod sobą ani jednej sekcji. Liczenie go do „każdy korzeń
 * ma off" byłoby fałszywą czerwienią; pominięcie zagnieżdżenia w ogóle —
 * fałszywą zielenią, gdyby kiedyś sekcja pod takim korzeniem stanęła.
 */
function trybyNadSekcjami(root: HTMLElement): (string | null)[] {
  const tryby: (string | null)[] = [];
  for (const sekcja of root.querySelectorAll<HTMLElement>("[data-section-id]")) {
    let przodek = sekcja.parentElement;
    while (przodek) {
      if (przodek.classList.contains("site-root")) tryby.push(przodek.getAttribute("data-site-motion"));
      przodek = przodek.parentElement;
    }
  }
  return tryby;
}

afterEach(cleanup);

describe("warstwa edycyjna kreatora stoi", () => {
  it("płótno: każdy korzeń strony niesie off", () => {
    const { container } = renderBuilder([faqSection(), gallerySection()]);
    const plotno = container.querySelector<HTMLElement>("[data-builder-canvas]");
    expect(plotno, "nie znaleziono płótna").not.toBeNull();
    expect(
      plotno!.querySelectorAll(".site-root").length,
      "fikstura miała wnieść zagnieżdżony korzeń (powiększenie galerii)",
    ).toBeGreaterThan(1);

    const tryby = trybyNadSekcjami(plotno!);
    expect(tryby.length, "płótno nie wyrenderowało ani jednej sekcji pod korzeniem").toBeGreaterThan(0);
    expect(tryby, "płótno przepuściło ruch motywu").toEqual(tryby.map(() => "off"));
  });

  it("podglądy w pickerze sekcji: każdy korzeń niesie off", async () => {
    const user = userEvent.setup();
    renderBuilder([faqSection(), gallerySection()]);

    // Drogą operatora: paleta → „Dodaj sekcję" otwiera picker z podglądami.
    await user.click(screen.getByRole("button", { name: plMessages.site.sections.add }));
    const picker = await screen.findByRole("dialog");

    const tryby = trybyNadSekcjami(picker);
    expect(tryby.length, "picker nie pokazał ani jednego podglądu").toBeGreaterThan(0);
    expect(tryby, "podgląd wariantu przepuścił ruch motywu").toEqual(tryby.map(() => "off"));
  });

  it("miniatury galerii szablonów: każdy korzeń niesie off", () => {
    // Strona bez sekcji otwiera galerię z automatu (K5 v2) — to jest pierwsza
    // powierzchnia, którą operator w ogóle widzi.
    const { container } = renderBuilder([]);
    const galeria = container.querySelector<HTMLElement>("[data-template-gallery]") ?? container;

    const tryby = trybyNadSekcjami(galeria);
    expect(tryby.length, "galeria nie pokazała ani jednej miniatury").toBeGreaterThan(0);
    expect(tryby, "miniatura szablonu przepuściła ruch motywu").toEqual(tryby.map(() => "off"));
  });
});

describe("kontrola negatywna: poza edytorem ruch JEDZIE", () => {
  it("ten sam renderer wywołany jak w sklepie nie niesie ŻADNEGO znacznika trybu", () => {
    // Bez tego zdania „wszędzie off" spełniałby też kreator, który wyłączyłby
    // animacje całemu produktowi — a wtedy bramka broniłaby pustki.
    const { container } = render(
      <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
        <SiteRenderer
          sections={[{ id: FAQ_ID, position: 0, type: "faq", content: structuredPresetFor("faq", "pl") }] as never}
          style={STYL}
          money={MONEY}
        />
      </NextIntlClientProvider>,
    );
    expect(trybyNadSekcjami(container)).toEqual([null]);
  });
});

describe("żadna ścieżka płótna nie ma jak przepuścić ruchu", () => {
  /** Pliki płótna, które w ogóle wołają render strony. */
  const pliki = readdirSync(resolve(repositoryRoot, KATALOG_PLOTNA))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => ({ name, source: read(`${KATALOG_PLOTNA}/${name}`) }))
    .filter((plik) => plik.source.includes("<SiteRenderer"));

  it("kontrola po pustym zbiorze: płótno naprawdę woła render strony", () => {
    expect(pliki.map((plik) => plik.name).sort()).toEqual([
      "builder-canvas.tsx",
      "section-picker.tsx",
      "template-gallery.tsx",
    ]);
  });

  it.each(pliki.map((plik) => plik.name))("%s: KAŻDE wywołanie renderera ma motion=\"off\"", (name) => {
    const source = pliki.find((plik) => plik.name === name)!.source;
    /*
     * Bierzemy KAŻDE otwarcie znacznika aż do jego zamknięcia. Zliczanie samych
     * wystąpień `motion="off"` przechodziłoby dla pliku z dwoma wywołaniami,
     * z których jedno ma flagę dwa razy, a drugie wcale.
     */
    const wywolania = wywolaniaRenderera(source);
    expect(wywolania.length, "znaleziono wywołanie, którego nie da się domknąć").toBeGreaterThan(0);
    const bezFlagi = wywolania.filter((wywolanie) => !wywolanie.includes('motion="off"'));
    expect(bezFlagi, `wywołanie renderera bez motion="off" w ${name}:\n${bezFlagi.join("\n---\n")}`).toEqual([]);
  });

  it("PODGLĄD SZKICU stoi po drugiej stronie bramki — jawne auto, nie off", () => {
    const trasa = read(TRASA_PODGLADU);
    expect(trasa.length, "pusty plik trasy — kontrola po pustym zbiorze").toBeGreaterThan(500);
    // Czytamy WYWOŁANIE, nie plik: uzasadnienie decyzji stoi w komentarzu obok,
    // a skan po całym pliku badałby prozę zamiast kodu.
    const wywolania = wywolaniaRenderera(trasa);
    expect(wywolania.length, "podgląd przestał wołać wspólny renderer").toBe(1);
    expect(wywolania[0], "podgląd zatrzymał stronę tak, jak płótno").not.toContain('motion="off"');
    expect(wywolania[0], "podgląd nie mówi wprost, że jest w ruchu").toContain('motion="auto"');
  });

  it("POWŁOKA SKLEPU nie zatrzymuje strony klienta", () => {
    const powloka = read(POWLOKA_SKLEPU);
    expect(powloka.length, "pusty plik powłoki — kontrola po pustym zbiorze").toBeGreaterThan(200);
    expect(powloka, "sklep wyłączył animacje wszystkim najemcom").not.toContain('motion="off"');
  });
});

describe("preferencja czytelnika stoi PONAD trybem", () => {
  it("arkusz renderu bramkuje wejście sekcji zapytaniem o ograniczony ruch", () => {
    /*
     * Zdanie należy do arkusza (`packages/ui/site.css`) i ma tam własny,
     * szczegółowy kontrakt (K6). Powtarzamy je tutaj w jednym zdaniu, bo E8
     * dokłada DRUGI sposób wyłączenia ruchu (`data-site-motion`) i musi być
     * jasne, że nie stał się on OBEJŚCIEM preferencji: tryb rozstrzyga, czy
     * animacja w ogóle wchodzi w grę, a preferencja — czy wolno ją odtworzyć.
     */
    const arkusz = read("packages/ui/src/site/site.css");
    const bramka = arkusz.indexOf("@media (prefers-reduced-motion: no-preference)");
    /*
     * Selektor celuje w PUDEŁKO TREŚCI (addendum E9), a stan startowy stoi pod
     * atrybutem uzbrojenia (ADR-097). Pilnujemy OBU: reguła stanu startowego
     * musi stać pod bramką preferencji, a warstwa edycyjna musi być z niej
     * wykluczona zapisem `:not([data-site-motion="off"])`.
     */
    const regula = arkusz.indexOf(
      '[data-site-reveal="armed"] .site-root:not([data-site-motion="off"]) [data-section-reveal="block"]',
    );
    expect(bramka, "arkusz stracił bramkę preferencji").toBeGreaterThan(-1);
    expect(regula, "arkusz stracił regułę wejścia sekcji").toBeGreaterThan(-1);
    expect(regula, "reguła wejścia wypadła sprzed bramki preferencji").toBeGreaterThan(bramka);
  });
});
