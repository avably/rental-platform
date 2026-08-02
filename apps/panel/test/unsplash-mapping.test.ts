/**
 * ODPOWIEDŹ DOSTAWCY → NASZ KSZTAŁT (K3, ADR-086).
 *
 * `toPhoto` jest bramą między cudzym API a naszą treścią. Jej zadaniem nie
 * jest „przepisać pola", tylko ODRZUCIĆ zdjęcie, którego nie wolno pokazać:
 * atrybucja autora i adres wyzwalacza pobrania są warunkami licencji, więc
 * zdjęcie bez KOMPLETU tych pól nie może trafić na stronę najemcy — lepiej
 * pokazać o jedno mniej, niż złamać warunki, na które nikt nie patrzy.
 *
 * Każde pole jest sprawdzane Z OSOBNA. Test „brakuje czegokolwiek → odpada"
 * przechodziłby także wtedy, gdyby brama patrzyła tylko na jedno pole.
 */
import { describe, expect, it } from "vitest";

import { toPhoto } from "@/lib/unsplash";

/** Odpowiedź dostawcy w kształcie, jaki naprawdę przychodzi z API. */
function raw(overrides: Record<string, unknown> = {}) {
  return {
    id: "abc123",
    urls: { small: "https://images.example.com/thumb.jpg", regular: "https://images.example.com/photo.jpg" },
    alt_description: "Koparka na budowie",
    links: { download_location: "https://api.unsplash.com/photos/abc123/download" },
    user: { name: "Jan Kowalski", links: { html: "https://example.com/@jan" } },
    ...overrides,
  };
}

describe("komplet pól przechodzi", () => {
  it("mapuje zdjęcie i DOKLEJA parametry atrybucji do linku autora", () => {
    const photo = toPhoto(raw());
    expect(photo).not.toBeNull();
    expect(photo!.id).toBe("abc123");
    expect(photo!.thumbUrl).toBe("https://images.example.com/thumb.jpg");
    expect(photo!.url).toBe("https://images.example.com/photo.jpg");
    expect(photo!.alt).toBe("Koparka na budowie");
    expect(photo!.authorName).toBe("Jan Kowalski");
    expect(photo!.downloadLocation).toBe("https://api.unsplash.com/photos/abc123/download");
    // Parametry źródła są wymogiem regulaminu — bez nich atrybucja się nie liczy.
    expect(photo!.authorUrl).toContain("utm_source=avably");
    expect(photo!.authorUrl).toContain("utm_medium=referral");
  });

  it("link autora z własnym zapytaniem dostaje parametry przez `&`, nie drugie `?`", () => {
    const photo = toPhoto(raw({ user: { name: "Jan", links: { html: "https://example.com/@jan?a=1" } } }));
    expect(photo!.authorUrl).toBe("https://example.com/@jan?a=1&utm_source=avably&utm_medium=referral");
  });

  it("bez opisu bierze opis zapasowy, a na końcu podpis autora", () => {
    // `alt` jest WYMAGANY przez schemat elementu — zdjęcie bez opisu u dostawcy
    // nie może dać treści, której nie da się zapisać.
    expect(toPhoto(raw({ alt_description: null, description: "Plac budowy" }))!.alt).toBe("Plac budowy");
    expect(toPhoto(raw({ alt_description: null, description: null }))!.alt).toBe("Jan Kowalski");
  });
});

describe("brak KTÓREGOKOLWIEK pola odrzuca zdjęcie", () => {
  it("bez identyfikatora", () => {
    expect(toPhoto(raw({ id: undefined }))).toBeNull();
  });

  it("bez adresu miniatury", () => {
    expect(toPhoto(raw({ urls: { regular: "https://images.example.com/photo.jpg" } }))).toBeNull();
  });

  it("bez adresu zdjęcia", () => {
    expect(toPhoto(raw({ urls: { small: "https://images.example.com/thumb.jpg" } }))).toBeNull();
  });

  it("bez NAZWISKA autora — atrybucji nie da się pokazać", () => {
    expect(toPhoto(raw({ user: { links: { html: "https://example.com/@jan" } } }))).toBeNull();
  });

  it("bez LINKU do autora — atrybucja bez odnośnika nie spełnia warunku", () => {
    expect(toPhoto(raw({ user: { name: "Jan Kowalski" } }))).toBeNull();
  });

  it("bez adresu WYZWALACZA POBRANIA", () => {
    expect(toPhoto(raw({ links: {} }))).toBeNull();
  });

  it("odpowiedź, która nie jest obiektem", () => {
    expect(toPhoto(null)).toBeNull();
    expect(toPhoto("zdjęcie")).toBeNull();
    expect(toPhoto(42)).toBeNull();
  });

  it("pola o złym TYPIE nie są przepisywane na siłę", () => {
    expect(toPhoto(raw({ id: 123 }))).toBeNull();
    expect(toPhoto(raw({ user: { name: 5, links: { html: "https://example.com/@jan" } } }))).toBeNull();
  });
});
