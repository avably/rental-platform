/**
 * Treść wiadomości w historii wysyłek (0035, ADR-073) — wektory, których nie
 * pokrywa ani macierz izolacji (rls-isolation.test.ts), ani testy 0021
 * (email-logs.test.ts):
 *
 *   (a) KOLUMNA ISTNIEJE I JEST NULLABLE: wiersz sprzed 0035 zostaje bez
 *       treści i MUSI dać się zapisać dalej. Kolumna `not null` albo
 *       `default ''` zamieniłaby „nie mamy treści" w „klient dostał pustą
 *       wiadomość" — czyli w rejestrze pojawiłaby się nieprawda.
 *
 *   (b) `email_log_has_body` ODRÓŻNIA trzy stany, które łatwo skleić: brak
 *       treści (NULL), treść pozorną (same białe znaki) i treść realną.
 *       Sklejenie dwóch pierwszych z trzecim daje na ekranie przycisk
 *       „Podgląd treści" otwierający puste okno.
 *
 *   (c) IZOLACJA obejmuje treść tak samo jak resztę wiersza: sąsiad nie
 *       czyta cudzego `body` ani wprost, ani przez funkcję wyliczaną.
 *       To jest ten sam wektor co przy `recipient`, ale z ładunkiem, który
 *       niesie CAŁĄ korespondencję z klientem.
 *
 *   (d) APPEND-ONLY OBEJMUJE TREŚĆ: członek tenanta nie podmienia `body`
 *       po fakcie. Rejestr, w którym da się przepisać to, co wyszło do
 *       klienta, przestaje być dowodem — a dowodem miał być od 0021.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const HTML = "<html><body><p>Rezerwacja AV-TEST-0035 potwierdzona.</p></body></html>";

let admin: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;

/** Wpis historii bez zamówienia (order_id nullable od 0021) — wystarcza. */
async function insertLog(
  client: SupabaseClient,
  tenantId: string,
  body: string | null | undefined,
): Promise<string> {
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    kind: "invitation",
    recipient: `body-${randomUUID()}@test.local`,
    subject: "Zaproszenie do organizacji",
    status: "sent",
  };
  if (body !== undefined) row.body = body;

  const { data, error } = await client.from("email_logs").insert(row).select("id").single();
  if (error || !data) throw new Error(`Nie udało się zapisać wpisu: ${error?.message}`);
  return data.id as string;
}

describe.skipIf(!hasEnv)("email_logs.body — treść wysłanej wiadomości (0035)", () => {
  let withBody: string;
  let withoutBody: string;
  let whitespaceBody: string;

  beforeAll(async () => {
    admin = createAdminClient();
    ({ a, b } = await seedTwoTenants());

    withBody = await insertLog(a.ownerClient, a.tenantId, HTML);
    // Wpis „sprzed 0035": kolumny w ogóle nie podajemy.
    withoutBody = await insertLog(a.ownerClient, a.tenantId, undefined);
    whitespaceBody = await insertLog(a.ownerClient, a.tenantId, "   \n  ");
  });

  afterAll(async () => {
    await cleanupSeeded(admin);
  });

  it("(a) wpis bez treści zapisuje się i zostaje z NULL-em, nie z pustym napisem", async () => {
    const { data, error } = await a.ownerClient
      .from("email_logs")
      .select("body")
      .eq("id", withoutBody)
      .single();

    expect(error).toBeNull();
    // NULL, a nie "": różnica jest cała — pusty napis ekran pokazałby jako
    // pustą wiadomość wysłaną do klienta.
    expect(data?.body).toBeNull();
  });

  it("(a) treść wraca z bazy BAJT W BAJT (bez normalizacji i obcięcia)", async () => {
    const { data } = await a.ownerClient
      .from("email_logs")
      .select("body")
      .eq("id", withBody)
      .single();

    expect(data?.body).toBe(HTML);
  });

  it("(b) email_log_has_body odróżnia treść od jej braku i od białych znaków", async () => {
    const { data, error } = await a.ownerClient
      .from("email_logs")
      .select("id, hasBody:email_log_has_body")
      .in("id", [withBody, withoutBody, whitespaceBody]);

    expect(error).toBeNull();
    const flag = new Map((data ?? []).map((row) => [row.id as string, row.hasBody as boolean]));
    expect(flag.get(withBody)).toBe(true);
    expect(flag.get(withoutBody)).toBe(false);
    expect(flag.get(whitespaceBody)).toBe(false);
  });

  it("(c) sąsiad nie czyta cudzej treści ani przez kolumnę, ani przez funkcję", async () => {
    const direct = await b.ownerClient.from("email_logs").select("body").eq("id", withBody);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);

    const computed = await b.ownerClient
      .from("email_logs")
      .select("id, hasBody:email_log_has_body")
      .eq("id", withBody);
    expect(computed.error).toBeNull();
    // Zero wierszy, a nie „wiersz z hasBody=false": istnienie wpisu też jest
    // informacją o cudzym tenancie.
    expect(computed.data).toEqual([]);
  });

  it("(d) append-only obejmuje treść — członek nie przepisze wysłanej wiadomości", async () => {
    const { data, error } = await a.ownerClient
      .from("email_logs")
      .update({ body: "<html>podmienione</html>" })
      .eq("id", withBody)
      .select("id");

    // Brak polityki UPDATE = brak wierszy do zmiany (RLS jest fail-closed);
    // liczy się skutek, nie kod błędu.
    expect(data ?? []).toEqual([]);
    if (error) expect(error.code).toBe("42501");

    const after = await a.ownerClient.from("email_logs").select("body").eq("id", withBody).single();
    expect(after.data?.body).toBe(HTML);
  });
});
