/**
 * Prymityw podpisu Standard Webhooks (ADR-048) — na FIXTURACH, zero sieci.
 *
 * Wektor budujemy własnym `signStandardWebhook`, więc test sam z siebie nie
 * dowodzi zgodności ze schematem — dowodzi jej DOSŁOWNY, sprawdzony wektor
 * niżej („zgodność ze specyfikacją"), policzony poza tym kodem.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  signStandardWebhook,
  verifyStandardWebhook,
} from "@/lib/standard-webhook";

const SECRET = "v1,whsec_c3VwZXItdGFqbnktc2VrcmV0LWhvb2th";
const NOW = new Date("2026-07-20T10:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));
const PAYLOAD = '{"user":{"email":"nowy@example.com"}}';

function headersOf(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

function signedHeaders(overrides: Partial<Record<string, string>> = {}): Headers {
  const signature = signStandardWebhook({
    secret: SECRET,
    id: "msg_1",
    timestamp: TIMESTAMP,
    payload: PAYLOAD,
  });
  return headersOf({
    "webhook-id": "msg_1",
    "webhook-timestamp": TIMESTAMP,
    "webhook-signature": `v1,${signature}`,
    ...overrides,
  });
}

describe("verifyStandardWebhook", () => {
  it("przyjmuje poprawnie podpisane żądanie", () => {
    const result = verifyStandardWebhook({
      secret: SECRET,
      headers: signedHeaders(),
      payload: PAYLOAD,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("zgodność ze specyfikacją: podpisywana treść to id.timestamp.body", () => {
    // Wektor policzony NIEZALEŻNIE od implementacji — wprost z definicji
    // schematu (HMAC-SHA256 z base64-dekodowanego sekretu, wynik base64).
    // Gdyby implementacja podpisywała samo ciało albo inną kolejność pól,
    // ten test by padł, a wszystkie pozostałe nadal by przechodziły.
    const key = Buffer.from("c3VwZXItdGFqbnktc2VrcmV0LWhvb2th", "base64");
    const expected = createHmac("sha256", key)
      .update(`msg_1.${TIMESTAMP}.${PAYLOAD}`)
      .digest("base64");
    expect(signStandardWebhook({ secret: SECRET, id: "msg_1", timestamp: TIMESTAMP, payload: PAYLOAD })).toBe(
      expected,
    );
  });

  it("odrzuca brak sekretu — bez konfiguracji nie ma zaufanego żądania", () => {
    const result = verifyStandardWebhook({
      secret: undefined,
      headers: signedHeaders(),
      payload: PAYLOAD,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "secret_not_configured" });
  });

  it("odrzuca podpis policzony innym sekretem", () => {
    const foreign = signStandardWebhook({
      secret: "v1,whsec_aW5ueS1zZWtyZXQtbmFwYXN0bmlrYQ==",
      id: "msg_1",
      timestamp: TIMESTAMP,
      payload: PAYLOAD,
    });
    const result = verifyStandardWebhook({
      secret: SECRET,
      headers: signedHeaders({ "webhook-signature": `v1,${foreign}` }),
      payload: PAYLOAD,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "signature_mismatch" });
  });

  it("odrzuca podmienione ciało przy poprawnym nagłówku podpisu", () => {
    const result = verifyStandardWebhook({
      secret: SECRET,
      headers: signedHeaders(),
      payload: '{"user":{"email":"napastnik@example.com"}}',
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "signature_mismatch" });
  });

  it.each(["webhook-id", "webhook-timestamp", "webhook-signature"])(
    "odrzuca żądanie bez nagłówka %s",
    (missing) => {
      const headers = signedHeaders();
      headers.delete(missing);
      const result = verifyStandardWebhook({ secret: SECRET, headers, payload: PAYLOAD, now: NOW });
      expect(result).toMatchObject({ ok: false, reason: "missing_headers" });
    },
  );

  it("odrzuca podpis bez rozpoznanej wersji — brak v1 nie jest „na wszelki wypadek” dobry", () => {
    const signature = signStandardWebhook({
      secret: SECRET,
      id: "msg_1",
      timestamp: TIMESTAMP,
      payload: PAYLOAD,
    });
    const result = verifyStandardWebhook({
      secret: SECRET,
      headers: signedHeaders({ "webhook-signature": signature }),
      payload: PAYLOAD,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "signature_mismatch" });
  });

  it("przyjmuje listę podpisów, gdy pasuje choć jeden (rotacja sekretu)", () => {
    const good = signStandardWebhook({
      secret: SECRET,
      id: "msg_1",
      timestamp: TIMESTAMP,
      payload: PAYLOAD,
    });
    const result = verifyStandardWebhook({
      secret: SECRET,
      headers: signedHeaders({ "webhook-signature": `v1,cGFwa2E= v1,${good}` }),
      payload: PAYLOAD,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("odrzuca żądanie spoza okna czasowego (replay)", () => {
    const stale = new Date(NOW.getTime() + (WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 60) * 1000);
    const result = verifyStandardWebhook({
      secret: SECRET,
      headers: signedHeaders(),
      payload: PAYLOAD,
      now: stale,
    });
    expect(result).toMatchObject({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("znosi sekret bez prefiksu v1, (sama postać whsec_)", () => {
    const bare = "whsec_c3VwZXItdGFqbnktc2VrcmV0LWhvb2th";
    const result = verifyStandardWebhook({
      secret: bare,
      headers: signedHeaders(),
      payload: PAYLOAD,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });
});
