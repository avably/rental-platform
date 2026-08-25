/**
 * NAGŁÓWEK POWŁOKI SKLEPU — findingi audytu UX 2026-08-25 (zadanie F1).
 *
 * Cztery zdania, których pilnuje ten plik:
 *
 *   1. S-45: znak firmy prowadzi na KANON `/`, nie na trasę wewnętrzną
 *      `/store` (duplikat kanoniczny strony głównej).
 *   2. S-52: „Koszyk" na stronie koszyka niesie `aria-current="page"`
 *      i wyróżnienie — a poza nią NIE niesie (druga noga dowodu: bez niej
 *      przechodziłby render znaczący koszyk zawsze).
 *   3. S-15: cel dotykowy odnośnika koszyka jest powiększony paddingiem
 *      z ujemnymi marginesami (44 px zamiast ~20 px), bez zmiany układu.
 *   4. S-58: wspólna siatka chrome (`SITE_CONTAINER`) mówi TYMI SAMYMI
 *      liczbami, co stałe pasa treści płótna — sufit `CANVAS_DESIGN_WIDTH_PX`
 *      i margines `CANVAS_PAD_COLUMNS / CANVAS_COLUMNS`. Klasa Tailwinda nie
 *      umie policzyć stałych rdzenia, więc literał pilnowany jest tutaj.
 */
import {
  CANVAS_COLUMNS,
  CANVAS_DESIGN_WIDTH_PX,
  CANVAS_PAD_COLUMNS,
} from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StoreShellHeader } from "./store-shell";
import { SITE_CONTAINER } from "./template";

// jsdom: bez sprzątania `querySelector` w drugim teście patrzy na drzewo
// z pierwszego (lekcja: jsdom-id-selector-needs-cleanup).
afterEach(cleanup);

function naglowek(props: Partial<Parameters<typeof StoreShellHeader>[0]> = {}) {
  return render(
    <StoreShellHeader storeName="Sklep Kontrolny" logo={null} cartLabel="Koszyk" {...props} />,
  );
}

describe("S-45 — znak firmy prowadzi na kanon", () => {
  it("odnośnik marki celuje w `/`, nie w trasę wewnętrzną `/store`", () => {
    const { container } = naglowek();
    const brand = container.querySelector('a[href="/"]');
    expect(brand, "nagłówek bez odnośnika marki — nie ma czego dowodzić").not.toBeNull();
    expect(brand!.textContent).toContain("Sklep Kontrolny");
    expect(
      container.querySelector('a[href="/store"]'),
      "znak firmy wrócił na duplikat kanoniczny /store",
    ).toBeNull();
  });
});

describe("S-52 — self-link koszyka", () => {
  it("`cartCurrent` znaczy odnośnik koszyka `aria-current=page` i wyróżnieniem", () => {
    const { container } = naglowek({ cartCurrent: true });
    const cart = container.querySelector('a[href="/cart"]');
    expect(cart, "nagłówek bez odnośnika koszyka").not.toBeNull();
    expect(cart!.getAttribute("aria-current")).toBe("page");
    expect(cart!.className, "brak klasy wyróżnienia — aria-current byłby niewidzialny").toContain(
      "aria-[current=page]:font-semibold",
    );
  });

  it("poza koszykiem odnośnik NIE niesie aria-current (druga noga dowodu)", () => {
    const { container } = naglowek();
    const cart = container.querySelector('a[href="/cart"]');
    expect(cart).not.toBeNull();
    expect(cart!.hasAttribute("aria-current")).toBe(false);
  });
});

describe("S-15 — cel dotykowy odnośnika koszyka", () => {
  it("padding powiększa obszar klikalny, ujemne marginesy oddają go w układzie", () => {
    const { container } = naglowek();
    const cart = container.querySelector('a[href="/cart"]');
    expect(cart).not.toBeNull();
    // 20 px tekstu + 2 × 12 px paddingu = 44 px (zalecenie WCAG 2.5.8);
    // -my-3 zdejmuje dokładnie tyle, ile py-3 dodało — belka bez zmian.
    for (const klasa of ["py-3", "-my-3", "px-2", "-mx-2"]) {
      expect(cart!.className, `cel dotykowy stracił ${klasa}`).toContain(klasa);
    }
  });
});

describe("S-58 — wspólna siatka chrome mówi liczbami rdzenia", () => {
  /*
    Kolumna SZEROKOŚCIĄ, nie paddingiem: procentowy padding liczy się od bloku
    ZAWIERAJĄCEGO, więc `px-[8.333%]` na pełnoekranowym rodzicu dawał margines
    od OKNA (przy 1440 px: 120 zamiast 96) i kolumna stawała ~24 px od pasa
    płótna — złapane pomiarem pikseli. Patrz docblock `SITE_CONTAINER`.
  */
  it("kolumna to pas treści płótna: (COLUMNS − 2·PAD) / COLUMNS szerokości", () => {
    const procent = (((CANVAS_COLUMNS - 2 * CANVAS_PAD_COLUMNS) / CANVAS_COLUMNS) * 100).toFixed(3);
    // Kontrola przyrządu: gdy stałe rdzenia się zmienią, ta liczba przestaje
    // być 83.333 i asercja wskaże literał do poprawienia.
    expect(SITE_CONTAINER).toContain(`w-[${procent}%]`);
    // Padding procentowy NIE MA prawa wrócić — liczy się od rodzica, nie pasa.
    expect(SITE_CONTAINER).not.toContain("px-[");
  });

  it("sufit kolumny to pas treści przy szerokości projektowej (960 px = 60 rem)", () => {
    const sufit = CANVAS_DESIGN_WIDTH_PX * ((CANVAS_COLUMNS - 2 * CANVAS_PAD_COLUMNS) / CANVAS_COLUMNS);
    expect(sufit).toBe(960);
    expect(SITE_CONTAINER).toContain("max-w-[60rem]");
  });

  it("wiersz nagłówka mierzy wspólną siatką i jest kotwicą paneli belki (S-01)", () => {
    const { container } = naglowek();
    const wiersz = container.querySelector("[data-store-header] > div");
    expect(wiersz).not.toBeNull();
    for (const klasa of SITE_CONTAINER.split(" ")) {
      expect(wiersz!.className, `wiersz belki stracił ${klasa} wspólnej siatki`).toContain(klasa);
    }
    // `relative` jest kotwicą pełnej szerokości dla panelu wyszukiwania
    // (F7, technika S-01) — patrz `StoreHeaderSearch` w storefront.
    expect(wiersz!.className, "wiersz belki przestał być kotwicą paneli").toContain(
      "relative",
    );
  });
});

/* ================================ F7 ================================ */

describe("F7 — nagłówek pro: sticky, sloty wyszukiwania i listwy", () => {
  it("`sticky` dokłada przyklejenie (top-0 z-40) i atrybut reguły linii z site.css", () => {
    const { container } = naglowek({ sticky: true });
    const header = container.querySelector("[data-store-header]")!;
    for (const klasa of ["sticky", "top-0", "z-40"]) {
      expect(header.className, `belka straciła ${klasa}`).toContain(klasa);
    }
    expect(
      header.hasAttribute("data-store-header-sticky"),
      "bez atrybutu linia po przewinięciu nie ma na czym wisieć",
    ).toBe(true);
  });

  it("DOMYŚLNIE nagłówek NIE przykleja — kontrakt podglądu szkicu (własny pasek z-50)", () => {
    const { container } = naglowek();
    const header = container.querySelector("[data-store-header]")!;
    expect(header.className.split(/\s+/), "podgląd dostał sticky pod cudzym paskiem").not.toContain(
      "sticky",
    );
    expect(header.hasAttribute("data-store-header-sticky")).toBe(false);
  });

  it("slot `search` staje w belce, slot `subnav` jako drugi rząd WEWNĄTRZ <header>", () => {
    const { container } = naglowek({
      search: <div data-test-search />,
      subnav: <nav data-test-subnav />,
    });
    const header = container.querySelector("[data-store-header]")!;
    expect(header.querySelector("[data-test-search]"), "slot wyszukiwania wypadł z belki").not.toBeNull();
    // Drugi rząd MUSI być w <header>: przykleja się razem z belką, a linia
    // po przewinięciu rysuje się POD nim, nie między rzędami.
    expect(header.querySelector("[data-test-subnav]"), "listwa wypadła poza <header>").not.toBeNull();
  });

  it("bez slotów belka wygląda jak dotąd (podgląd szkicu nie podaje nic)", () => {
    const { container } = naglowek({ interactive: false });
    const header = container.querySelector("[data-store-header]")!;
    expect(header.querySelectorAll("a")).toHaveLength(0);
    expect(header.querySelectorAll("[data-shell-inert]")).toHaveLength(2);
  });

  it("`cartAriaLabel` nadaje odnośnikowi koszyka pełną nazwę dostępną", () => {
    const { container } = naglowek({ cartAriaLabel: "Koszyk, 2 pozycje" });
    expect(container.querySelector('a[href="/cart"]')!.getAttribute("aria-label")).toBe(
      "Koszyk, 2 pozycje",
    );
  });

  it("bez `cartAriaLabel` odnośnik mówi widocznym napisem (podgląd, koszyk pusty)", () => {
    const { container } = naglowek();
    expect(container.querySelector('a[href="/cart"]')!.hasAttribute("aria-label")).toBe(false);
  });
});
