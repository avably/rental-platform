import { describe, expect, it } from "vitest";

import {
  pickProductThumbnails,
  productImagePublicUrl,
  type ProductImageRow,
} from "@/lib/catalog/product-thumbnail";

/**
 * Miniatury listy katalogu (U8a, ADR-145) — funkcje czyste, bez sieci.
 *
 * Trzy rzeczy są tu rozstrzygnięciem, nie szczegółem: GOŁY URL publiczny
 * (a nie transformacja zależna od planu hostingu), PIERWSZE zdjęcie po
 * porządku prezentacji (a nie dowolne) i PUSTY `alt` przy braku opisu
 * (a nie nazwa pliku ani nazwa produktu).
 */

const BASE = "http://127.0.0.1:54321";

function image(over: Partial<ProductImageRow>): ProductImageRow {
  return { product_id: "p1", storage_path: "t/p1/a.jpg", alt_text: null, ...over };
}

describe("publiczny URL miniatury", () => {
  it("składa adres bucketu product-images ze ścieżki obiektu", () => {
    expect(productImagePublicUrl(BASE, "t/p1/a.jpg")).toBe(
      `${BASE}/storage/v1/object/public/product-images/t/p1/a.jpg`,
    );
  });

  it("NIE używa transformacji obrazów (zależy od planu hostingu)", () => {
    // Druga strona decyzji z ADR-145: ekran zdjęć wolno degradować,
    // GŁÓWNY EKRAN PRACY nie.
    expect(productImagePublicUrl(BASE, "t/p1/a.jpg")).not.toContain("/render/image/");
  });

  it("znosi ukośniki na styku bazy i ścieżki (bez podwójnego //)", () => {
    expect(productImagePublicUrl("http://h/", "/t/p1/a.jpg")).toBe(
      "http://h/storage/v1/object/public/product-images/t/p1/a.jpg",
    );
  });
});

describe("wybór miniatury produktu", () => {
  it("wygrywa PIERWSZE zdjęcie w porządku prezentacji, nie ostatnie", () => {
    const thumbnails = pickProductThumbnails(
      [
        image({ storage_path: "t/p1/pierwsze.jpg", alt_text: "Pierwsze" }),
        image({ storage_path: "t/p1/drugie.jpg", alt_text: "Drugie" }),
      ],
      BASE,
    );
    expect(thumbnails.get("p1")!.url).toContain("pierwsze.jpg");
    expect(thumbnails.get("p1")!.url).not.toContain("drugie.jpg");
  });

  it("rozdziela zdjęcia między produkty, nie zlepia ich w jedno", () => {
    const thumbnails = pickProductThumbnails(
      [
        image({ product_id: "p1", storage_path: "t/p1/a.jpg" }),
        image({ product_id: "p2", storage_path: "t/p2/b.jpg" }),
      ],
      BASE,
    );
    expect(thumbnails.get("p1")!.url).toContain("t/p1/a.jpg");
    expect(thumbnails.get("p2")!.url).toContain("t/p2/b.jpg");
    // Produkt bez zdjęcia nie dostaje cudzego — wcale go w mapie nie ma.
    expect(thumbnails.has("p3")).toBe(false);
  });

  it("alt bierze się z alt_text, a jego BRAK daje pusty alt (obraz dekoracyjny)", () => {
    const withText = pickProductThumbnails([image({ alt_text: "Rower przy ścianie" })], BASE);
    expect(withText.get("p1")!.alt).toBe("Rower przy ścianie");

    const withoutText = pickProductThumbnails(
      [image({ product_id: "p2", storage_path: "t/p2/IMG_2481.jpg", alt_text: null })],
      BASE,
    );
    const alt = withoutText.get("p2")!.alt;
    expect(alt).toBe("");
    // Nazwa pliku NIE JEST opisem — czytnik ekranu nie ma jej ogłaszać.
    expect(alt).not.toContain("IMG_2481");
    expect(alt).not.toContain(".jpg");
  });
});
