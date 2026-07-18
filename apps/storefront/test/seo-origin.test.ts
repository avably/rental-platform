/**
 * Origin kanoniczny (lib/seo/origin.ts, Zadanie 2.7, ADR-044). Sedno: oś
 * tenancka bierze canonical z HOSTA ŻĄDANIA, oś marketingowa — z kanonu.
 */
import { CANONICAL_SITE_URL } from "@avably/core";
import { describe, expect, it } from "vitest";

import { marketingOrigin, originFromHost } from "@/lib/seo/origin";

describe("originFromHost — canonical na hoście tenanta", () => {
  it.each([
    ["acme.avably.io", "https://acme.avably.io"],
    ["ACME.AVABLY.IO", "https://acme.avably.io"],
    ["sklep-1.avably.io", "https://sklep-1.avably.io"],
  ])("host produkcyjny '%s' → %s (https)", (host, expected) => {
    expect(originFromHost(host)).toBe(expected);
  });

  it.each([
    ["acme.localhost:3033", "http://acme.localhost:3033"],
    ["localhost:3033", "http://localhost:3033"],
    ["127.0.0.1:3033", "http://127.0.0.1:3033"],
  ])("host lokalny '%s' → %s (http, bez TLS)", (host, expected) => {
    expect(originFromHost(host)).toBe(expected);
  });

  it("respektuje X-Forwarded-Proto zza proxy (bierze pierwszy z listy)", () => {
    expect(originFromHost("acme.avably.io", "https, http")).toBe("https://acme.avably.io");
    expect(originFromHost("acme.localhost:3033", "https")).toBe("https://acme.localhost:3033");
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["   "],
    // Host niesie KLIENT — do adresu nie może wejść nic poza [host:port].
    ["evil.com/\\path"],
    ["evil.com evil2.com"],
    ["evil.com\nX-Injected: 1"],
  ])("host niepoprawny (%p) → null, wołający pomija canonical", (host) => {
    expect(originFromHost(host)).toBeNull();
  });
});

describe("marketingOrigin — kanon, nie host żądania", () => {
  it.each(["avably-preview.vercel.app", "avably.io", "www.avably.io"])(
    "w produkcji host '%s' i tak daje kanon (zero dubletów w indeksie)",
    (host) => {
      expect(marketingOrigin(host, null, "production")).toBe(CANONICAL_SITE_URL);
    },
  );

  it("poza produkcją używa origin żądania (klikalne linki w dev)", () => {
    expect(marketingOrigin("localhost:3033", null, "development")).toBe("http://localhost:3033");
  });

  it("poza produkcją, gdy host niepoprawny — spada na kanon zamiast wywalać się", () => {
    expect(marketingOrigin("", null, "development")).toBe(CANONICAL_SITE_URL);
  });
});
