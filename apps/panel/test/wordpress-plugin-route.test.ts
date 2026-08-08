/**
 * Trasa pobierania wtyczki WordPress (M2, ADR-110) — na atrapie guardu.
 *
 * Bronione wyniki:
 *  1. ANON dostaje 401 i ZERO bajtów paczki — pobranie jest za bramką sesji
 *     jak reszta panelu (odmowa przed pracą).
 *  2. Członek dostaje archiwum ZIP z nagłówkami, po których przeglądarka
 *     zapisze plik pod właściwą nazwą (z wersją), a pośrednik go nie zbuforuje.
 *  3. Odesłane bajty są TĄ SAMĄ paczką, którą opisuje kontrakt zawartości —
 *     bez plików deweloperskich (asercja na liście wpisów archiwum).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/lib/auth";
import {
  WORDPRESS_PLUGIN_ENTRIES,
  WORDPRESS_PLUGIN_FILENAME,
  WORDPRESS_PLUGIN_VERSION,
} from "@/lib/wordpress/plugin-package";

const requireMemberMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-server", () => ({ requireMember: requireMemberMock }));

const { GET } = await import("@/app/[locale]/(panel)/ustawienia-api/wtyczka/route");

beforeEach(() => {
  requireMemberMock.mockReset();
});

/** Nazwy wpisów odczytane z nagłówków lokalnych archiwum. */
function entriesOf(zip: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    names.push(zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

describe("GET /ustawienia-api/wtyczka", () => {
  it("anonim: 401 i zero bajtów", async () => {
    requireMemberMock.mockRejectedValue(new AuthError(401, "unauthenticated"));

    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.arrayBuffer()).toHaveProperty("byteLength", 0);
  });

  it("członek: ZIP z nagłówkami pobrania", async () => {
    requireMemberMock.mockResolvedValue({ tenantId: "t1", role: "staff" });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${WORDPRESS_PLUGIN_FILENAME}"`,
    );
    // Nazwa niesie wersję — operator wie, co pobrał, także po zapisaniu.
    expect(WORDPRESS_PLUGIN_FILENAME).toContain(WORDPRESS_PLUGIN_VERSION);
    // Paczka jest prywatna dla sesji: pośrednik nie ma jej trzymać.
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("odesłane bajty to poprawne archiwum bez plików deweloperskich", async () => {
    requireMemberMock.mockResolvedValue({ tenantId: "t1", role: "owner" });

    const response = await GET();
    const zip = Buffer.from(await response.arrayBuffer());

    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(Number(response.headers.get("content-length"))).toBe(zip.length);

    const entries = entriesOf(zip);
    expect([...entries].sort()).toEqual([...WORDPRESS_PLUGIN_ENTRIES].sort());
    expect(entries.every((entry) => entry.startsWith("avably-booking/"))).toBe(true);
    expect(
      entries.filter(
        (entry) =>
          entry.includes("/dev/") || entry.includes("/tests/") || entry.includes("phpunit"),
      ),
    ).toEqual([]);
  });

  it("guard stoi PRZED złożeniem odpowiedzi (jedno wywołanie na żądanie)", async () => {
    requireMemberMock.mockResolvedValue({ tenantId: "t1", role: "staff" });
    await GET();
    expect(requireMemberMock).toHaveBeenCalledTimes(1);
  });
});
