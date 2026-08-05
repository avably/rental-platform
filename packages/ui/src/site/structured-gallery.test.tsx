// @vitest-environment jsdom

/**
 * GALERIA STRUKTURALNA — RENDER, POWIĘKSZENIE I PAS (E3, aneks ADR-094).
 *
 * Trzy rzeczy, których nie widać w żadnym logu, gdy się zepsują, więc mają tu
 * własne zdania:
 *
 *   1. DOSTĘPNOŚĆ POWIĘKSZENIA. Okno bez powrotu fokusu i bez Escape wygląda
 *      identycznie jak sprawne — dopóki ktoś nie odłoży myszy. Kontrolki
 *      znajdujemy tu WYŁĄCZNIE po roli i dostępnej nazwie, bo dokładnie tego
 *      używa czytnik ekranu (lekcja E2: `data-*` przechodzi także wtedy, gdy
 *      jedyna droga jest niewidoczna).
 *   2. „ODNOŚNIK WYGRYWA Z POWIĘKSZENIEM". Rozstrzygnięcie E3, które w kodzie
 *      jest jedną gałęzią, a w skutkach decyduje, czy kliknięcie w kafel
 *      wychodzi ze strony, czy otwiera album.
 *   3. PAS PRZEWIJA SIEBIE, NIE STRONĘ. `scrollIntoView` na kafelku wygląda
 *      w kodzie niewinnie i przy każdej strzałce przesuwa całą stronę pod
 *      użytkownikiem. Test pilnuje, że karuzela woła `scrollTo` KONTENERA
 *      i że `scrollIntoView` nie pada ANI RAZU.
 *
 * `alt=""` jest tu sprawdzany jako WARTOŚĆ, a nie jako brak: pusty opis znaczy
 * „obraz dekoracyjny, pomiń", a brak atrybutu każe czytnikowi przeczytać nazwę
 * pliku. Różnica jednego znaku, dwa różne produkty.
 */
import {
  structuredPresetFor,
  withStructuredLayout,
  type GalleryStructuredContent,
} from "@avably/core/site";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_SITE_LABELS, SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

const L = DEFAULT_SITE_LABELS;
const BAZA = "https://przyklad.supabase.test/storage/v1/object/public/site-images";
const OBCY = "https://partner.przyklad.test/realizacja";

const scrollTo = vi.fn();
const scrollIntoView = vi.fn();

beforeAll(() => {
  // jsdom nie implementuje ani przewijania, ani obserwatora rozmiaru — obie
  // atrapy są tu po to, żeby MIERZYĆ wywołania, a nie żeby je uciszyć.
  Element.prototype.scrollTo = scrollTo as unknown as Element["scrollTo"];
  Element.prototype.scrollIntoView = scrollIntoView;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  scrollTo.mockClear();
  scrollIntoView.mockClear();
});

/** Preset galerii z podmienionymi wpisami — treść operatora, nie treść wzorcowa. */
function galeria(patch: Partial<GalleryStructuredContent> = {}): GalleryStructuredContent {
  const preset = structuredPresetFor("gallery", "pl") as GalleryStructuredContent;
  return { ...preset, ...patch } as GalleryStructuredContent;
}

function pokaz(content: GalleryStructuredContent) {
  const sections = [
    { id: "g1", position: 0, type: "gallery", content },
  ] as unknown as RenderSection[];
  return render(<SiteRenderer sections={sections} siteImageBase={BAZA} />);
}

/** Wpisy z REALNEJ pracy operatora: odnośnik obcy, odnośnik własny i pustka. */
function wpisyOperatora(content: GalleryStructuredContent) {
  const [a, b, c] = content.items;
  return [
    { ...a!, link: OBCY },
    { ...b!, alt: "", caption: undefined },
    { ...c!, image: { kind: "storage" as const, path: "tenant-a/site/trzeci.jpg" }, link: "/kontakt" },
  ] as GalleryStructuredContent["items"];
}

/**
 * ODNOŚNIK W ŚRODKU ALBUMU — fikstura kształtu [otwieralny, ODNOŚNIK, otwieralny].
 *
 * Delta recenzji PM: `wpisyOperatora` ma tylko JEDEN kafel bez odnośnika, więc
 * album ma długość 1, a każdy krok modulo 1 stoi w miejscu — na takiej treści
 * przechodzi także implementacja licząca krok po WSZYSTKICH kaflach zamiast po
 * albumie. Dopiero dwa otwieralne kafle Z NIEOTWIERALNYM MIĘDZY NIMI odróżniają
 * te dwie implementacje: krok po wszystkich wchodzi wtedy na kafel-odnośnik,
 * którego album nie obejmuje.
 *
 * Podpisy są tu ETYKIETAMI POZYCJI, a nie treścią — po nich test poznaje, KTÓRY
 * kafel okno naprawdę pokazuje. Sam licznik by nie wystarczył: mówi położenie
 * w albumie, a pytanie brzmi, czy okno w ogóle stoi na kafelku z albumu.
 */
function zOdnosnikiemWSrodku(): GalleryStructuredContent {
  const [a, b, c] = galeria().items;
  return galeria({
    items: [
      { ...a!, caption: "PIERWSZY" },
      { ...b!, caption: "ŚRODKOWY — ODNOŚNIK", link: OBCY },
      { ...c!, caption: "TRZECI" },
    ] as GalleryStructuredContent["items"],
  });
}

const uzytkownik = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("trzy układy rysują TĘ SAMĄ treść", () => {
  it.each(["grid", "masonry", "carousel"] as const)("%s: kafle są, a układ się przedstawia", (layout) => {
    const { container } = pokaz(withStructuredLayout(galeria(), layout));
    const sekcja = container.querySelector<HTMLElement>('[data-structured-section="gallery"]');
    expect(sekcja, "sekcja się nie zamontowała").not.toBeNull();
    expect(sekcja!.getAttribute("data-structured-layout")).toBe(layout);
    expect(container.querySelectorAll("[data-gallery-item]").length).toBe(3);
    expect(container.querySelectorAll("img").length).toBeGreaterThanOrEqual(3);
  });

  it("liczba kafli w rzędzie jedzie do układu jako WŁAŚCIWOŚĆ, nie jako klasa", () => {
    // Klasa `grid-cols-${n}` nie istniałaby w arkuszu (skaner Tailwinda nigdy
    // nie zobaczy sklejonego napisu), więc wybór operatora musi jechać zmienną.
    for (const columns of [2, 3, 4] as const) {
      const { container } = pokaz(galeria({ columns }));
      const lista = container.querySelector<HTMLElement>("[data-gallery-list]");
      expect(lista!.style.getPropertyValue("--gallery-columns")).toBe(String(columns));
      cleanup();
    }
  });

  it("odstęp jest WYBOREM operatora, a nie jedną stałą", () => {
    const klasy = (["tight", "regular", "roomy"] as const).map((gap) => {
      const { container } = pokaz(galeria({ gap }));
      const lista = container.querySelector<HTMLElement>("[data-gallery-list]")!;
      const klasa = lista.className;
      cleanup();
      return klasa;
    });
    expect(new Set(klasy).size, "trzy gęstości dały ten sam układ").toBe(3);
  });
});

describe("opis alternatywny: pustka jest DECYZJĄ, nie brakiem", () => {
  it("kafel bez opisu ma alt=\"\" (obraz dekoracyjny), a nie brak atrybutu", () => {
    const { container } = pokaz(galeria({ items: wpisyOperatora(galeria()) }));
    const obrazy = Array.from(container.querySelectorAll("img"));
    const dekoracyjny = obrazy[1]!;
    expect(dekoracyjny.hasAttribute("alt"), "brak atrybutu — czytnik przeczyta nazwę pliku").toBe(true);
    expect(dekoracyjny.getAttribute("alt")).toBe("");
    expect(obrazy[0]!.getAttribute("alt")!.length, "opis operatora zniknął").toBeGreaterThan(10);
  });

  it("zdjęcie z naszego bucketa dostaje adres z bazy, a nie samą ścieżkę", () => {
    const { container } = pokaz(galeria({ items: wpisyOperatora(galeria()) }));
    const zeStorage = Array.from(container.querySelectorAll("img")).find((img) =>
      img.getAttribute("src")?.includes("trzeci.jpg"),
    );
    expect(zeStorage?.getAttribute("src")).toBe(`${BAZA}/tenant-a/site/trzeci.jpg`);
  });

  it("bez bazy adresów kafel degraduje do powierzchni zastępczej, a nie do pęknięcia", () => {
    const sections = [
      {
        id: "g1",
        position: 0,
        type: "gallery",
        content: galeria({
          items: [
            { image: { kind: "storage", path: "tenant-a/site/a.jpg" }, alt: "Kadr" },
          ] as GalleryStructuredContent["items"],
        }),
      },
    ] as unknown as RenderSection[];
    const { container } = render(<SiteRenderer sections={sections} />);
    expect(container.querySelector(".site-placeholder"), "brak kafla zastępczego").not.toBeNull();
  });
});

describe("ODNOŚNIK WYGRYWA Z POWIĘKSZENIEM", () => {
  it("kafel z odnośnikiem jest linkiem, kafel bez — przyciskiem powiększenia", () => {
    const wpisy = wpisyOperatora(galeria());
    const { container } = pokaz(galeria({ items: wpisy }));
    const kafle = Array.from(container.querySelectorAll("[data-gallery-item]"));

    // Nazwą odnośnika kafla jest opis zdjęcia — kafel z atrybucją ma w środku
    // DRUGI link (autora), więc szukamy po nazwie, a nie „jedynego linku".
    expect(
      within(kafle[0] as HTMLElement).getByRole("link", { name: wpisy[0]!.alt }),
      "kafel z odnośnikiem nie jest linkiem",
    ).toBeTruthy();
    expect(
      within(kafle[0] as HTMLElement).queryByRole("button", { name: L.galleryZoom }),
      "kafel z odnośnikiem OTWIERA TEŻ powiększenie — dwie obietnice na jedno kliknięcie",
    ).toBeNull();

    expect(
      within(kafle[1] as HTMLElement).getByRole("button", { name: L.galleryZoom }),
      "kafel bez odnośnika nie daje się powiększyć",
    ).toBeTruthy();
  });

  it("odnośnik WYCHODZĄCY ma komplet `rel`, a wewnętrzny nie ma go wcale", () => {
    const { container } = pokaz(galeria({ items: wpisyOperatora(galeria()) }));
    const obcy = container.querySelector<HTMLAnchorElement>(`a[href="${OBCY}"]`)!;
    expect(new Set((obcy.getAttribute("rel") ?? "").split(/\s+/))).toEqual(
      new Set(["noopener", "noreferrer"]),
    );
    const wlasny = container.querySelector<HTMLAnchorElement>('a[href="/kontakt"]')!;
    expect(wlasny.hasAttribute("rel"), "zbędny `rel` na ścieżce własnej").toBe(false);
  });

  it("atrybucja autora jest widoczna i klikalna POZA obszarem kafla", () => {
    // Warunek licencji: odnośnik atrybucji nie może siedzieć w przycisku
    // powiększenia (nieprawidłowe drzewo — przeglądarka sama rozstrzyga, co
    // kliknięto), więc sprawdzamy JEDNO I DRUGIE naraz.
    const { container } = pokaz(galeria());
    const kredyt = container.querySelector<HTMLAnchorElement>("[data-gallery-credit]")!;
    expect(kredyt.textContent!.length).toBeGreaterThan(0);
    expect(kredyt.closest("button"), "atrybucja wewnątrz przycisku").toBeNull();
    expect(new Set((kredyt.getAttribute("rel") ?? "").split(/\s+/))).toEqual(
      new Set(["noopener", "noreferrer"]),
    );
  });

  it("wyłączone powiększenie zdejmuje przyciski i całe okno", () => {
    const { container } = pokaz(galeria({ lightbox: false }));
    expect(screen.queryByRole("button", { name: L.galleryZoom })).toBeNull();
    expect(container.querySelector("[data-gallery-lightbox]"), "okno zostało w drzewie").toBeNull();
  });
});

describe("POWIĘKSZENIE według W3C APG", () => {
  it("otwiera się, mówi swoje położenie i WRACA fokusem na kafel", async () => {
    const user = uzytkownik();
    const { container } = pokaz(galeria());

    const kafle = screen.getAllByRole("button", { name: L.galleryZoom });
    await user.click(kafle[1]!);

    const okno = container.querySelector<HTMLDialogElement>("[data-gallery-lightbox]")!;
    expect(okno.open, "okno się nie otworzyło").toBe(true);
    expect(within(okno).getByText("Zdjęcie 2 z 3"), "licznik nie mówi, które zdjęcie jest widoczne").toBeTruthy();

    await user.click(within(okno).getByRole("button", { name: L.galleryClose }));
    expect(okno.open).toBe(false);
    expect(
      document.activeElement,
      "po zamknięciu fokus nie wrócił na kafel — klawiatura ląduje na początku strony",
    ).toBe(kafle[1]);
  });

  it("Escape zamyka i też oddaje fokus", async () => {
    const user = uzytkownik();
    const { container } = pokaz(galeria());
    const kafel = screen.getAllByRole("button", { name: L.galleryZoom })[0]!;
    await user.click(kafel);

    const okno = container.querySelector<HTMLDialogElement>("[data-gallery-lightbox]")!;
    expect(okno.open).toBe(true);
    await user.keyboard("{Escape}");
    expect(okno.open, "Escape nie zamknął okna").toBe(false);
    expect(document.activeElement).toBe(kafel);
  });

  it("←/→ przechodzą po zdjęciach i zawijają się na końcach", async () => {
    const user = uzytkownik();
    const { container } = pokaz(galeria());
    await user.click(screen.getAllByRole("button", { name: L.galleryZoom })[0]!);
    const okno = container.querySelector<HTMLDialogElement>("[data-gallery-lightbox]")!;

    await user.keyboard("{ArrowRight}");
    expect(within(okno).getByText("Zdjęcie 2 z 3")).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(within(okno).getByText("Zdjęcie 1 z 3")).toBeTruthy();
    // Zawijanie: strzałka wygaszona na pierwszym zdjęciu wygląda jak awaria.
    await user.keyboard("{ArrowLeft}");
    expect(within(okno).getByText("Zdjęcie 3 z 3")).toBeTruthy();
  });

  it("←/→ chodzą po ALBUMIE, a nie po wszystkich kaflach (delta recenzji PM)", async () => {
    /*
     * Niezmiennik, którego pilnuje `galleryLightboxIndexes`: strzałka przechodzi
     * do NASTĘPNEGO OTWIERALNEGO kafla, przeskakując te, które kliknięciem
     * wychodzą ze strony. Implementacja licząca krok po `content.items`
     * przechodziła całą dotychczasową suitę, a w przeglądarce wchodziła na
     * kafel-odnośnik i pokazywała licznik „Zdjęcie 0 z 2" (pozycja spoza albumu
     * daje `indexOf` równe -1).
     */
    const user = uzytkownik();
    const { container } = pokaz(zOdnosnikiemWSrodku());

    const kafle = screen.getAllByRole("button", { name: L.galleryZoom });
    expect(kafle.length, "kafel z odnośnikiem wszedł do albumu").toBe(2);

    await user.click(kafle[0]!);
    const okno = container.querySelector<HTMLDialogElement>("[data-gallery-lightbox]")!;
    const podpis = () => okno.querySelector("[data-gallery-lightbox-caption]")?.textContent;
    expect(within(okno).getByText("Zdjęcie 1 z 2")).toBeTruthy();
    expect(podpis()).toBe("PIERWSZY");

    await user.keyboard("{ArrowRight}");
    expect(
      within(okno).getByText("Zdjęcie 2 z 2"),
      "licznik wypadł poza album — strzałka stanęła na kafelku, którego nie obejmuje",
    ).toBeTruthy();
    expect(podpis(), "strzałka weszła na kafel-odnośnik zamiast go przeskoczyć").toBe("TRZECI");

    await user.keyboard("{ArrowRight}");
    expect(within(okno).getByText("Zdjęcie 1 z 2"), "album nie zawinął się na początek").toBeTruthy();
    expect(podpis()).toBe("PIERWSZY");
  });

  it("powiększenie obejmuje WYŁĄCZNIE kafle bez odnośnika", async () => {
    const user = uzytkownik();
    const { container } = pokaz(galeria({ items: wpisyOperatora(galeria()) }));
    await user.click(screen.getByRole("button", { name: L.galleryZoom }));
    const okno = container.querySelector<HTMLDialogElement>("[data-gallery-lightbox]")!;
    // Trzy zdjęcia, dwa z odnośnikiem → album ma dokładnie jedno.
    expect(within(okno).getByText("Zdjęcie 1 z 1")).toBeTruthy();
  });

  it("przyciski okna mają NAZWY, a znaki w nich są dekoracją", async () => {
    const user = uzytkownik();
    const { container } = pokaz(galeria());
    await user.click(screen.getAllByRole("button", { name: L.galleryZoom })[0]!);
    const okno = container.querySelector<HTMLDialogElement>("[data-gallery-lightbox]")!;

    for (const nazwa of [L.galleryPrev, L.galleryNext, L.galleryClose]) {
      const przycisk = within(okno).getByRole("button", { name: nazwa });
      expect(przycisk.querySelector('[aria-hidden="true"]'), `znak w „${nazwa}” nie jest dekoracją`).not.toBeNull();
    }
  });
});

describe("KARUZELA przewija SIEBIE, nie stronę", () => {
  it("strzałka woła scrollTo KONTENERA i ani razu scrollIntoView", async () => {
    const user = uzytkownik();
    const { container } = pokaz(withStructuredLayout(galeria(), "carousel"));
    const lista = container.querySelector<HTMLElement>("[data-gallery-list]")!;

    const nastepne = screen.getByRole("button", { name: L.galleryNext });
    await user.click(nastepne);

    expect(scrollTo, "krok karuzeli nie przewinął pasa").toHaveBeenCalled();
    expect(scrollTo.mock.instances[0], "przewinięto COŚ INNEGO niż pas kafli").toBe(lista);
    expect(scrollTo.mock.calls[0]![0]).toMatchObject({ behavior: "smooth" });
    expect(
      scrollIntoView,
      "użyto scrollIntoView — przy każdej strzałce przesuwałoby to całą stronę",
    ).not.toHaveBeenCalled();
  });

  it("strzałki mają nazwy i wygaszają się na końcach pasa", async () => {
    const user = uzytkownik();
    pokaz(withStructuredLayout(galeria(), "carousel"));
    const poprzednie = screen.getByRole("button", { name: L.galleryPrev });
    const nastepne = screen.getByRole("button", { name: L.galleryNext });

    expect(poprzednie).toBeDisabled();
    expect(nastepne).not.toBeDisabled();
    await user.click(nastepne);
    expect(poprzednie, "po kroku wstecz dalej nie ma dokąd wracać").not.toBeDisabled();
  });

  it("pas jest przewijany GESTEM z definicji (scroll-snap), bez własnej obsługi dotyku", () => {
    const { container } = pokaz(withStructuredLayout(galeria(), "carousel"));
    const lista = container.querySelector<HTMLElement>("[data-gallery-list]")!;
    for (const klasa of ["overflow-x-auto", "snap-x", "snap-mandatory"]) {
      expect(lista.className, `pas bez klasy „${klasa}” nie przewinie się palcem`).toContain(klasa);
    }
  });

  it("BEZ AUTOROTACJI: pas nie rusza się sam", () => {
    vi.useFakeTimers();
    try {
      const { container } = pokaz(withStructuredLayout(galeria(), "carousel"));
      expect(container.querySelector("[data-gallery-carousel]")).not.toBeNull();
      scrollTo.mockClear();
      vi.advanceTimersByTime(30_000);
      expect(scrollTo, "pas przesunął się sam — ruch, którego nikt nie zamówił").not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
