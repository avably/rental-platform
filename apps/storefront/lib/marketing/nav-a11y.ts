/**
 * Dostępność rozwijanego menu na osi marketingowej (ADR-162).
 *
 * Belkę nawigacji obsługuje biblioteka szablonu (webflow.js, ADR-068). Daje
 * `role="button"`, `tabindex="0"`, `aria-controls` i przełącza `aria-expanded`
 * — ale ZMIERZONE braki są trzy i każdy z nich boli tylko tego, kto nie używa
 * myszy:
 *
 *   1. `aria-label` jest ANGIELSKIM literałem („menu") na obu wersjach
 *      językowych — czytnik ekranu czyta go zawsze po angielsku;
 *   2. klawisz Escape NIE zamyka menu (zmierzone: po `keydown` przycisk dalej
 *      ma `w--open`), więc jedynym wyjściem jest trafienie w krzyżyk;
 *   3. otwarcie nie przenosi ognisku do menu, a pozycje leżą w drzewie PRZED
 *      przyciskiem — tabulator z przycisku idzie więc do treści strony i
 *      omija całą nawigację, którą właśnie otworzono.
 *
 * Ta funkcja domyka wszystkie trzy i jest CELOWO oddzielona od komponentu:
 * przyjmuje dokument, więc daje się przypiąć testem bez uruchamiania Reacta
 * i bez biblioteki szablonu. Stan otwarcia LUSTRZY się w `aria-expanded`
 * z klasy `w--open` — atrybut przestaje zależeć od tego, czy zminifikowana
 * biblioteka nadal go ustawia.
 *
 * Zabiegi są z konstrukcji niezależne od silnika: `keydown` z `event.key`,
 * `element.click()` i `element.focus()` działają tak samo w Safari (właściciel)
 * i w Chromium (narzędzia).
 */

/** Klasa, którą biblioteka szablonu oznacza otwarty przycisk menu. */
const KLASA_OTWARTE = "w--open";

export interface OpcjeMenu {
  /** Nazwa przycisku menu dla czytnika ekranu — z treści, nie z literału. */
  etykietaMenu: string;
}

function przyciski(dokument: Document): HTMLElement[] {
  return [...dokument.querySelectorAll<HTMLElement>(".w-nav-button")];
}

function menuPrzycisku(przycisk: HTMLElement): HTMLElement | null {
  // Otwarte menu biblioteka PRZENOSI do `.w-nav-overlay`, ale zostaje ono
  // wewnątrz tej samej belki — dlatego szukamy od `.w-nav`, a nie od rodzica.
  const belka = przycisk.closest(".w-nav");
  return belka?.querySelector<HTMLElement>(".w-nav-menu") ?? null;
}

function otwarte(przycisk: HTMLElement): boolean {
  return przycisk.classList.contains(KLASA_OTWARTE);
}

/** Ustawia atrybut tylko przy realnej zmianie — inaczej obserwator budzi sam siebie. */
function ustawGdyInny(element: HTMLElement, atrybut: string, wartosc: string): void {
  if (element.getAttribute(atrybut) !== wartosc) element.setAttribute(atrybut, wartosc);
}

function pierwszyCel(menu: HTMLElement): HTMLElement | null {
  return menu.querySelector<HTMLElement>('a[href]:not([tabindex="-1"])');
}

/**
 * Podpina obsługę i zwraca funkcję odpinającą (kontrakt `useEffect`).
 * Wywołanie jest idempotentne: powtórne podpięcie nie mnoży nasłuchów, bo
 * każde wywołanie tworzy własny komplet i sam go zdejmuje.
 */
export function podepnijDostepnoscMenu(dokument: Document, opcje: OpcjeMenu): () => void {
  const obserwatorzy: MutationObserver[] = [];

  const przeniesOgnisko = (menu: HTMLElement) => {
    const cel = pierwszyCel(menu) ?? menu;
    if (cel === menu) menu.setAttribute("tabindex", "-1");
    cel.focus({ preventScroll: true });
  };

  for (const przycisk of przyciski(dokument)) {
    ustawGdyInny(przycisk, "aria-label", opcje.etykietaMenu);
    ustawGdyInny(przycisk, "aria-expanded", String(otwarte(przycisk)));

    let bylOtwarty = otwarte(przycisk);
    const obserwator = new MutationObserver(() => {
      const jestOtwarty = otwarte(przycisk);
      ustawGdyInny(przycisk, "aria-expanded", String(jestOtwarty));
      if (jestOtwarty && !bylOtwarty) {
        const menu = menuPrzycisku(przycisk);
        if (menu) przeniesOgnisko(menu);
      }
      bylOtwarty = jestOtwarty;
    });
    obserwator.observe(przycisk, { attributes: true, attributeFilter: ["class"] });
    obserwatorzy.push(obserwator);
  }

  const naKlawisz = (zdarzenie: KeyboardEvent) => {
    // „Esc" to zapis starszych przeglądarek — obie postaci są tym samym klawiszem.
    if (zdarzenie.key !== "Escape" && zdarzenie.key !== "Esc") return;
    const otwarty = przyciski(dokument).find(otwarte);
    if (!otwarty) return;
    zdarzenie.preventDefault();
    // Zamknięcie jedzie TĄ SAMĄ drogą, co krzyżyk: biblioteka szablonu słucha
    // kliknięcia w przycisk. Własne zwijanie rozjechałoby się z jej animacją
    // i z jej stanem wewnętrznym.
    otwarty.click();
    otwarty.focus({ preventScroll: true });
  };
  dokument.addEventListener("keydown", naKlawisz);

  return () => {
    dokument.removeEventListener("keydown", naKlawisz);
    for (const obserwator of obserwatorzy) obserwator.disconnect();
  };
}
