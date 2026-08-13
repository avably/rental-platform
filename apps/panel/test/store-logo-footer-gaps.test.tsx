// @vitest-environment jsdom

/**
 * PRZEŁĄCZNIK „POKAŻ LOGO TAKŻE W STOPCE" MÓWI, GDZIE NIE ZADZIAŁA (ADR-167).
 *
 * ==================== CO TU JEST BRONIONE ====================
 *
 * Wada ADR-160 miała dwie warstwy. Pierwsza — render nie stosował znaku do
 * stopki na płótnie — jest naprawiona w pakiecie UI i tam ma swoje testy.
 * Druga jest ważniejsza i jest tutaj: przełącznik dawał się zaznaczyć, zapisać
 * i opublikować, a ekran nie mówił ani słowa o tym, że skutku nie będzie.
 *
 * Ten plik pilnuje, że ekran mówi — z nazwą strony i z powodem — ORAZ że milczy
 * wtedy, gdy nie ma o czym mówić. Obie nogi, bo ekran, który ostrzega zawsze,
 * jest tak samo bezużyteczny jak ten, który nie ostrzega nigdy: po drugim razie
 * nikt tego zdania nie czyta.
 *
 * Reguła („czy ta stopka przyjmie znak") NIE jest tu przepisana — test woła
 * `footerMarkGaps`, czyli tę samą funkcję, którą woła ekran, a ona woła
 * `footerAcceptsMark` z rdzenia, czyli tę samą, którą stosuje render sklepu.
 */
import { presetContentFor, sectionCanvasFrom, type CanvasElement } from "@avably/core/site";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

vi.mock("@/lib/site-image-base", () => ({
  siteImagePublicBase: () => "https://przyklad.supabase.co/storage/v1/object/public/site-images",
}));

const { StoreLogoCard } = await import("@/app/[locale]/(panel)/strona/store-logo-card");
const { footerMarkGaps } = await import("@/lib/footer-mark-reach");

afterEach(cleanup);

const LOGO = {
  path: "11111111-1111-4111-8111-111111111111/logo/22222222-2222-4222-8222-222222222222.png",
  inFooter: true,
};

/** Stopka DOKŁADNIE taka, jaką zapisuje kreator: preset → płótno v2. */
const STOPKA = sectionCanvasFrom("footer", presetContentFor("footer", "pl"));

const OBRAZ = {
  id: "footer-image-1",
  kind: "image",
  source: { kind: "storage", path: "t/s/x.png" },
  alt: "Obraz operatora",
  fit: "contain",
  layout: { desktop: { x: 0, y: 0, w: 20, h: 8, z: 1 } },
} as CanvasElement;

function karta(footerGaps: ReturnType<typeof footerMarkGaps>) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <StoreLogoCard state={{ draft: LOGO, published: LOGO }} footerGaps={footerGaps} />
    </NextIntlClientProvider>,
  );
}

describe("footerMarkGaps — co ekran ma powiedzieć", () => {
  it("strona ze zwykłą stopką z kreatora NIE jest luką", () => {
    const gaps = footerMarkGaps(
      [{ id: "s1", name: "Strona główna", live: true }],
      [{ site_id: "s1", content_published: STOPKA }],
    );
    expect(gaps).toEqual([]);
  });

  it("strona bez opublikowanej stopki jest luką `noFooter`", () => {
    const gaps = footerMarkGaps([{ id: "s1", name: "Kontakt", live: true }], []);
    expect(gaps).toEqual([{ page: "Kontakt", reason: "noFooter" }]);
  });

  it("stopka z własnym obrazem jest luką `ownImage`", () => {
    const gaps = footerMarkGaps(
      [{ id: "s1", name: "O nas", live: true }],
      [{ site_id: "s1", content_published: { ...STOPKA, elements: [...STOPKA.elements, OBRAZ] } }],
    );
    expect(gaps).toEqual([{ page: "O nas", reason: "ownImage" }]);
  });

  it("SONDA IZOLACJI: stopka jednej strony nie ucisza luki na DRUGIEJ", () => {
    /*
      Dopasowanie idzie po `site_id`, a nie po kolejności ani po „jest jakaś
      stopka w zbiorze". Gdyby szło inaczej, opublikowana stopka strony B
      kasowałaby ostrzeżenie dla strony A — a operator dostałby ekran mówiący,
      że wszystko gra, na sklepie, na którym znaku nie ma. Zbiór wejściowy jest
      zawężony tenantem po stronie zapytania I przez RLS, więc cudzy najemca nie
      ma jak się tu znaleźć; tu bronimy warstwy wyżej: cudzej STRONY.
    */
    const gaps = footerMarkGaps(
      [
        { id: "s1", name: "Strona główna", live: true },
        { id: "s2", name: "Kontakt", live: true },
      ],
      [{ site_id: "s2", content_published: STOPKA }],
    );
    expect(gaps).toEqual([{ page: "Strona główna", reason: "noFooter" }]);
  });

  it("strona NIEŻYWA nie jest luką — klient jej nie widzi", () => {
    // Ostrzeżenie na zapas o stronie, której nikt nie ogląda, uczy operatora
    // pomijać tę sekcję wzrokiem.
    const gaps = footerMarkGaps([{ id: "s1", name: "Szkic", live: false }], []);
    expect(gaps).toEqual([]);
  });
});

describe("karta znaku — zdanie przy przełączniku", () => {
  it("MILCZY, gdy znak wchodzi wszędzie", () => {
    const { container } = karta([]);
    expect(container.querySelector("[data-store-logo-footer-gaps]")).toBeNull();
    // Kontrola pozytywna: przełącznik, o którym mowa, JEST na ekranie — brak
    // ostrzeżenia nie bierze się z tego, że karta się nie wyrenderowała.
    expect(screen.getByText(messages.site.logo.inFooter)).not.toBeNull();
  });

  it("NAZYWA stronę i powód, gdy stopka ma własny obraz", () => {
    const { container } = karta([{ page: "O nas", reason: "ownImage" }]);
    const box = container.querySelector("[data-store-logo-footer-gaps]");
    expect(box).not.toBeNull();
    expect(box!.textContent).toContain("O nas");
    expect(box!.textContent).toContain("własny obraz");
  });

  it("ROZRÓŻNIA powody — brak stopki czyta się inaczej niż własny obraz", () => {
    const { container } = karta([
      { page: "Kontakt", reason: "noFooter" },
      { page: "O nas", reason: "ownImage" },
    ]);
    const wpisy = [...container.querySelectorAll("[data-store-logo-footer-gaps] li")].map(
      (li) => li.textContent ?? "",
    );
    expect(wpisy).toHaveLength(2);
    expect(wpisy[0]).toContain("nie ma stopki");
    expect(wpisy[1]).toContain("własny obraz");
    expect(wpisy[0]).not.toBe(wpisy[1]);
  });
});
