/**
 * Bramka slugów zarezerwowanych w `app.create_tenant` (migracja 0023).
 *
 * KONTEKST. Routing storefrontu odrzuca hosty platformy od 2.1 (ADR-039:
 * `classifyHost` kieruje `app.avably.io` w gałąź marketingową), ale ZAKŁADANIE
 * organizacji nie broniło się przed niczym. Najemca mógł wziąć slug `app`,
 * `www` czy `admin` i dostać sklep, którego jego własny adres NIGDY nie
 * otworzy — a od 2.6 dodatkowo wiersz w `public.domains` i próbę rejestracji
 * globalnie unikalnego hosta u dostawcy (0022).
 *
 * Ten plik dowodzi trzech rzeczy:
 *   1. slug zarezerwowany jest ODRZUCANY, i to konkretnym SQLSTATE 22023
 *      (konwencja 0010/0011/0020 — PostgREST mapuje to na 400; asercja na
 *      KODZIE, nie na „cokolwiek rzuciło": literówka w nazwie funkcji dałaby
 *      42883 i świeciłaby na zielono),
 *   2. LISTY SIĘ NIE ROZJEŻDŻAJĄ — zbiór z `app.reserved_subdomains()` jest
 *      równy RESERVED_SUBDOMAINS z @avably/core. To jest właściwa bramka tego
 *      zadania: gdyby zbiory się rozjechały, host byłby zarezerwowany po
 *      jednej stronie i wolny po drugiej, czyli luka wracałaby tylnymi drzwiami
 *      (wzorzec „lustro CHECK↔TS" z order-gates/email-sender),
 *   3. KONTROLA POZYTYWNA — zwykły slug nadal przechodzi i nadal dostaje wiersz
 *      subdomeny z 0022. Bez niej „wszystko odrzucone" wyglądałoby jak sukces.
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (patrz
 * helpers/integration-env.ts). Bez nich plik jest pomijany JAWNIE.
 */
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";

import { RESERVED_SUBDOMAINS } from "@avably/core";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "ReservedSlugTest!12345678";
const createdUserIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const sql = hasEnv ? postgres(env("SUPABASE_LOCAL_URL"), { max: 1 }) : null;

function createAdminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

function createAnonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

/** Świeży, potwierdzony użytkownik — każdy test dostaje własnego (limit 2 org/user). */
async function signedInUser(admin: SupabaseClient): Promise<SupabaseClient> {
  const email = `reserved-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  createdUserIds.push(data.user.id);

  const client = createAnonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);
  return client;
}

describe.skipIf(!hasEnv)("slugi zarezerwowane — app.create_tenant (0023)", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);
  const createdTenantIds: string[] = [];

  afterAll(async () => {
    if (!hasEnv) return;
    // Sprzątamy po ORGANIZACJACH założonych przez testowych userów, a nie po
    // liście zebranej ręcznie: baza jest współdzielona z innymi sesjami, więc
    // każdy wiersz zostawiony tutaj myli następną. Kasowanie idzie po
    // członkostwie, żeby złapać też organizacje z asercji, które padły.
    if (createdUserIds.length > 0) {
      const rows = await sql!<{ tenant_id: string }[]>`
        select distinct tenant_id from public.members where user_id = any(${sql!.array(createdUserIds)}::uuid[])
      `;
      for (const id of [...new Set([...createdTenantIds, ...rows.map((r) => r.tenant_id)])]) {
        await admin.from("tenants").delete().eq("id", id);
      }
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
    await sql?.end({ timeout: 5 });
  });

  describe("zgodność list (anty-rozjazd)", () => {
    it("app.reserved_subdomains() == RESERVED_SUBDOMAINS z @avably/core", async () => {
      const rows = await sql!<{ reserved: string[] }[]>`
        select app.reserved_subdomains() as reserved
      `;
      const fromDb = [...rows[0]!.reserved].sort();
      const fromCore = [...RESERVED_SUBDOMAINS].sort();

      expect(
        fromDb,
        "lista w migracji 0023 rozjechała się z RESERVED_SUBDOMAINS (packages/core/src/brand.ts)",
      ).toEqual(fromCore);
    });
  });

  describe("odmowa", () => {
    it.each(["app", "www", "admin", "send"])(
      "slug `%s` jest odrzucony kodem 22023",
      async (slug) => {
        const client = await signedInUser(admin);

        const { error } = await rpcCreateTenant(client, {
          p_slug: slug,
          p_name: `Próba ${slug}`,
        });

        expect(error, `slug \`${slug}\` przeszedł, a jest zarezerwowany`).not.toBeNull();
        expect(error!.code, `oczekiwany SQLSTATE 22023, dostałem ${error!.code}`).toBe("22023");
      },
    );

    it("odrzucenie nie zostawia ani organizacji, ani wiersza domeny", async () => {
      const client = await signedInUser(admin);
      const userId = createdUserIds.at(-1)!;

      // Stan PRZED liczony w tej samej transakcji myślowej co po: baza jest
      // współdzielona między sesjami, więc asercja „zero wierszy o tym slugu"
      // w skali całej tabeli mierzyłaby cudzą pracę, nie tę odmowę.
      const before = await sql!<{ c: number }[]>`
        select count(*)::int as c from public.domains where domain = 'api.avably.io'
      `;

      await rpcCreateTenant(client, { p_slug: "api", p_name: "Próba api" });

      const members = await sql!`select tenant_id from public.members where user_id = ${userId}`;
      const after = await sql!<{ c: number }[]>`
        select count(*)::int as c from public.domains where domain = 'api.avably.io'
      `;

      expect(members, "odmowa zostawiła po sobie organizację").toHaveLength(0);
      expect(after[0]!.c, "odmowa zarezerwowała host u dostawcy").toBe(before[0]!.c);
    });

    it("KAŻDY wpis z listy jest odrzucany (nie tylko kilka wybranych)", async () => {
      // Sprawdzane bezpośrednio na warunku bramki, bez zakładania kilkunastu
      // organizacji: to samo wyrażenie, którego używa create_tenant.
      const rows = await sql!<{ slug: string; blocked: boolean }[]>`
        select s.slug, lower(btrim(s.slug)) = any (app.reserved_subdomains()) as blocked
        from unnest(${sql!.array([...RESERVED_SUBDOMAINS])}::text[]) as s(slug)
      `;
      const passing = rows.filter((row) => !row.blocked).map((row) => row.slug);
      expect(passing, `slugi przepuszczone mimo rezerwacji: ${passing.join(", ")}`).toEqual([]);
    });
  });

  describe("kontrola pozytywna", () => {
    it("zwykły slug przechodzi i dostaje wiersz subdomeny (0022 nietknięte)", async () => {
      const client = await signedInUser(admin);
      const slug = `wolny-${randomUUID()}`.slice(0, 39);

      const { data: tenantId, error } = await rpcCreateTenant(client, {
        p_slug: slug,
        p_name: "Wypożyczalnia testowa",
      });

      expect(error, `zwykły slug został odrzucony: ${error?.message}`).toBeNull();
      expect(tenantId).toBeTruthy();
      createdTenantIds.push(tenantId as string);

      const domains = await sql!`
        select domain, verified from public.domains where tenant_id = ${tenantId as string}
      `;
      expect(domains).toHaveLength(1);
      expect(domains[0]!.domain).toBe(`${slug}.avably.io`);
    });

    it("slug ZAWIERAJĄCY zarezerwowany wyraz przechodzi (bramka jest na równość)", async () => {
      const client = await signedInUser(admin);
      const slug = `app-serwis-${randomUUID()}`.slice(0, 39);

      const { data: tenantId, error } = await rpcCreateTenant(client, {
        p_slug: slug,
        p_name: "Serwis aplikacji",
      });

      expect(error, `slug \`${slug}\` nie jest zarezerwowany, a został odrzucony`).toBeNull();
      createdTenantIds.push(tenantId as string);
    });
  });
});
