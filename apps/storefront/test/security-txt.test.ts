/**
 * `/.well-known/security.txt` (RFC 9116, I-01, ADR-123). Plik WŁASNY dla
 * zadania I-01 — nie rusza żadnego cudzego testu.
 *
 * DoD zadania: żądanie zwraca 200, poprawny Content-Type i zawiera pola
 * `Contact` oraz `Expires`. Dodatkowo pilnuje `Preferred-Languages`,
 * `Canonical` i tego, że `Expires` jest realną datą w przyszłości (nie
 * literałem, który przypadkiem wygląda jak ISODATE, ale wskazuje w
 * przeszłość — patrz docblock `lib/seo/security-txt.ts` o stałej dacie).
 *
 * Adres kontaktowy jest PRZYPIĘTY do literału (2026-08-10): sam regex domeny
 * przepuszcza każdy adres `@avably.io`, więc literówka w stałej trafiłaby na
 * produkcję bez czerwonego testu.
 */
import { describe, expect, it } from "vitest";

import { GET } from "../app/.well-known/security.txt/route";
import {
  renderSecurityTxt,
  SECURITY_TXT_CANONICAL,
  SECURITY_TXT_CONTACT,
  SECURITY_TXT_EXPIRES,
} from "../lib/seo/security-txt";

describe("GET /.well-known/security.txt", () => {
  it("zwraca 200 z text/plain; charset=utf-8", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("zawiera pola Contact i Expires wymagane przez DoD I-01", async () => {
    const response = await GET();
    const body = await response.text();
    expect(body).toMatch(/^Contact: mailto:[^\s@]+@avably\.io$/m);
    expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
  });

  it("Contact wskazuje DOKŁADNIE na alias zgłoszeniowy, a nie na dowolny adres @avably.io", async () => {
    // Dwie asercje, bo każda broni czego innego. Pierwsza PRZYPINA literał:
    // regex wyżej przepuszcza każdy adres w domenie, więc literówka w stałej
    // (`secuirty@`) albo cofnięcie na `admin@` przeszłyby niezauważone.
    expect(SECURITY_TXT_CONTACT).toBe("security@avably.io");
    // Druga sprawdza, że renderer NAPRAWDĘ wstawia tę stałą do odpowiedzi
    // trasy — czyta z `GET()`, tak jak czyta produkcja, nie z samego modułu.
    const body = await (await GET()).text();
    expect(body).toContain(`Contact: mailto:${SECURITY_TXT_CONTACT}`);
  });

  it("Preferred-Languages i Canonical zgodne z kontraktem zadania", () => {
    const body = renderSecurityTxt();
    expect(body).toContain("Preferred-Languages: pl, en");
    expect(body).toContain(`Canonical: ${SECURITY_TXT_CANONICAL}`);
    expect(SECURITY_TXT_CANONICAL).toBe("https://www.avably.io/.well-known/security.txt");
  });

  it("Expires jest realną datą w przyszłości (RFC 9116 §2.5.5)", () => {
    const expiresAt = new Date(SECURITY_TXT_EXPIRES);
    expect(Number.isNaN(expiresAt.getTime())).toBe(false);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("nie ustawia żadnego nagłówka CORS (zwykły plik tekstowy, nie API)", async () => {
    const response = await GET();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
