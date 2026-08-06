import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * PARZYSTOŚĆ PŁÓTNA I SKLEPU — KONTRAKT PO CAŁYM REJESTRZE (E8).
 *
 * ==================== CZEGO BRAKOWAŁO ====================
 *
 * Cała architektura kreatora stoi na jednym zdaniu (ADR-083): płótno NIE JEST
 * podobne do strony — jest tą samą stroną, obłożoną warstwą edycyjną. Do E8
 * zdania pilnowała UCZCIWOŚĆ: każdy typ strukturalny miał własne testy renderu
 * po swojej stronie, a to, że obie strony rysują to samo, wynikało z tego, że
 * nikt nie dopisał rozgałęzienia. Rozgałęzienie dopisane w E9 albo E14 nie
 * zapaliłoby ANI JEDNEGO testu — objawiłoby się dopiero u najemcy, który
 * opublikował coś innego, niż ustawiał.
 *
 * ==================== JAK TO JEST MIERZONE ====================
 *
 * Porównujemy JEDNOSTKI ZE SOBĄ (lekcja P1–P6), a nie z zapisanym wzorcem:
 * te same sekcje jadą DWA razy — raz przez `SiteBuilder` (płótno, pełna
 * warstwa edycyjna), raz przez goły `SiteRenderer` (tak, jak woła go sklep) —
 * i porównujemy DRZEWO KAŻDEJ SEKCJI, znak w znak. Identyfikatory generowane
 * przez React (`useId`) normalizujemy, bo są z definicji różne między
 * korzeniami renderu, a niosą zero informacji o wyglądzie.
 *
 * Zakres: KAŻDA para (typ, układ) z rejestru. Nowy typ i nowy wariant wchodzą
 * pod ten kontrakt SAME — nie ma tu ani jednej nazwy typu wpisanej z ręki poza
 * jawną allowlistą różnic.
 *
 * ==================== DWA PRZEBIEGI, DWIE RÓŻNE PRAWDY ====================
 *
 *   1. TEN SAM WSAD → drzewa muszą być IDENTYCZNE dla wszystkich par. To jest
 *      właściwe zdanie o parzystości renderu.
 *   2. WSAD SKLEPU (formularz kontaktu + zgoda na obcą ramkę — dwie rzeczy,
 *      które do renderera wnosi WYŁĄCZNIE sklep) → drzewa mają się różnić
 *      DOKŁADNIE na typach z allowlisty. Wpis w allowliście, który niczego nie
 *      tłumaczy, pali tak samo jak różnica bez wpisu: pierwszy jest martwym
 *      wyjątkiem, który za rok przykryje prawdziwy rozjazd.
 */
import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

const STYL = DEFAULT_SITE_STYLE;
const MONEY = { currency: "PLN", locale: "pl" } as const;
const SITE_ID = "99999999-9999-4999-8999-999999999999";

/**
 * RÓŻNICE EDYCYJNE, KTÓRE SĄ DECYZJĄ — nie rozjazdem.
 *
 * Lista dotyczy WYŁĄCZNIE przebiegu 2 (wsad sklepu). Każdy wpis nazywa rzecz,
 * którą do wspólnego renderera wnosi sklep, a panel świadomie nie wnosi.
 * Reszta warstwy edycyjnej (obrys sekcji, pasek narzędzi, „+”, stan pusty)
 * nie wymaga wpisu, bo mieszka POZA drzewem sekcji — w owijce, którą sklep ma
 * czym nie podać.
 */
const ROZNICE_EDYCYJNE: Record<string, { powod: string; widoczna: Stan }> = {
  contact: {
    powod: "szew formularza kontaktu (E4, ADR-095) — akcja serwerowa i bilet są tylko w sklepie",
    widoczna: "spoczynek",
  },
  directions: {
    powod: "zgoda na osadzenie obcej ramki mapy (E5, ADR-096) — CSP panelu jej nie ma",
    /*
      Dopiero PO KLIKNIĘCIU, i to jest sedno E5: zgoda dotyczy PRAWA do
      osadzenia, a samo osadzenie robi odwiedzający. W spoczynku obie strony
      rysują ten sam kafel — gdyby wpis mówił „od razu", ten test paliłby się
      jako martwy wyjątek i słusznie.
    */
    widoczna: "po odsłonięciu mapy",
  },
};

/**
 * Stany, w których mierzymy drzewo — W KOLEJNOŚCI. Sekcja dojazdu osadza obcą
 * ramkę dopiero po kliknięciu odwiedzającego, więc porównanie wyłącznie
 * w spoczynku nie dotknęłoby zgody z E5 ani razu.
 */
const STANY = ["spoczynek", "po odsłonięciu mapy"] as const;
type Stan = (typeof STANY)[number];

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
const { DEFAULT_SITE_LABELS, SiteRenderer } = await import("@avably/ui");
const { siteImagePublicBase } = await import("@/lib/site-image-base");
const { STRUCTURED_SECTION_TYPES, structuredPresetFor, structuredSpecOf, withStructuredLayout } =
  await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];
type Product = Parameters<typeof SiteBuilder>[0]["products"][number];

/** Katalog do sekcji sprzętu — bez niego jedyny typ z pustką byłby pusty w obu drzewach. */
const KATALOG: Product[] = [
  { id: "p-1", name: "Namiot 6×12", description: "Konstrukcja aluminiowa", priceLabel: "od 900,00 zł / doba", imageUrl: null, imageAlt: "" },
  { id: "p-2", name: "Krzesło bankietowe", description: null, priceLabel: "od 4,00 zł / doba", imageUrl: null, imageAlt: "" },
];

/** KAŻDA para (typ, układ) z rejestru — po jednej sekcji na parę. */
const PARY = STRUCTURED_SECTION_TYPES.flatMap((type) =>
  structuredSpecOf(type).layouts.map((layout) => ({
    type,
    layout,
    id: `${type}--${layout}`,
    content: withStructuredLayout(structuredPresetFor(type, "pl"), layout),
  })),
);

/**
 * FIKSTURA RÓŻNICUJĄCA — galeria ze zdjęciem Z MAGAZYNU.
 *
 * Presety galerii niosą zdjęcia z gotowymi adresami, więc na samych presetach
 * PREFIKS bucketa nie ma czego zmienić: obie strony narysowałyby ten sam kafel
 * także wtedy, gdyby płótno przestało go podawać. Ten jeden przypadek jest po
 * to, żeby wsad, który do renderera wnosi WARSTWA DANYCH, miał w kontrakcie
 * jakikolwiek ślad — bez niego rozjazd na prefiksie byłby niewidoczny.
 */
const GALERIA_Z_MAGAZYNU = {
  type: "gallery" as const,
  layout: "grid",
  id: "gallery--zdjecie-z-magazynu",
  content: {
    ...(structuredPresetFor("gallery", "pl") as unknown as Record<string, unknown>),
    items: [{ image: { kind: "storage", path: "tenant/realizacja.jpg" }, alt: "Namiot na łące", caption: "Wesele" }],
  } as never,
};

/** Wszystko, co porównujemy: rejestr w komplecie plus fikstury różnicujące. */
const PRZYPADKI = [...PARY, GALERIA_Z_MAGAZYNU];

function sekcje(): Section[] {
  return PRZYPADKI.map((przypadek, index) => ({
    id: przypadek.id,
    type: przypadek.type,
    position: index,
    enabled: true,
    content: przypadek.content,
  })) as Section[];
}

/** Formularz kontaktu tak, jak wnosi go sklep (E4) — treść nieistotna, obecność istotna. */
const SZEW_SKLEPU = {
  ticket: "bilet-testowy",
  submit: async () => ({ ok: true }) as never,
};

function renderPlotna() {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={SITE_ID}
        siteName="Strona sklepu"
        style={STYL}
        sections={sekcje()}
        products={KATALOG}
        money={MONEY}
      />
    </NextIntlClientProvider>,
  );
}

/**
 * Render TAK, JAK WOŁA GO SKLEP. `wsadSklepu` włącza dwie rzeczy, których panel
 * nie podaje — patrz `ROZNICE_EDYCYJNE`.
 */
function renderSklepu(wsadSklepu: boolean) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteRenderer
        sections={sekcje().map((s) => ({ id: s.id, position: s.position, type: s.type, content: s.content })) as never}
        style={STYL}
        products={KATALOG}
        money={MONEY}
        siteImageBase={siteImagePublicBase()}
        {...(wsadSklepu ? { contactForm: SZEW_SKLEPU as never, mapEmbed: true } : {})}
      />
    </NextIntlClientProvider>,
  );
}

/**
 * ZIARNO IDENTYFIKATORA Z `useId` — jedyna rzecz, która MUSI się różnić.
 *
 * React numeruje je w kolejności renderu, więc dwa osobne korzenie dostają inne
 * napisy dla tego samego węzła. Wartość nie mówi nic o wyglądzie; znaczenie ma
 * dopiero to, czy dwa atrybuty wskazują na siebie nawzajem — a tego pilnuje
 * podmiana na numer kolejny, robiona w CAŁYM napisie (więc `id`, `for`,
 * `aria-controls`, `aria-labelledby` i `name` grupy przycisków radiowych jadą
 * razem ze swoim celem).
 *
 * Ziarno wyłapujemy WZORCEM, a nie listą atrybutów `id`: sekcja dojazdu wkłada
 * je w `name` grupy przycisków radiowych, gdzie żaden skan po `id` go nie
 * zobaczy — i to jest dokładnie ten przypadek, który przy pierwszym podejściu
 * udawał rozjazd renderu.
 */
const ZIARNO_USEID = /_[rR]_[0-9a-z]+_|«[^»]+»|:[rR][0-9a-z]+:/g;

/** Ile ziaren wymieniono w ostatnim porównaniu — osłona przed cichą normalizacją donikąd. */
let wymienioneZiarna = 0;

/** Drzewo sekcji ze ZNORMALIZOWANYMI ziarnami `useId`. */
function drzewoSekcji(root: HTMLElement, sectionId: string): string | null {
  const wrapper = root.querySelector<HTMLElement>(`[data-section-id="${sectionId}"]`);
  const sekcja = wrapper?.querySelector<HTMLElement>("[data-structured-section]");
  if (!sekcja) return null;

  let html = sekcja.outerHTML;
  const ziarna: string[] = [];
  for (const [ziarno] of html.matchAll(ZIARNO_USEID)) {
    if (!ziarna.includes(ziarno)) ziarna.push(ziarno);
  }
  // Najdłuższe najpierw: ziarno bywa przedrostkiem innego.
  for (const ziarno of [...ziarna].sort((a, b) => b.length - a.length)) {
    html = html.split(ziarno).join(`#id-${ziarna.indexOf(ziarno)}`);
    wymienioneZiarna += 1;
  }
  return html;
}

afterEach(cleanup);

describe("rejestr jest niepusty i cały wchodzi pod kontrakt", () => {
  it("każdy typ wnosi co najmniej jeden układ, a par jest więcej niż typów", () => {
    // Kontrola po pustym zbiorze: bez niej wszystkie asercje niżej przechodzą
    // dla zera porównań.
    expect(STRUCTURED_SECTION_TYPES.length).toBeGreaterThan(5);
    expect(PARY.length).toBeGreaterThan(STRUCTURED_SECTION_TYPES.length);
    for (const type of STRUCTURED_SECTION_TYPES) {
      expect(PARY.some((para) => para.type === type), `typ "${type}" wypadł ze zbioru par`).toBe(true);
    }
  });

  it("allowlista różnic wymienia WYŁĄCZNIE typy z rejestru", () => {
    // Wpis na typ, którego nie ma, byłby wyjątkiem bez podmiotu — a przy zmianie
    // nazwy typu przykryłby prawdziwą różnicę.
    for (const type of Object.keys(ROZNICE_EDYCYJNE)) {
      expect(
        (STRUCTURED_SECTION_TYPES as readonly string[]).includes(type),
        `allowlista wymienia typ spoza rejestru: ${type}`,
      ).toBe(true);
    }
  });
});

describe("ten sam wsad → to samo drzewo, para po parze", () => {
  it("płótno kreatora rysuje KAŻDĄ parę (typ, układ) tak, jak sklep", () => {
    const plotno = renderPlotna();
    const sklep = renderSklepu(false);

    const rozjazdy: string[] = [];
    let porownane = 0;

    for (const para of PRZYPADKI) {
      const zPlotna = drzewoSekcji(plotno.container, para.id);
      const zeSklepu = drzewoSekcji(sklep.container, para.id);
      if (zPlotna === null || zeSklepu === null) {
        rozjazdy.push(`${para.id}: sekcja nie wyrenderowała się po stronie ${zPlotna === null ? "płótna" : "sklepu"}`);
        continue;
      }
      porownane += 1;
      if (zPlotna !== zeSklepu) {
        rozjazdy.push(
          `${para.id}: drzewa się różnią\n  płótno: ${zPlotna.slice(0, 400)}\n  sklep:  ${zeSklepu.slice(0, 400)}`,
        );
      }
    }

    expect(porownane, "nie porównano ani jednego przypadku").toBe(PRZYPADKI.length);
    /*
     * Normalizacja MUSI mieć co robić. Gdyby React zmienił kształt ziarna
     * `useId`, wzorzec przestałby cokolwiek łapać — a wtedy test albo padłby
     * hurtem (i wina wyglądałaby na rozjazd renderu), albo, gdyby ziaren akurat
     * nie było, chwaliłby porównanie, którego nikt nie osłonił.
     */
    expect(wymienioneZiarna, "normalizacja identyfikatorów nie wymieniła ANI JEDNEGO").toBeGreaterThan(0);
    expect(rozjazdy, `płótno rozjechało się ze sklepem:\n${rozjazdy.join("\n")}`).toEqual([]);
  });
});

describe("wsad sklepu → różnice DOKŁADNIE tam, gdzie mówi allowlista", () => {
  /** Odsłonięcie mapy TAK, JAK ROBI TO ODWIEDZAJĄCY — klik w każdy przycisk „pokaż mapę". */
  async function odsloniecieMapy(root: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
    const przyciski = within(root).queryAllByRole("button", {
      name: DEFAULT_SITE_LABELS.directionsShowMap,
    });
    for (const przycisk of przyciski) await user.click(przycisk);
    return przyciski.length;
  }

  it.each(STANY)(
    "%s: różnica jest DOKŁADNIE tam, gdzie i od kiedy obiecuje allowlista",
    async (stan) => {
      const user = userEvent.setup();
      const plotno = renderPlotna();
      const sklep = renderSklepu(true);

      if (stan === "po odsłonięciu mapy") {
        const naPlotnie = await odsloniecieMapy(plotno.container, user);
        const wSklepie = await odsloniecieMapy(sklep.container, user);
        // Sam przycisk stoi po OBU stronach — to jest część kontraktu E5
        // („brak zgody NIE WYŁĄCZA mechaniki"). Gdyby go zabrakło, ten stan
        // niczym nie różniłby się od spoczynku i przebieg byłby powtórką.
        expect(naPlotnie, "płótno nie ma czym odsłonić mapy").toBeGreaterThan(0);
        expect(wSklepie, "sklep nie ma czym odsłonić mapy").toBe(naPlotnie);
      }

      const niezgodne: string[] = [];

      for (const para of PRZYPADKI) {
        const zPlotna = drzewoSekcji(plotno.container, para.id)!;
        const zeSklepu = drzewoSekcji(sklep.container, para.id)!;
        const rozne = zPlotna !== zeSklepu;
        const wpis = ROZNICE_EDYCYJNE[para.type];
        /*
         * Różnica raz odsłonięta już nie znika, więc wpis obowiązuje OD swojego
         * stanu w GÓRĘ. Sam stan nie jest przypisem: zadeklarowanie mapy jako
         * „widocznej od razu" pali ten test w spoczynku — i słusznie, bo zgoda
         * z E5 dotyczy PRAWA do osadzenia, a nie osadzenia.
         */
        const oczekiwanaRoznica = wpis !== undefined && STANY.indexOf(wpis.widoczna) <= STANY.indexOf(stan);

        if (rozne && !oczekiwanaRoznica) {
          niezgodne.push(
            `${para.id} (${stan}): różnica bez pokrycia w allowliście\n  płótno: ${zPlotna.slice(0, 300)}\n  sklep:  ${zeSklepu.slice(0, 300)}`,
          );
        }
        if (!rozne && oczekiwanaRoznica) {
          niezgodne.push(`${para.id} (${stan}): allowlista obiecuje różnicę („${wpis!.powod}”), a jej nie ma`);
        }
      }

      expect(niezgodne, `allowlista rozjechała się z rzeczywistością:\n${niezgodne.join("\n")}`).toEqual([]);
    },
  );
});
