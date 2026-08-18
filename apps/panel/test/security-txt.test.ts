/**
 * `/.well-known/security.txt` na hoście PANELU (RFC 9116, L-SEC-01, ADR-193)
 * — lustro trasy storefrontu (I-01, ADR-123). Do tej naprawy panel odpowiadał
 * tu 404, choć to on jest powierzchnią z logowaniem i sekretami.
 *
 * Bronione WYNIKI:
 *  1. trasa panelu odpowiada 200 z poprawnym Content-Type i kompletem pól,
 *  2. treść jest CO DO ZNAKU tożsama z trasą storefrontu — jedno źródło
 *     (`apps/storefront/lib/seo/security-txt.ts`), zero drugiego literału,
 *     który rozjechałby się przy pierwszym odświeżeniu `Expires`.
 * Pola same w sobie (dokładny alias kontaktu, data w przyszłości, Canonical)
 * pilnuje suita źródła po stronie storefrontu — nie dublujemy jej tutaj.
 */
import { describe, expect, it } from "vitest";

import { GET as panelGet } from "../app/.well-known/security.txt/route";
// ŹRÓDŁO treści (nie trasa storefrontu — jej import `@/…` należy do aliasów
// tamtej aplikacji; że trasa storefrontu renderuje z tego samego źródła,
// dowodzi jej własna suita apps/storefront/test/security-txt.test.ts).
import {
  renderSecurityTxt,
  SECURITY_TXT_CONTACT,
} from "../../storefront/lib/seo/security-txt";

describe("GET /.well-known/security.txt (panel)", () => {
  it("zwraca 200 z text/plain; charset=utf-8", async () => {
    const response = await panelGet();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("niesie komplet pól RFC 9116 z jednego źródła treści", async () => {
    const body = await (await panelGet()).text();
    expect(body).toContain(`Contact: mailto:${SECURITY_TXT_CONTACT}`);
    expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
    expect(body).toContain("Preferred-Languages: pl, en");
    expect(body).toMatch(/^Canonical: https:\/\/www\.avably\.io\/\.well-known\/security\.txt$/m);
  });

  it("treść panelu = render wspólnego źródła co do znaku (jedno źródło, zero dryfu)", async () => {
    const panelBody = await (await panelGet()).text();
    // Kontrola po pustym zbiorze: równość dwóch pustych ciał nic nie broni.
    expect(panelBody.length).toBeGreaterThan(0);
    expect(panelBody).toBe(renderSecurityTxt());
  });

  it("bez nagłówków CORS (zwykły plik tekstowy, nie API)", async () => {
    const response = await panelGet();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
