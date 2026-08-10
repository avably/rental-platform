/**
 * Bilet checkoutu (R13/H-02, ADR-125) — strona WYSTAWIAJĄCA.
 *
 * Wzorzec 1:1 z test/contact-ticket.test.ts: czysta krypto, bez Supabase i bez
 * `process.env` — `now`, `nonce` i `secret` wstrzykiwane jawnie, żeby nic nie
 * zależało od zegara systemowego ani od konfiguracji maszyny.
 *
 * ==================== WEKTOR WZORCOWY ====================
 *
 * Ta suita pilnuje POŁOWY kontraktu: że Node produkuje dokładnie ten podpis.
 * Drugą połowę — że baza akceptuje dokładnie ten podpis — pilnuje
 * `packages/db/test/checkout-ticket.test.ts`. Obie trzymają TE SAME literały
 * (tenant, exp, nonce, sekret, podpis), więc jednostronna zmiana kanonizacji
 * (kolejność pól, separator, wielkość liter tenanta, hex vs base64) zapala
 * jedną z nich. Rozjazd Node↔SQL nie jest tu ryzykiem teoretycznym: to jedyna
 * rzecz, która w tym mechanizmie może wywrócić sprzedaż zamiast ją chronić.
 *
 * Wektor odtwarzalny z linii poleceń:
 *   psql> select encode(extensions.hmac(
 *           '11111111-1111-4111-8111-111111111111.2000000000.abc123',
 *           'test-secret-000000000000000000000000', 'sha256'), 'hex');
 */
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CHECKOUT_TICKET_TTL_SECONDS,
  checkoutTicketMessage,
  issueCheckoutTicket,
} from "@/lib/checkout/ticket";

/** Wektor wzorcowy — te same literały co w packages/db/test/checkout-ticket.test.ts. */
const VECTOR = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  exp: 2_000_000_000,
  nonce: "abc123",
  secret: "test-secret-000000000000000000000000",
  sig: "1497a45f52997a0249184349e1bca0c24bb320b8ec9802329a1bfe354e178aca",
} as const;

/** Chwila, w której `issueCheckoutTicket` wystawi bilet z dokładnie VECTOR.exp. */
const NOW_MS = (VECTOR.exp - CHECKOUT_TICKET_TTL_SECONDS) * 1000;

describe("issueCheckoutTicket — z sekretem", () => {
  it("wektor wzorcowy: podpis co do znaku taki, jaki liczy baza (0059)", () => {
    const ticket = issueCheckoutTicket(VECTOR.tenantId, {
      now: NOW_MS,
      nonce: VECTOR.nonce,
      secret: VECTOR.secret,
    });

    expect(ticket.exp).toBe(VECTOR.exp);
    expect(ticket.nonce).toBe(VECTOR.nonce);
    // DOWÓD MUTACYJNY: zmiana kanonizacji w checkoutTicketMessage (inny
    // separator, odwrócona kolejność pól, base64url zamiast hex) zmienia tę
    // wartość i pali ten assert — a w produkcji objawiłaby się odrzuceniem
    // KAŻDEGO checkoutu przez bazę.
    expect(ticket.sig).toBe(VECTOR.sig);
  });

  it("komunikat jest kanonizowany: tenant małymi literami, pola rozdzielone kropką", () => {
    expect(checkoutTicketMessage("ABC-DEF", 123, "nonce")).toBe("abc-def.123.nonce");
    // Wielkość liter tenanta NIE MOŻE zmieniać podpisu: Postgres wypisuje
    // uuid::text małymi literami, a nagłówek middleware'u niesie zwykły string.
    expect(
      issueCheckoutTicket(VECTOR.tenantId.toUpperCase(), {
        now: NOW_MS,
        nonce: VECTOR.nonce,
        secret: VECTOR.secret,
      }).sig,
    ).toBe(VECTOR.sig);
  });

  it("termin ważności to 15 minut od chwili wystawienia (bilet bity przy WYSYŁCE)", () => {
    const ticket = issueCheckoutTicket(VECTOR.tenantId, {
      now: 1_700_000_000_000,
      secret: VECTOR.secret,
    });
    expect(ticket.exp).toBe(1_700_000_000 + CHECKOUT_TICKET_TTL_SECONDS);
  });

  it("bilet WIĄŻE TENANTA: ten sam exp i nonce dla innego sklepu dają inny podpis", () => {
    const a = issueCheckoutTicket("11111111-1111-4111-8111-111111111111", {
      now: NOW_MS,
      nonce: VECTOR.nonce,
      secret: VECTOR.secret,
    });
    const b = issueCheckoutTicket("22222222-2222-4222-8222-222222222222", {
      now: NOW_MS,
      nonce: VECTOR.nonce,
      secret: VECTOR.secret,
    });
    // Sedno izolacji: bilet wystawiony dla sklepu A nie ma prawa otworzyć
    // zapisu w sklepie B. Bazę o tym samym przekonuje test cross-tenant.
    expect(a.sig).not.toBe(b.sig);
  });

  it("nonce jest losowy i niepowtarzalny (128 bitów hex)", () => {
    const wydane = new Set(
      Array.from({ length: 200 }, () =>
        issueCheckoutTicket(VECTOR.tenantId, { secret: VECTOR.secret }).nonce,
      ),
    );
    expect(wydane.size, "nonce się powtórzył — odrzuciłby uczciwego klienta").toBe(200);
    for (const nonce of wydane) expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("inny sekret = inny podpis (podpis naprawdę zależy od klucza)", () => {
    const podrobiony = issueCheckoutTicket(VECTOR.tenantId, {
      now: NOW_MS,
      nonce: VECTOR.nonce,
      secret: "inny-sekret-0000000000000000000000000",
    });
    expect(podrobiony.sig).not.toBe(VECTOR.sig);
  });

  it("podpis pokrywa WSZYSTKIE trzy pola — podmiana każdego z osobna go unieważnia", () => {
    const sign = (msg: string) => createHmac("sha256", VECTOR.secret).update(msg).digest("hex");
    // Gdyby kanonizacja pomijała exp albo nonce, któraś z tych wartości
    // zrównałaby się z wektorem — i bilet dałoby się „przedłużyć" bez sekretu.
    expect(sign(checkoutTicketMessage(VECTOR.tenantId, VECTOR.exp + 1, VECTOR.nonce))).not.toBe(
      VECTOR.sig,
    );
    expect(sign(checkoutTicketMessage(VECTOR.tenantId, VECTOR.exp, "inny-nonce"))).not.toBe(
      VECTOR.sig,
    );
  });
});

describe("issueCheckoutTicket — bez sekretu (dev-skip)", () => {
  it("wystawia bilet PUSTY zamiast rzucać (dev i CI mają mieć checkout działający)", () => {
    // Jawne `undefined` NIE MOŻE spaść na env procesu — wzorzec `in`-owy
    // z verifyTurnstile; inaczej ta suita zależałaby od konfiguracji maszyny.
    const ticket = issueCheckoutTicket(VECTOR.tenantId, { secret: undefined, now: NOW_MS });
    const pustySekret = issueCheckoutTicket(VECTOR.tenantId, { secret: "", now: NOW_MS });

    for (const t of [ticket, pustySekret]) {
      expect(t.exp).toBeNull();
      expect(t.nonce).toBeNull();
      expect(t.sig).toBeNull();
    }
  });
});
