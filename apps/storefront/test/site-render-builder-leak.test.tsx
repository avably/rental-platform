/**
 * WARSTWA EDYCYJNA KREATORA NIE WYCIEKA DO PUBLICZNEGO RENDERU (K1, ADR-083).
 *
 * Kreator i sklep dzielą JEDEN renderer (`SiteRenderer`) — to jest decyzja
 * architektoniczna, nie oszczędność: dwa renderery znaczyłyby dwa źródła prawdy
 * o wyglądzie sekcji i płótno przestałoby być dowodem na to, co zobaczy klient.
 * Cena tej decyzji jest dokładnie jedna i mieszka w tym pliku: skoro renderer
 * jest wspólny, ktoś kiedyś może wnieść do niego obrys, pasek narzędzi albo
 * uchwyt przeciągania — i wystawić je anonimowemu odwiedzającemu.
 *
 * Kontrakt stoi po stronie SKLEPU, a nie panelu, bo to sklep jest stroną
 * poszkodowaną. Broni dwóch rzeczy naraz:
 *   1. WYNIKU — render wywołany tak, jak robi to storefront (bez `sectionWrapper`),
 *      nie zawiera ANI JEDNEGO znacznika warstwy edycyjnej;
 *   2. SPOSOBU — źródła sklepu nigdzie nie podają własnej owijki sekcji, więc
 *      nie ma czym tej warstwy wnieść nawet przypadkiem.
 *
 * Dowód mutacyjny (opis w raporcie): dołożenie owijki kreatora do renderu
 * sklepu — albo wpisanie paska narzędzi w DOMYŚLNĄ owijkę `SiteRenderer` —
 * zapala ten plik na czerwono.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sectionCanvasFrom } from "@avably/core/site";
import { SiteRenderer, type RenderSection } from "@avably/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/**
 * Znaczniki, którymi kreator opisuje SWOJĄ warstwę (patrz builder-canvas oraz —
 * od K2 — canvas-elements). Lista rośnie razem z warstwą edycyjną: nowy element
 * interfejsu kreatora, który nie trafi tutaj, przestaje być pilnowany.
 */
const BUILDER_LAYER_MARKERS = [
  "data-canvas-section",
  "data-section-toolbar",
  "data-section-outline",
  "data-section-hidden",
  "data-insert-slot",
  "data-insert-at",
  "data-drag-handle",
  "data-add-section-tile",
  "data-builder",
  // Warstwa elementów płótna v2 (K2, ADR-084): ramka zaznaczenia, uchwyty
  // rozmiaru, prowadnice przyciągania i akcje warstw.
  "data-element-frame",
  "data-element-selected",
  "data-resize-handle",
  "data-canvas-guide",
  "data-element-actions",
  "data-canvas-settings",
  "data-element-settings",
  // Warstwa podglądu gestu (K2c, ADR-087): obrys miejsca lądowania i pula linii
  // prowadnic. Rysuje je silnik gestów kreatora, sklep nie ma po nich śladu.
  "data-canvas-gesture-layer",
  "data-canvas-ghost",
  "data-canvas-guide-slot",
  "data-dragging",
  // Paleta elementów, edycja w miejscu i picker zdjęcia (K3, ADR-086).
  "data-element-tile",
  "data-palette-elements",
  "data-element-editing",
  "data-inline-editor",
  "data-inline-toolbar",
  "data-inline-format",
  "data-inline-link-form",
  "data-inline-link-apply",
  "data-image-picker",
  "data-picker-tab",
  "data-picker-upload",
  "data-picker-search",
  "data-picker-search-run",
  "data-picker-photo",
  "data-picker-photo-author",
  // Galeria szablonów, panel „Styl strony" i „zacznij od nowa" (K5 v2, ADR-090).
  // Miniatury w galerii renderują SiteRenderer, więc znaczniki tej warstwy mają
  // szczególny powód, żeby nigdy nie wyjechać na publiczną stronę.
  "data-template-gallery",
  "data-template-gallery-dismiss",
  "data-starter-template",
  "data-builder-style",
  "data-style-accent",
  "data-style-font-pair",
  "data-builder-start-over",
  "data-start-over-scope",
  "data-start-over-confirm",
  // Skorupa i pasek narzędzi kreatora — dopisane przy nodze kompletności (K3).
  // Były w warstwie od K1/K2, ale rejestr ich nie znał, bo nikt go nie sprawdzał;
  // to jest dokładnie ta cicha luka, którą noga niżej zamyka.
  "data-site-builder",
  "data-viewport",
  "data-section-remove",
  "data-section-settings",
  "data-canvas-no-selection",
  "data-guide-kind",
  // Paleta i galeria typów sekcji — również warstwa kreatora, choć część z nich
  // renderuje plik z pasa ekranu „Strona sklepu".
  "data-palette",
  "data-add-section",
  // Akcje pasków jako IKONY (K3, punkt 4) i wejście w picker z szuflady.
  "data-toolbar-action",
  "data-element-image-pick",
  // Widok mobilny (K4, ADR-088): znacznik elementu z RĘCZNĄ poprawką układu
  // (plus jego kropka na ramce) i przełącznik wymiaru na „z treści".
  "data-element-detached",
  "data-element-hug",
  // Sekcja USUNIĘTA W SZKICU (K5a, ADR-091): jej oznaczenie, przywrócenie
  // i zakres ostrzeżenia w dialogu usunięcia. Nagrobek żyje WYŁĄCZNIE
  // w kreatorze — sklep dostaje sekcję zwykłą aż do publikacji, a potem nie
  // dostaje jej wcale, więc żaden z tych znaczników nie ma prawa tam trafić.
  "data-section-deleted",
  "data-section-restore",
  "data-remove-scope",
  // Wskazanie miejsca upuszczenia i sekcja przypięta (K6, ADR-092). Belka celu
  // i obrys sekcji-celu są komunikatem KREATORA — w sklepie nie ma czego
  // wskazywać, więc żaden z tych znaczników nie ma prawa tam trafić.
  "data-insert-active",
  "data-insert-target",
  "data-drop-target",
  "data-section-pinned",
] as const;

/** Płótno v2 (K2) — ta sama treść co sekcja hero v1, tylko w elementach. */
const heroCanvas = sectionCanvasFrom("hero", {
  heading: "Sprzęt na już",
  subheading: "Rezerwacja online.",
  ctaText: "Katalog",
  ctaHref: "#produkty",
});

const sections: RenderSection[] = [
  {
    id: "s1",
    position: 0,
    type: "hero",
    content: { heading: "Sprzęt na już", subheading: "Rezerwacja online.", ctaText: "Katalog", ctaHref: "#produkty" },
  },
  { id: "s2", position: 1, type: "pricing", content: { heading: "Warunki cenowe", note: "Doba od 8:00." } },
  { id: "s3", position: 2, type: "faq", content: { heading: "Pytania", items: [{ q: "Jak rezerwować?", a: "Online." }] } },
  // Sekcja w NOWEJ generacji treści — publiczny render musi być tak samo czysty.
  { id: "s4", position: 3, type: "hero", content: heroCanvas },
] as RenderSection[];

/** Render DOKŁADNIE taki, jaki robi trasa sklepu: bez własnej owijki sekcji. */
const html = renderToStaticMarkup(<SiteRenderer sections={sections} />);

describe("publiczny render strony sklepu nie niesie warstwy edycyjnej", () => {
  it("fixture naprawdę coś renderuje — OBIE generacje treści", () => {
    // Kontrola po pustym zbiorze: wszystkie asercje `not.toContain` niżej
    // przelatywałyby na pustym stringu i broniły niczego.
    expect(html.length).toBeGreaterThan(200);
    expect(html).toContain("Sprzęt na już");
    expect(html).toContain("Warunki cenowe");
    // Płótno v2 naprawdę weszło do renderu — inaczej znaczniki warstwy
    // elementów nie miałyby gdzie wyciec i ta połowa kontraktu byłaby pusta.
    expect(html).toContain("data-canvas-grid");
    expect(html).toContain('data-element-kind="heading"');
  });

  it("w renderze nie ma ANI JEDNEGO znacznika warstwy kreatora", () => {
    for (const marker of BUILDER_LAYER_MARKERS) {
      expect(html, `warstwa kreatora w publicznym renderze: ${marker}`).not.toContain(marker);
    }
  });

  it("domyślna owijka to SAMA kotwica sekcji — nic poza nią", () => {
    // Kotwica zostaje (po niej podgląd i płótno znajdują sekcję w dokumencie),
    // ale jest jedyną rzeczą, którą renderer dokłada od siebie.
    expect([...html.matchAll(/data-section-id="/g)]).toHaveLength(sections.length);
    for (const section of sections) {
      expect(html).toContain(`data-section-id="${section.id}"`);
    }
  });

  it("źródła sklepu nie podają rendererowi ŻADNEJ własnej owijki", () => {
    const storePage = readFileSync(resolve(process.cwd(), "app/(tenant)/store/page.tsx"), "utf8");
    // Martwa kotwica → czerwone: plik musi naprawdę renderować stronę sklepu.
    expect(storePage).toContain("SiteRenderer");
    expect(storePage, "sklep podaje własną owijkę sekcji").not.toContain("sectionWrapper");
    // Szew elementów (K2) jest drugą drogą wniesienia warstwy edycyjnej — i tak
    // samo zamkniętą po stronie sklepu jak szew sekcji.
    expect(storePage, "sklep podaje własną owijkę elementów").not.toContain("elementWrapper");
  });
});

/**
 * KOMPLETNOŚĆ REJESTRU (K3, ADR-086 — znalezisko recenzji PM z K2).
 *
 * Rejestr wyżej był do tej pory RĘCZNY, a to znaczyło dwie ciche awarie:
 * znacznik usunięty z listy przestawał być pilnowany bez jednego czerwonego
 * testu, a nowy element interfejsu kreatora nigdy się na nią sam nie dopisywał.
 * Kontrakt „render nie zawiera znaczników z listy" jest dokładnie tak dobry,
 * jak lista — więc listę też trzeba pilnować.
 *
 * Ta noga skanuje ŹRÓDŁA warstwy edycyjnej i wymaga, żeby każdy użyty tam
 * atrybut `data-*` był albo w rejestrze, albo na jawnej liście wyjątków. Nie
 * zgaduje: wyjątek trzeba dopisać ręcznie i uzasadnić, a to jest moment,
 * w którym ktoś musi pomyśleć, czy nowy atrybut wycieka na publiczną stronę.
 */
const BUILDER_LAYER_SOURCES = [
  "app/[locale]/(kreator)/strona/kreator/builder-canvas.tsx",
  "app/[locale]/(kreator)/strona/kreator/canvas-elements.tsx",
  "app/[locale]/(kreator)/strona/kreator/canvas-gesture.ts",
  "app/[locale]/(kreator)/strona/kreator/element-palette.tsx",
  "app/[locale]/(kreator)/strona/kreator/inline-editor.tsx",
  "app/[locale]/(kreator)/strona/kreator/image-picker.tsx",
  "app/[locale]/(kreator)/strona/kreator/section-settings-drawer.tsx",
  "app/[locale]/(kreator)/strona/kreator/site-builder.tsx",
  "app/[locale]/(kreator)/strona/kreator/builder-palette.tsx",
  "app/[locale]/(kreator)/strona/kreator/template-gallery.tsx",
  // Galeria typów sekcji żyje w pasie ekranu „Strona sklepu", ale renderuje się
  // WEWNĄTRZ kreatora (paleta i „+" na płótnie) — jej znaczniki są warstwą.
  "app/[locale]/(panel)/strona/add-section-gallery.tsx",
] as const;

/**
 * Atrybuty, które w warstwie edycyjnej WYSTĘPUJĄ, ale do rejestru nie należą.
 * Każdy z powodem — lista wyjątków bez uzasadnień zamienia się w wysypisko,
 * na które trafia wszystko, co akurat zapaliło test.
 */
const MARKER_EXCEPTIONS: Record<string, string> = {
  // Znaczniki TREŚCI, nie warstwy: renderer wystawia je także w sklepie, bo po
  // nich znajduje się sekcję i element w dokumencie (kotwice z K1/K2).
  "data-section-id": "kotwica sekcji w publicznym renderze (ADR-083)",
  "data-section-type": "typ sekcji na kotwicy — czytany przez testy i płótno",
  "data-section-order": "pozycja sekcji na kotwicy",
  "data-element-id": "kotwica elementu w publicznym renderze (ADR-084)",
  "data-element-kind": "rodzaj elementu na kotwicy",
  "data-canvas-grid": "pudełko płótna — wspólne dla sklepu i kreatora",
  "data-section-canvas": "wersja treści sekcji na korzeniu płótna",
  // Atrybuty PLATFORMY, nie nasze: Radix opisuje nimi własne prymitywy.
  "data-slot": "atrybut biblioteki prymitywów (Radix), nie warstwy kreatora",
  "data-state": "stan prymitywu Radix (otwarte/zamknięte)",
  "data-side": "strona prymitywu Radix",
};

describe("rejestr znaczników nadąża za warstwą edycyjną", () => {
  const panelRoot = resolve(process.cwd(), "../panel");
  /** Komentarze wypadają ze skanu — inaczej przykład w komentarzu zapala test. */
  const readSource = (path: string) =>
    readFileSync(resolve(panelRoot, path), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("źródła warstwy edycyjnej są na miejscu (kontrola pozytywna skanu)", () => {
    // Bez tego cała noga broniłaby pustego zbioru: przeniesiony plik znaczyłby
    // „nie ma znaczników do sprawdzenia", a nie „coś jest nie tak".
    for (const path of BUILDER_LAYER_SOURCES) {
      const source = readSource(path);
      expect(source.length, `${path}: pusty albo nieistniejący`).toBeGreaterThan(200);
    }
  });

  it("KAŻDY atrybut data-* z warstwy edycyjnej jest w rejestrze albo w wyjątkach", () => {
    /*
     * Pokrycie liczy się PREFIKSEM, bo tak działa asercja wycieku wyżej:
     * `not.toContain("data-builder")` broni całej rodziny `data-builder-*`.
     * Sprawdzanie pełnych nazw kazałoby wpisywać do rejestru każdy wariant
     * z osobna i rozjechałoby listę z tym, co ona naprawdę gwarantuje.
     */
    const covered = (attribute: string) =>
      BUILDER_LAYER_MARKERS.some((marker) => attribute.startsWith(marker)) ||
      Object.hasOwn(MARKER_EXCEPTIONS, attribute);
    const found = new Map<string, string>();

    for (const path of BUILDER_LAYER_SOURCES) {
      for (const [, attribute] of readSource(path).matchAll(/\b(data-[a-z][a-z0-9-]*)/g)) {
        if (!found.has(attribute!)) found.set(attribute!, path);
      }
    }

    // Kontrola pozytywna: skan po pustym zbiorze nie broniłby niczego.
    expect(found.size, "skan nie znalazł ŻADNEGO atrybutu data-*").toBeGreaterThan(10);

    const missing = [...found.entries()]
      .filter(([attribute]) => !covered(attribute))
      .map(([attribute, path]) => `${attribute} (${path})`);
    expect(
      missing,
      "atrybut warstwy edycyjnej spoza rejestru. Dopisz go do BUILDER_LAYER_MARKERS " +
        "(wtedy publiczny render będzie go pilnował) albo do MARKER_EXCEPTIONS z powodem, " +
        "jeśli to znacznik TREŚCI wystawiany także w sklepie.",
    ).toEqual([]);
  });

  it("rejestr nie zawiera wpisów MARTWYCH — każdy znacznik naprawdę gdzieś jest", () => {
    // Druga strona tej samej reguły: wpis usunięty ze źródła (bo funkcja
    // zniknęła) ma zejść z listy, a nie zostać na niej jako pusta obietnica.
    const sources = BUILDER_LAYER_SOURCES.map(readSource).join("\n");
    const dead = BUILDER_LAYER_MARKERS.filter((marker) => !sources.includes(marker));
    expect(dead, "znacznik w rejestrze, którego nie ma w żadnym źródle warstwy").toEqual([]);
  });
});
