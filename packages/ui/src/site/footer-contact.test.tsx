/**
 * TELEFON I E-MAIL STOPKI SĄ AKCJAMI, NIE NAPISAMI (S-29 audytu UX 2026-08-25)
 * + SELF-LINKI STOPKI (S-52).
 *
 * Sonda audytu znalazła ZERO odnośników `tel:`/`mailto:` na całej stronie —
 * a stopka jest na większości tras jedynym miejscem z danymi kontaktowymi
 * i telefon jest głównym kanałem domykania rezerwacji.
 *
 * Stopka testowana jest w OBU generacjach, którymi renderuje ją sklep:
 *   • płótno v2 — kształt, który najemcy MAJĄ (kreator konwertuje każdą
 *     sekcję przez `sectionCanvasFrom`; lekcja z `footer-mark.test.tsx`),
 *   • treść v1 — kształt zastany, dalej obsługiwany przez `FooterSection`.
 *
 * DOWÓD MUTACYJNY (wymóg F1): odwrócenie naprawy — zdjęcie
 * `linkifyFooterContact` z gałęzi płótna w `SectionSwitch` albo hrefów
 * z `FooterSection` — gasi asercje `tel:`/`mailto:` w OBU generacjach.
 */
import { presetContentFor, sectionCanvasFrom } from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { siteContactHref } from "./sections";
import { SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

afterEach(cleanup);

/** Stopka DOKŁADNIE taka, jaką zapisuje kreator: preset przez konwersję. */
function stopkaNaPlotnie(): RenderSection {
  return {
    id: "s-footer",
    position: 0,
    type: "footer",
    content: sectionCanvasFrom("footer", presetContentFor("footer", "pl")),
  } as RenderSection;
}

/** Ta sama treść w kształcie v1 — sekcje zapisane przed K2. */
function stopkaV1(): RenderSection {
  return {
    id: "s-footer",
    position: 0,
    type: "footer",
    content: presetContentFor("footer", "pl"),
  } as RenderSection;
}

function linki(container: HTMLElement, prefix: string): string[] {
  return [...container.querySelectorAll("footer a")]
    .map((a) => a.getAttribute("href") ?? "")
    .filter((href) => href.startsWith(prefix));
}

describe("siteContactHref — jeden sąd o tym, co jest telefonem/e-mailem", () => {
  it("e-mail → mailto:, telefon → tel: znormalizowany (RFC 3966)", () => {
    expect(siteContactHref("kontakt@przyklad.pl")).toBe("mailto:kontakt@przyklad.pl");
    expect(siteContactHref(" +48 500 600 700 ")).toBe("tel:+48500600700");
    expect(siteContactHref("(22) 100-20-30")).toBe("tel:221002030");
  });

  it("adres, godziny i nota prawna ZOSTAJĄ napisami", () => {
    expect(siteContactHref("ul. Betonowa 21, 40-001 Katowice")).toBeNull();
    expect(siteContactHref("Pon–Pt 6:00–18:00, Sob 7:00–13:00")).toBeNull();
    expect(siteContactHref("© Twoja Firma. Wszelkie prawa zastrzeżone.")).toBeNull();
    // Za mało cyfr na numer (np. kod pocztowy w osobnej linii).
    expect(siteContactHref("40-001")).toBeNull();
  });
});

describe("S-29 — stopka na płótnie (kształt, który najemcy mają)", () => {
  it("telefon i e-mail presetu renderują się jako tel:/mailto:", () => {
    const { container } = render(<SiteRenderer sections={[stopkaNaPlotnie()]} />);
    // Kontrola przyrządu: stopka NAPRAWDĘ niesie dane presetu.
    expect(container.textContent).toContain("+48 500 100 200");
    expect(linki(container, "tel:")).toEqual(["tel:+48500100200"]);
    expect(linki(container, "mailto:")).toEqual(["mailto:kontakt@przyklad.pl"]);
  });

  it("nota prawna i adres NIE dostają odnośnika (druga noga dowodu)", () => {
    const { container } = render(<SiteRenderer sections={[stopkaNaPlotnie()]} />);
    const kontaktowe = linki(container, "tel:").length + linki(container, "mailto:").length;
    expect(kontaktowe, "linkifikacja rozlała się poza telefon i e-mail").toBe(2);
  });
});

describe("S-29 — stopka v1 (kształt zastany)", () => {
  it("pola phone/email renderują się jako tel:/mailto:", () => {
    const { container } = render(<SiteRenderer sections={[stopkaV1()]} />);
    expect(container.textContent).toContain("+48 500 100 200");
    expect(linki(container, "tel:")).toEqual(["tel:+48500100200"]);
    expect(linki(container, "mailto:")).toEqual(["mailto:kontakt@przyklad.pl"]);
  });
});

describe("S-52 — self-link w stopce", () => {
  it("odnośnik o adresie bieżącej strony dostaje aria-current=page (obie generacje)", () => {
    for (const stopka of [stopkaNaPlotnie(), stopkaV1()]) {
      const { container, unmount } = render(
        <SiteRenderer sections={[stopka]} currentPath="/regulamin" />,
      );
      const current = container.querySelectorAll('footer a[aria-current="page"]');
      expect(current, "self-link bez oznaczenia").toHaveLength(1);
      expect(current[0]!.getAttribute("href")).toBe("/regulamin");
      unmount();
    }
  });

  it("bez `currentPath` ŻADEN odnośnik nie niesie aria-current", () => {
    const { container } = render(<SiteRenderer sections={[stopkaNaPlotnie()]} />);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
  });
});
