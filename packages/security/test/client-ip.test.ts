/**
 * Wyprowadzenie IP klienta do klucza rate-limitu (src/client-ip.ts, ADR-106).
 *
 * Sedno: klucz limitu NIE MOŻE pochodzić z części nagłówka kontrolowanej
 * przez klienta. `x-forwarded-for` jest listą, do której każdy hop DOKLEJA
 * adres źródła połączenia NA KONIEC — wpisy z lewej to deklaracje klienta.
 * Podrobiony prefiks nie może więc zmieniać klucza (= resetować licznika).
 */
import { describe, expect, it } from "vitest";

import { clientIpFromHeaders } from "../src/client-ip";

function headersOf(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return { get: (name: string) => map.get(name) };
}

describe("źródło zaufane", () => {
  it("preferuje x-real-ip (ustawiany przez platformę) nad x-forwarded-for", () => {
    const headers = headersOf({
      "x-real-ip": "198.51.100.7",
      "x-forwarded-for": "6.6.6.6, 198.51.100.7",
    });
    expect(clientIpFromHeaders(headers)).toBe("198.51.100.7");
  });

  it("przycina białe znaki z x-real-ip", () => {
    expect(clientIpFromHeaders(headersOf({ "x-real-ip": " 198.51.100.7 " }))).toBe("198.51.100.7");
  });
});

describe("x-forwarded-for: liczy się OSTATNI hop (doklejony przez zaufane proxy)", () => {
  it("pojedynczy wpis działa jak dotąd", () => {
    expect(clientIpFromHeaders(headersOf({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("podrobiony prefiks klienta NIE zmienia klucza limitu", () => {
    // Klient przysłał „x-forwarded-for: 1.2.3.4” — proxy dokleiło prawdziwy
    // adres źródła na koniec. Klucz musi pochodzić z wpisu proxy.
    const spoofed = clientIpFromHeaders(
      headersOf({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" }),
    );
    const honest = clientIpFromHeaders(headersOf({ "x-forwarded-for": "198.51.100.7" }));
    expect(spoofed).toBe("198.51.100.7");
    expect(spoofed, "podrobiony prefiks dał inny klucz — reset licznika za darmo").toBe(honest);
  });

  it("dwa różne podrobione prefiksy dają TEN SAM klucz", () => {
    const a = clientIpFromHeaders(headersOf({ "x-forwarded-for": "1.1.1.1, 198.51.100.7" }));
    const b = clientIpFromHeaders(headersOf({ "x-forwarded-for": "2.2.2.2, 198.51.100.7" }));
    expect(a).toBe(b);
  });

  it("radzi sobie ze spacjami i pustymi segmentami", () => {
    expect(
      clientIpFromHeaders(headersOf({ "x-forwarded-for": "1.2.3.4 , 198.51.100.7 , " })),
    ).toBe("198.51.100.7");
  });
});

describe("brak nagłówków (dev, testy)", () => {
  it("zwraca wspólny kubełek `unknown` — nie do podrobienia", () => {
    expect(clientIpFromHeaders(headersOf({}))).toBe("unknown");
  });

  it("pusty x-forwarded-for traktuje jak brak", () => {
    expect(clientIpFromHeaders(headersOf({ "x-forwarded-for": " " }))).toBe("unknown");
  });
});
