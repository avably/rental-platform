// @vitest-environment jsdom
/**
 * SELECT SORTOWANIA KATEGORII — ZACHOWANIE KLIENTA (F9).
 *
 * Testy tras (`category-page-route`) mierzą SSR: opcje, wartość z adresu,
 * fallback GET. Ten plik mierzy to, czego renderToStaticMarkup nie wykonuje:
 * ZMIANA wartości jest NAWIGACJĄ — router.push pod stronę PIERWSZĄ z sortem
 * (numer strony liczy się w porządku, więc zmiana porządku nie może trzymać
 * numeru — ta sama reguła, co przy odnośnikach ADR-247), a porządek domyślny
 * wraca pod adres CZYSTY (kanon bez `?sort=name`).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { CategorySort } from "@/components/storefront/category-sort";
import plMessages from "../messages/pl.json";

const copy = plMessages.storefront;

describe("select sortowania kategorii (F9)", () => {
  // jsdom nie sprząta drzewa między testami sam (lekcja: #id bez cleanup = null).
  afterEach(() => {
    cleanup();
    push.mockClear();
  });

  it("niesie cztery porządki, wartość z propsa i etykietę przez label[for]", () => {
    render(<CategorySort copy={copy} slug="rowery" active="price_desc" />);
    const select = screen.getByLabelText("Sortuj:") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual([
      "name",
      "price_asc",
      "price_desc",
      "newest",
    ]);
    expect(select.value).toBe("price_desc");
  });

  it("zmiana porządku NAWIGUJE pod stronę 1 z sortem w adresie", () => {
    render(<CategorySort copy={copy} slug="rowery" active="name" />);
    fireEvent.change(screen.getByLabelText("Sortuj:"), { target: { value: "price_asc" } });
    expect(push).toHaveBeenCalledExactlyOnceWith("/kategoria/rowery?sort=price_asc");
  });

  it("powrót do porządku domyślnego celuje w adres CZYSTY (bez ?sort=)", () => {
    render(<CategorySort copy={copy} slug="rowery" active="price_asc" />);
    fireEvent.change(screen.getByLabelText("Sortuj:"), { target: { value: "name" } });
    expect(push).toHaveBeenCalledExactlyOnceWith("/kategoria/rowery");
  });

  it("fallback bez JS: form GET w czysty adres kategorii, pole `sort`, przycisk w noscript", () => {
    const { container } = render(<CategorySort copy={copy} slug="rowery" active="name" />);
    const form = container.querySelector("form[data-category-sort]");
    expect(form).not.toBeNull();
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/kategoria/rowery");
    expect(container.querySelector('select[name="sort"]')).not.toBeNull();
    // Przycisk wysyłki istnieje WYŁĄCZNIE dla klienta bez skryptów.
    expect(container.querySelector("noscript")).not.toBeNull();
  });
});
