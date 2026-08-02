/**
 * TREŚĆ SFORMATOWANA — KONTRAKT BEZPIECZEŃSTWA (K3, ADR-086).
 *
 * Edycja w miejscu wpuszcza treść operatora na PUBLICZNĄ stronę jego klientów,
 * więc ten plik nie sprawdza „czy formatowanie działa", tylko czego zrobić
 * SIĘ NIE DA. Trzy osie:
 *
 *   1. TREŚĆ NIE JEST ZNACZNIKIEM — `<script>` przechodzi jako TEKST i ma
 *      pozostać tekstem (render dowodzi drugiej połowy, w @avably/ui);
 *   2. SCHEMAT LINKU jest allowlistą — `javascript:`, `data:` i spółka odpadają
 *      z definicji, a nie z listy zakazów;
 *   3. NIEZNANY KLUCZ jest błędem — `.strict()` nie pozwala przemycić pola,
 *      które ktoś kiedyś nieopatrznie zacznie renderować.
 */
import { describe, expect, it } from "vitest";

import { sectionCanvasSchema, type SectionCanvas } from "./elements";
import {
  MAX_RUNS_PER_ELEMENT,
  normalizeRuns,
  plainTextOf,
  richTextSchema,
  runsFromPlainText,
  textRunSchema,
} from "./rich-text";

describe("run treści: co przechodzi", () => {
  it("zwykły tekst bez formatowania", () => {
    expect(textRunSchema.safeParse({ text: "Sprzęt na już" }).success).toBe(true);
  });

  it("pogrubienie, pochylenie i link razem", () => {
    const run = { text: "cennik", bold: true, italic: true, href: "/cennik" };
    expect(textRunSchema.safeParse(run).success).toBe(true);
  });

  it.each(["https://example.com", "http://example.com", "/cennik", "#kontakt"])(
    "adres %s jest dozwolony (ta sama allowlista co przycisk)",
    (href) => {
      expect(textRunSchema.safeParse({ text: "link", href }).success).toBe(true);
    },
  );
});

describe("run treści: co NIE przechodzi", () => {
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ])("wrogi schemat adresu odpada: %s", (href) => {
    expect(textRunSchema.safeParse({ text: "klik", href }).success).toBe(false);
  });

  it("nieznany klucz jest BŁĘDEM, nie balastem", () => {
    // `.strict()` broni przed przemyceniem pola, które kiedyś ktoś zacznie
    // renderować — np. „html" albo „onClick".
    expect(textRunSchema.safeParse({ text: "x", html: "<img onerror=alert(1)>" }).success).toBe(false);
    expect(textRunSchema.safeParse({ text: "x", onClick: "alert(1)" }).success).toBe(false);
  });

  it("pusty run nie jest treścią", () => {
    expect(textRunSchema.safeParse({ text: "" }).success).toBe(false);
  });

  it("formatowanie musi być logiczne, nie dowolne", () => {
    expect(textRunSchema.safeParse({ text: "x", bold: "yes" }).success).toBe(false);
  });

  it("lista runów ma sufit i nie może być pusta", () => {
    expect(richTextSchema.safeParse([]).success).toBe(false);
    const overflow = Array.from({ length: MAX_RUNS_PER_ELEMENT + 1 }, () => ({ text: "x" }));
    expect(richTextSchema.safeParse(overflow).success).toBe(false);
  });
});

describe("znaczniki w treści zostają TEKSTEM", () => {
  it("schemat PRZEPUSZCZA wrogi napis — bo to jest tekst, nie znacznik", () => {
    // To NIE jest luka: run niesie tekst, a render składa znaczniki sam
    // (patrz element-canvas.test.tsx — druga połowa tego dowodu).
    const parsed = textRunSchema.safeParse({ text: "<script>alert(1)</script>" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.text).toBe("<script>alert(1)</script>");
  });

  it("spłaszczenie oddaje dokładnie to, co widać", () => {
    expect(plainTextOf([{ text: "Sprzęt " }, { text: "na już", bold: true }])).toBe("Sprzęt na już");
  });
});

describe("normalizacja runów", () => {
  it("skleja sąsiadów o identycznym formatowaniu", () => {
    // Edytor w miejscu produkuje run per węzeł DOM — bez sklejania jedno
    // zdanie rozpadłoby się na kilkanaście kawałków i dobiło do sufitu.
    expect(normalizeRuns([{ text: "Sprzęt " }, { text: "na już" }])).toEqual([{ text: "Sprzęt na już" }]);
  });

  it("NIE skleja runów o różnym formatowaniu", () => {
    const runs = normalizeRuns([{ text: "Sprzęt " }, { text: "na już", bold: true }]);
    expect(runs).toHaveLength(2);
  });

  it("różny link to różne runy, nawet przy tym samym stylu", () => {
    const runs = normalizeRuns([
      { text: "a", href: "/x" },
      { text: "b", href: "/y" },
    ]);
    expect(runs).toHaveLength(2);
  });

  it("wyrzuca puste kawałki, a całkiem pusta treść daje PUSTĄ listę", () => {
    expect(normalizeRuns([{ text: "" }, { text: "x" }])).toEqual([{ text: "x" }]);
    // Pusta lista jest legalnym WYNIKIEM, ale nie treścią — wołający ma wtedy
    // zdjąć runy z elementu, a nie zapisać pustkę.
    expect(normalizeRuns([{ text: "" }])).toEqual([]);
    expect(richTextSchema.safeParse(normalizeRuns([{ text: "" }])).success).toBe(false);
  });

  it("z gołego tekstu robi jeden run, a z pustki nic", () => {
    expect(runsFromPlainText("Alfa")).toEqual([{ text: "Alfa" }]);
    expect(runsFromPlainText("")).toBeUndefined();
  });
});

describe("płótno: runy muszą zgadzać się z tekstem elementu", () => {
  function canvasWith(element: Record<string, unknown>): unknown {
    return {
      version: 2,
      rows: 40,
      background: "default",
      elements: [
        {
          id: "e1",
          layout: { desktop: { x: 0, y: 0, w: 40, h: 10, z: 0 } },
          ...element,
        },
      ],
    };
  }

  it("zgodne runy przechodzą", () => {
    const parsed = sectionCanvasSchema.safeParse(
      canvasWith({
        kind: "text",
        text: "Sprzęt na już",
        runs: [{ text: "Sprzęt " }, { text: "na już", bold: true }],
        variant: "body",
        align: "left",
      }),
    );
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it("ROZJAZD runów i tekstu jest błędem", () => {
    // Inaczej strona pokazywałaby jedno, a metadane niosłyby drugie.
    const parsed = sectionCanvasSchema.safeParse(
      canvasWith({
        kind: "text",
        text: "Sprzęt na już",
        runs: [{ text: "Zupełnie co innego" }],
        variant: "body",
        align: "left",
      }),
    );
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && JSON.stringify(parsed.error.issues)).toContain("runs");
  });

  it("wrogi link w runie wywraca CAŁE płótno, nie tylko element", () => {
    const parsed = sectionCanvasSchema.safeParse(
      canvasWith({
        kind: "text",
        text: "klik",
        runs: [{ text: "klik", href: "javascript:alert(1)" }],
        variant: "body",
        align: "left",
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("element bez runów zostaje poprawny (runy są opcjonalne)", () => {
    const canvas = sectionCanvasSchema.safeParse(
      canvasWith({ kind: "text", text: "Bez formatowania", variant: "body", align: "left" }),
    );
    expect(canvas.success).toBe(true);
    expect(canvas.success && (canvas.data as SectionCanvas).elements[0]).not.toHaveProperty("runs");
  });
});
