/**
 * Dziennik kont — warstwa INTEGRACYJNA na żywym, lokalnym Supabase (ADR-054).
 *
 * Różnica wobec account-email-hook.test.ts (atrapa sinka): tutaj hook pisze
 * PRAWDZIWYM sinkiem service-role do public.account_email_logs, a asercje
 * czytają WIERSZ Z BAZY — brief wymaga, by dowód porażki patrzył na bazę, nie
 * na wynik funkcji. Ścieżka zapisu jest ta sama, co produkcyjna (serviceRoleLogSink),
 * różni się tylko klient (klucz lokalny zamiast produkcyjnego).
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — bez
 * nich suita jest jawnie pomijana (integrationEnv).
 */
import { createHmac } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { EmailTransport, OutgoingEmail } from "@avably/core";

import { handleSendEmailHook, hashRecipient, serviceRoleLogSink } from "@/lib/account-email-hook";
import { signStandardWebhook } from "@/lib/standard-webhook";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const SECRET = "v1,whsec_c3VwZXItdGFqbnktc2VrcmV0LWhvb2th";
const NOW = new Date("2026-07-20T10:00:00.000Z");
const TOKEN_HASH = "7d5b7b1964cf5d388340a7f04f1dbb5eeb6c7b52ef8270e1737a58d0";
const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function payload(email: string, action = "signup") {
  return {
    user: { email, user_metadata: { locale: "en" } },
    email_data: {
      token: "305805",
      token_hash: TOKEN_HASH,
      redirect_to: "http://127.0.0.1:3000/",
      email_action_type: action,
      site_url: "http://127.0.0.1:3000",
    },
  };
}

function hookRequest(body: unknown): Request {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(NOW.getTime() / 1000));
  const signature = `v1,${signStandardWebhook({ secret: SECRET, id: "msg_1", timestamp, payload: raw })}`;
  return new Request("https://app.avably.io/api/webhooks/supabase-email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": "msg_1",
      "webhook-timestamp": timestamp,
      "webhook-signature": signature,
    },
    body: raw,
  });
}

const captureTransport: EmailTransport = {
  send: async () => ({ id: "resend-ok" }),
};
const failingTransport: EmailTransport = {
  send: async () => {
    throw new Error("Wysyłka e-maili nie jest skonfigurowana (brak RESEND_API_KEY).");
  },
};
/** Transport, którego błąd CELOWO niesie adres odbiorcy — wektor wycieku PII. */
function leakyTransport(): EmailTransport {
  return {
    send: async (email: OutgoingEmail) => {
      throw new Error(`Provider 422: odbiorca ${email.to} odrzucony przy token_hash=${TOKEN_HASH}`);
    },
  };
}

describe.skipIf(!hasEnv)("dziennik kont — zapis i odczyt na żywym Supabase (ADR-054)", () => {
  let admin: SupabaseClient;
  let sink: ReturnType<typeof serviceRoleLogSink>;
  const usedHashes: string[] = [];

  /** Świeży adres per przypadek — izolacja od równoległych sesji na wspólnej bazie. */
  function freshEmail(label: string): string {
    const email = `acct-log-${label}-${Math.random().toString(36).slice(2)}@test.local`;
    usedHashes.push(hashRecipient(email, SECRET));
    return email;
  }

  async function rowsFor(email: string) {
    const { data, error } = await admin
      .from("account_email_logs")
      .select("*")
      .eq("recipient_hash", hashRecipient(email, SECRET));
    if (error) throw new Error(`Odczyt account_email_logs: ${error.message}`);
    return data ?? [];
  }

  beforeAll(() => {
    admin = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...realtimeTransport,
    });
    sink = serviceRoleLogSink(admin);
  });

  afterEach(async () => {
    // Sprzątamy WYŁĄCZNIE własne wiersze (po hashu naszych losowych adresów) —
    // wspólna baza, cudzych danych nie ruszamy.
    for (const hash of usedHashes.splice(0)) {
      await admin.from("account_email_logs").delete().eq("recipient_hash", hash);
    }
  });

  afterAll(async () => {
    await admin.auth.stopAutoRefresh?.();
  });

  it("KONTROLA POZYTYWNA (c): udana wysyłka → w BAZIE wiersz sent, bez powodu", async () => {
    const email = freshEmail("ok");
    const response = await handleSendEmailHook(hookRequest(payload(email)), {
      secret: SECRET,
      transport: captureTransport,
      logSink: sink,
      now: NOW,
    });
    expect(response.status).toBe(200);

    const rows = await rowsFor(email);
    expect(rows, "brak wiersza dziennika po udanej wysyłce").toHaveLength(1);
    expect(rows[0]!.action).toBe("signup");
    expect(rows[0]!.status).toBe("sent");
    expect(rows[0]!.reason).toBeNull();
  });

  it("PORAŻKA (a): nieudana wysyłka → w BAZIE wiersz failed z powodem", async () => {
    const email = freshEmail("fail");
    const response = await handleSendEmailHook(hookRequest(payload(email)), {
      secret: SECRET,
      transport: failingTransport,
      logSink: sink,
      now: NOW,
    });
    expect(response.status).toBe(500);

    // ASERCJA CZYTA BAZĘ, nie wynik funkcji.
    const rows = await rowsFor(email);
    expect(rows, "porażka wysyłki nie zostawiła wiersza failed w bazie").toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(String(rows[0]!.reason)).toContain("RESEND_API_KEY");
  });

  it("PRYWATNOŚĆ (b): wiersz w bazie nie niesie adresu ani tokenu — także po dekodowaniu hasha", async () => {
    const email = freshEmail("privacy");
    await handleSendEmailHook(hookRequest(payload(email)), {
      secret: SECRET,
      transport: leakyTransport(),
      logSink: sink,
      now: NOW,
    });

    const rows = await rowsFor(email);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    // Cały wiersz (serializacja) nie zawiera adresu jawnego ani tokenu.
    const serialized = JSON.stringify(row);
    expect(serialized, "adres jawny wyciekł do wiersza").not.toContain(email);
    expect(serialized, "token_hash wyciekł do wiersza").not.toContain(TOKEN_HASH);
    expect(serialized).not.toContain("305805");

    // Kontrola na FAŁSZYWY ZIELONY (lekcja PR #75): recipient_hash to nie
    // zakodowany adres — dekodujemy hex i sprawdzamy zdekodowaną postać.
    const hashHex = String(row.recipient_hash);
    expect(hashHex).toMatch(/^[0-9a-f]{64}$/);
    const bytes = Buffer.from(hashHex, "hex");
    for (const form of [bytes.toString("latin1"), bytes.toString("utf8"), bytes.toString("base64")]) {
      expect(form, "adres odtwarzalny ze zdekodowanego hasha").not.toContain(email);
      expect(form).not.toContain(email.split("@")[0]!); // nawet część lokalna
    }
    // Hash jest DOKŁADNIE tym, czego oczekuje model prywatności (HMAC/sekret).
    expect(hashHex).toBe(
      createHmac("sha256", SECRET).update(`account-email-log:v1:${email}`).digest("hex"),
    );
    // Powód porażki został zsanityzowany, ale diagnoza przetrwała.
    expect(String(row.reason)).not.toContain(email);
    expect(String(row.reason)).toContain("Provider 422");
  });
});
