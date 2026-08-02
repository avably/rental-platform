/**
 * ŹRÓDŁO ZDJĘCIA: DWA ŚWIATY I ZGODNOŚĆ WSTECZ (K3, ADR-086).
 *
 * `image` ma dwa rozłączne źródła — plik w naszym buckecie (`storage`) i
 * hotlink u dostawcy (`unsplash`, z atrybucją). Do K2 element niósł jednak
 * gołe `imagePath` i taka treść LEŻY JUŻ W BAZIE u każdego, kto otworzył
 * kreator przed K3.
 *
 * Ten plik broni zgodności wstecz JAWNIE, bo bez niego wycięcie odczytu
 * starego pola przechodziło przez cały pakiet na zielono (mutacja recenzji
 * PM do PR #156): konwersja zapisuje już `source`, więc żaden istniejący
 * test nie miał powodu podać elementu ze starym polem. Zgodność wstecz jest
 * dokładnie tą klasą zachowania, której nikt nie zauważy, dopóki nie zniknie
 * — i którą zauważy dopiero najemca z pustym miejscem po zdjęciu.
 */
import { describe, expect, it } from "vitest";

import {
  imageSourceSchema,
  normalizeImageSource,
  sectionCanvasSchema,
  type ImageSource,
} from "./elements";

const UNSPLASH: ImageSource = {
  kind: "unsplash",
  url: "https://images.example.com/photo.jpg",
  authorName: "Jan Kowalski",
  authorUrl: "https://example.com/@jan?utm_source=avably&utm_medium=referral",
  downloadLocation: "https://api.unsplash.com/photos/abc/download",
};

describe("normalizeImageSource: jedno pytanie o źródło w całym systemie", () => {
  it("element ze STARYM `imagePath` (sprzed K3) daje źródło storage", () => {
    // TO JEST TEST ZGODNOŚCI WSTECZ. Wycięcie tej gałęzi zostawia najemcę,
    // który wgrał zdjęcie przed K3, z pustym kafelkiem — i nic innego tego
    // nie zauważa, bo nowa treść starego pola już nie zapisuje.
    expect(normalizeImageSource({ imagePath: "tenant/hero.jpg" })).toEqual({
      kind: "storage",
      path: "tenant/hero.jpg",
    });
  });

  it("nowe `source` wygrywa ze starym polem, gdy oba są obecne", () => {
    // Stan przejściowy: element zapisany po K3 może jeszcze nieść stare pole
    // z odczytu. Prawdą jest NOWE źródło — inaczej zapis nie miałby skutku.
    const source = normalizeImageSource({
      source: { kind: "storage", path: "tenant/nowe.jpg" },
      imagePath: "tenant/stare.jpg",
    });
    expect(source).toEqual({ kind: "storage", path: "tenant/nowe.jpg" });
  });

  it("hotlink przechodzi bez zmian — razem z atrybucją", () => {
    expect(normalizeImageSource({ source: UNSPLASH })).toEqual(UNSPLASH);
  });

  it("element bez żadnego źródła nie ma źródła (kafel zastępczy)", () => {
    expect(normalizeImageSource({})).toBeUndefined();
  });
});

describe("schemat źródła: dwa światy są rozłączne", () => {
  it("storage wymaga ŚCIEŻKI, nie adresu", () => {
    expect(imageSourceSchema.safeParse({ kind: "storage", path: "t/a.jpg" }).success).toBe(true);
    expect(imageSourceSchema.safeParse({ kind: "storage", path: "https://obcy/a.jpg" }).success).toBe(false);
    expect(imageSourceSchema.safeParse({ kind: "storage", path: "../../etc/passwd" }).success).toBe(false);
  });

  it("hotlink bez KOMPLETU atrybucji nie przechodzi", () => {
    // Atrybucja jest warunkiem licencji, więc jej brak to nie jest „zdjęcie
    // bez podpisu", tylko treść, której nie wolno zapisać.
    for (const missing of ["authorName", "authorUrl", "downloadLocation"] as const) {
      const photo: Record<string, unknown> = { ...UNSPLASH };
      delete photo[missing];
      expect(imageSourceSchema.safeParse(photo).success, `przeszło bez ${missing}`).toBe(false);
    }
  });

  it("obcy klucz w źródle jest błędem", () => {
    expect(imageSourceSchema.safeParse({ ...UNSPLASH, onload: "alert(1)" }).success).toBe(false);
  });
});

describe("płótno przyjmuje element w OBU kształtach", () => {
  function canvasWithImage(image: Record<string, unknown>): unknown {
    return {
      version: 2,
      rows: 40,
      background: "default",
      elements: [
        {
          id: "img1",
          kind: "image",
          alt: "Koparka",
          fit: "cover",
          layout: { desktop: { x: 0, y: 0, w: 40, h: 20, z: 0 } },
          ...image,
        },
      ],
    };
  }

  it("treść sprzed K3 (samo `imagePath`) nadal przechodzi schemat", () => {
    const parsed = sectionCanvasSchema.safeParse(canvasWithImage({ imagePath: "t/a.jpg" }));
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it("treść po K3 (`source`) przechodzi tak samo", () => {
    const parsed = sectionCanvasSchema.safeParse(
      canvasWithImage({ source: { kind: "storage", path: "t/a.jpg" } }),
    );
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });
});
