/**
 * Bramka hasła indeksu przeglądu (/[locale]/przeglad).
 *
 * Strona jest narzędziem roboczym właściciela: bez poprawnego hasła w Basic
 * Auth ma odpowiadać 401 z nagłówkiem WWW-Authenticate (to on wywołuje
 * natywne okno logowania) i nie zdradzać treści. Nazwa użytkownika jest
 * dowolna — liczy się wyłącznie hasło.
 */
import { describe, expect, it } from "vitest";

import { GET } from "@/app/[locale]/przeglad/route";

function request(authorization?: string): Request {
  return new Request(
    "http://www.avably.local/pl/przeglad",
    authorization ? { headers: { authorization } } : undefined,
  );
}

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

const context = { params: Promise.resolve({ locale: "pl" }) };

describe("hasło indeksu przeglądu", () => {
  it("bez nagłówka autoryzacji → 401 z WWW-Authenticate i bez treści", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(await response.text()).not.toContain("Przegląd układów");
  });

  it("złe hasło → 401; treść niedostępna", async () => {
    const response = await GET(request(basic("ktokolwiek", "zle-haslo")), context);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("Przegląd układów");
  });

  it("dobre hasło (dowolny użytkownik) → 200, indeks z linkami i noindex", async () => {
    const response = await GET(request(basic("", "notavably")), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const html = await response.text();
    expect(html).toContain("Przegląd układów");
    expect(html).toContain("/pl/pricing");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("nieznane locale → 404 (przed pytaniem o hasło niczego nie zdradza)", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ locale: "de" }),
    });
    expect(response.status).toBe(404);
  });
});
