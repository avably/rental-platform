/**
 * Test uruchomieniowy waitlisty na ŻYWYM Supabase — rdzeń akcji + RPC + baza.
 *
 * Testy w waitlist-core.test.ts sprawdzają kontrakt na podstawionych
 * zależnościach, więc same w sobie nie dowodzą, że wiersz w ogóle powstaje:
 * atrapa `callRpc` zwracająca "success" przeszłaby je również wtedy, gdyby
 * migracja 0006 nie istniała. Tutaj `callRpc` uderza w prawdziwe PostgREST
 * kluczem anon — dokładnie tak, jak owijka „use server".
 *
 * Poza zasięgiem zostaje wyłącznie `next/headers` (IP) — reszta ścieżki jest
 * prawdziwa.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_API_URL /
 * SUPABASE_LOCAL_ANON_KEY / SUPABASE_LOCAL_SERVICE_ROLE_KEY (patrz
 * docs/konwencje-migracji.md). Bez nich cały plik jest pomijany — w CI
 * uruchamia go job `rls`, który ma Supabase.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";

import { joinWaitlistCore, type WaitlistDeps, type WaitlistRpcOutcome } from "@/lib/waitlist/core";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

function client(key: string): SupabaseClient {
  return createClient(process.env.SUPABASE_LOCAL_API_URL as string, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const anonClient = () => client(process.env.SUPABASE_LOCAL_ANON_KEY as string);
const adminClient = () => client(process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY as string);

/** Zależności produkcyjne minus `next/headers`: RPC idzie kluczem anon. */
function liveDeps(overrides: Partial<WaitlistDeps> = {}): WaitlistDeps {
  return {
    enabled: true,
    ip: `test-${randomUUID()}`,
    checkRateLimit: async () => ({ success: true }),
    callRpc: async (args): Promise<WaitlistRpcOutcome> => {
      const { data, error } = await anonClient().schema("app").rpc("join_waitlist", args);
      if (error) throw new Error(error.message);
      return data === "duplicate" ? "duplicate" : "success";
    },
    ...overrides,
  };
}

describe.skipIf(!hasEnv)("waitlista na żywym Supabase", () => {
  const seededEmails: string[] = [];

  function freshEmail(): string {
    const email = `wl-${randomUUID()}@test.local`;
    seededEmails.push(email);
    return email;
  }

  afterEach(async () => {
    const admin = adminClient();
    for (const email of seededEmails.splice(0)) {
      await admin.from("waitlist_signups").delete().ilike("email", email);
    }
  });

  it("zapis przez akcję tworzy wiersz z poprawnymi wartościami", async () => {
    const email = freshEmail();

    const result = await joinWaitlistCore(
      {
        email,
        rentalType: "other",
        otherEquipment: "  rusztowania i szalunki  ",
        inventoryRange: "r101_500",
        currentProcess: "messages_phone",
        consent: true,
        pilotInterest: true,
        phone: "600100200",
        locale: "en",
        source: "newsletter",
        campaign: "launch",
      },
      liveDeps(),
    );

    expect(result).toEqual({ status: "success" });

    const { data, error } = await adminClient()
      .from("waitlist_signups")
      .select("*")
      .ilike("email", email);
    expect(error, `odczyt service-role: ${error?.message}`).toBeNull();
    expect(data ?? [], "akcja zwróciła success, ale wiersza nie ma w bazie").toHaveLength(1);

    const row = (data ?? [])[0] as Record<string, unknown>;
    expect(row.email).toBe(email.toLowerCase());
    expect(row.rental_type).toBe("other");
    expect(row.other_equipment, "doprecyzowanie nie zostało przycięte").toBe("rusztowania i szalunki");
    expect(row.inventory_range).toBe("r101_500");
    expect(row.current_process).toBe("messages_phone");
    expect(row.pilot_interest).toBe(true);
    expect(row.phone).toBe("600100200");
    expect(row.locale).toBe("en");
    expect(row.source).toBe("newsletter");
    expect(row.campaign).toBe("launch");
    // consent_at ustawia serwer (nie klient) — wiersz bez zgody jest
    // niereprezentowalny, bo kolumna jest NOT NULL.
    expect(row.consent_at, "consent_at nie został zapisany").not.toBeNull();
    expect(row.created_at).not.toBeNull();
  });

  it("ten sam e-mail innym casingiem → duplicate, wierszy nadal 1", async () => {
    const email = freshEmail();
    const input = {
      email,
      rentalType: "event",
      inventoryRange: "r1_20",
      currentProcess: "none",
      consent: true,
    } as const;

    expect(await joinWaitlistCore(input, liveDeps())).toEqual({ status: "success" });

    const upper = { ...input, email: email.toUpperCase() };
    expect(
      await joinWaitlistCore(upper, liveDeps()),
      "deduplikacja nie złapała różnicy wielkości liter",
    ).toEqual({ status: "duplicate" });

    const { data } = await adminClient().from("waitlist_signups").select("id").ilike("email", email);
    expect(data ?? [], "duplikat mimo wszystko utworzył drugi wiersz").toHaveLength(1);
  });

  it("wyłączony kill-switch nie tworzy wiersza mimo poprawnego wejścia", async () => {
    const email = freshEmail();

    const result = await joinWaitlistCore(
      { email, rentalType: "event", inventoryRange: "r1_20", currentProcess: "none", consent: true },
      liveDeps({ enabled: false }),
    );

    expect(result).toEqual({ status: "disabled" });
    const { data } = await adminClient().from("waitlist_signups").select("id").ilike("email", email);
    expect(data ?? [], "wyłączony formularz zapisał wiersz — bramka prawna nieszczelna").toHaveLength(
      0,
    );
  });

  it("brak zgody nie tworzy wiersza", async () => {
    const email = freshEmail();

    const result = await joinWaitlistCore(
      { email, rentalType: "event", inventoryRange: "r1_20", currentProcess: "none", consent: false },
      liveDeps(),
    );

    expect(result.status).toBe("validation_error");
    const { data } = await adminClient().from("waitlist_signups").select("id").ilike("email", email);
    expect(data ?? [], "zapis bez zgody trafił do bazy").toHaveLength(0);
  });

  it("RPC odrzuca zapis bez zgody także wywołane z pominięciem walidacji akcji", async () => {
    // Dowód, że zgoda jest bramką BAZY, nie tylko schematu Zoda: RPC wołane
    // wprost (jak zrobiłby to ktoś z kluczem anon i curlem) musi odmówić.
    const email = freshEmail();
    const { error } = await anonClient().schema("app").rpc("join_waitlist", {
      p_email: email,
      p_rental_type: "event",
      p_inventory_range: "r1_20",
      p_current_process: "none",
      p_consent: false,
    });

    expect(error, "RPC przyjęło zapis bez zgody").not.toBeNull();

    const { data } = await adminClient().from("waitlist_signups").select("id").ilike("email", email);
    expect(data ?? []).toHaveLength(0);
  });

  it("RPC odrzuca telefon bez zgłoszenia do pilotażu (bramka bazy, nie tylko Zoda)", async () => {
    const email = freshEmail();
    const { error } = await anonClient().schema("app").rpc("join_waitlist", {
      p_email: email,
      p_rental_type: "event",
      p_inventory_range: "r1_20",
      p_current_process: "none",
      p_consent: true,
      p_pilot_interest: false,
      p_phone: "600100200",
    });

    expect(error, "RPC zapisało telefon bez podstawy (pilotaż)").not.toBeNull();

    const { data } = await adminClient().from("waitlist_signups").select("id").ilike("email", email);
    expect(data ?? []).toHaveLength(0);
  });
});
