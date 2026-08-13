/**
 * @vitest-environment jsdom
 *
 * DOSTĘPNOŚĆ ROZWIJANEGO MENU (ADR-162).
 *
 * Testujemy `podepnijDostepnoscMenu` na DRZEWIE O KSZTAŁCIE BELKI SZABLONU,
 * bez biblioteki szablonu: przycisk otwiera się dopisaniem klasy `w--open`
 * (dokładnie to robi webflow.js), a zamyka kliknięciem w siebie. Dzięki temu
 * bramka pilnuje NASZEJ obietnicy — stanu w atrybucie, ogniska i Escape —
 * a nie zachowania zminifikowanej biblioteki.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { podepnijDostepnoscMenu } from "@/lib/marketing/nav-a11y";

const BELKA = `
<div class="navbar static w-nav">
  <div class="nav-container">
    <nav class="nav-menu w-nav-menu">
      <div class="nav-menu-inner">
        <a id="pierwszy" href="/pl/pricing" class="nav-link w-inline-block">Cennik</a>
        <a href="/pl/faq" class="nav-link w-inline-block">Pytania</a>
      </div>
    </nav>
    <div class="menu-button w-nav-button" role="button" tabindex="0" aria-label="menu"></div>
  </div>
</div>`;

let odepnij: (() => void) | null = null;

function przycisk(): HTMLElement {
  return document.querySelector<HTMLElement>(".w-nav-button")!;
}

/** Otwarcie tak, jak robi to biblioteka szablonu: sama klasa na przycisku. */
async function otworz(): Promise<void> {
  przycisk().classList.add("w--open");
  // Obserwator mutacji dostarcza zapisy na końcu mikrozadania.
  await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = BELKA;
  // Biblioteka szablonu zamyka menu kliknięciem w przycisk — odtwarzamy tę
  // jedną zależność, bo bez niej Escape nie miałby czego wywołać.
  przycisk().addEventListener("click", () => przycisk().classList.toggle("w--open"));
});

afterEach(() => {
  odepnij?.();
  odepnij = null;
  document.body.innerHTML = "";
});

describe("stan menu ogłoszony atrybutem", () => {
  it("zaczyna od zamkniętego i idzie za klasą biblioteki", async () => {
    odepnij = podepnijDostepnoscMenu(document, { etykietaMenu: "Nawigacja" });
    expect(przycisk().getAttribute("aria-expanded")).toBe("false");

    await otworz();
    expect(przycisk().getAttribute("aria-expanded")).toBe("true");

    przycisk().click();
    await Promise.resolve();
    expect(przycisk().getAttribute("aria-expanded")).toBe("false");
  });

  it("nazwa przycisku pochodzi z treści, nie z angielskiego literału biblioteki", () => {
    expect(przycisk().getAttribute("aria-label")).toBe("menu");
    odepnij = podepnijDostepnoscMenu(document, { etykietaMenu: "Nawigacja" });
    expect(przycisk().getAttribute("aria-label")).toBe("Nawigacja");
  });
});

describe("ognisko", () => {
  it("po otwarciu wchodzi do menu, a nie zostaje pod przyciskiem", async () => {
    odepnij = podepnijDostepnoscMenu(document, { etykietaMenu: "Nawigacja" });
    expect(document.activeElement).toBe(document.body);

    await otworz();
    expect(document.activeElement?.id).toBe("pierwszy");
  });

  it("nie przeskakuje przy każdej zmianie klasy, tylko przy otwarciu", async () => {
    odepnij = podepnijDostepnoscMenu(document, { etykietaMenu: "Nawigacja" });
    await otworz();
    (document.querySelector("#pierwszy") as HTMLElement).blur();

    przycisk().classList.add("blured");
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("Escape", () => {
  it("zamyka otwarte menu i oddaje ognisko przyciskowi", async () => {
    odepnij = podepnijDostepnoscMenu(document, { etykietaMenu: "Nawigacja" });
    await otworz();
    expect(przycisk().classList.contains("w--open")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await Promise.resolve();

    expect(przycisk().classList.contains("w--open")).toBe(false);
    expect(przycisk().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(przycisk());
  });

  it("nie rusza niczego przy zamkniętym menu", () => {
    odepnij = podepnijDostepnoscMenu(document, { etykietaMenu: "Nawigacja" });
    const klik = vi.fn();
    przycisk().addEventListener("click", klik);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(klik).not.toHaveBeenCalled();
    expect(przycisk().getAttribute("aria-expanded")).toBe("false");
  });

  it("inny klawisz nie zamyka menu", async () => {
    odepnij = podepnijDostepnoscMenu(document, { etykietaMenu: "Nawigacja" });
    await otworz();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    expect(przycisk().classList.contains("w--open")).toBe(true);
  });
});

describe("sprzątanie", () => {
  it("odpięcie zdejmuje nasłuch klawiatury", async () => {
    const odepnijTeraz = podepnijDostepnoscMenu(document, { etykietaMenu: "Nawigacja" });
    await otworz();
    odepnijTeraz();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await Promise.resolve();

    expect(przycisk().classList.contains("w--open")).toBe(true);
  });
});
