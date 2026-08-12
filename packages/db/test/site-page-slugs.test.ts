/**
 * Adres strony najemcy — migracja 0073, ADR-157 (Faza 2 kreatora, krok 2.1).
 *
 * Pięć osi, każda z dowodem z OBU stron (jest / nie ma, sukces / odmowa):
 *
 *   1. ZGODNOŚĆ LIST (anty-rozjazd). `app.reserved_page_slugs()` jest równe
 *      RESERVED_PAGE_SLUGS z @avably/core/site. Bez tego lista byłaby pilnowana
 *      po jednej stronie i wolna po drugiej — dokładnie ta luka, którą 0023
 *      zamknęło dla subdomen, a 0072 dla kategorii.
 *
 *   2. SLUG ZAREZERWOWANY. Strona o slugu `checkout` (i każdym innym z listy)
 *      jest odrzucana PRZEZ BAZĘ, nie przez formularz — dowód idzie ścieżką
 *      `service_role`, czyli z BYPASSRLS i bez Zoda panelu. Kontrola pozytywna
 *      pilnuje, żeby „wszystko odrzucone" nie wyglądało jak sukces. Bramka
 *      NIE rusza wiersza, w którym slug się nie zmienia (rozstrzygnięcie 4).
 *
 *   3. KSZTAŁT ADRESU. CHECK `sites_slug_shape` jest lustrem PAGE_SLUG_PATTERN:
 *      wielkie litery, spacje, ogonki i ukośniki odpadają w bazie, nie tylko
 *      w przeglądarce.
 *
 *   4. ADRES JEST DANĄ PUBLICZNĄ. `slug_published` pisze WYŁĄCZNIE
 *      `app.publish_site` — członek dostaje 42501, a zmiana sluga w szkicu NIE
 *      przenosi żywej strony pod nowy adres, dopóki nie opublikuje.
 *
 *   5. UNIKAT PO ADRESIE. Dwie żywe strony pod TYM SAMYM slugiem są
 *      niereprezentowalne nawet rolą serwisową (23505 z
 *      `sites_live_slug_unique_idx`); pod RÓŻNYMI — reprezentowalne, i to jest
 *      cała różnica względem 0048.
 *
 * ZERO ZMIAN WIDOCZNYCH. Osobny blok mierzy KOPERTĘ `app.get_published_site`
 * przed i po publikacji: 0073 nie dokłada do niej ani jednego klucza (klucz
 * `slug` dochodzi dopiero w 0074, warunkowo — koperta storefrontu jest
 * `.strict()`, więc bezwarunkowy klucz wywróciłby sklep w oknie wdrożeniowym).
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — patrz
 * helpers/integration-env.ts. Bez nich plik jest pomijany JAWNIE.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HOME_PAGE_SLUG, RESERVED_PAGE_SLUGS } from "@avably/core/site";

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

/** 22023 = invalid_parameter_value — konwencja odmów 0010/0020/0023/0072. */
const PG_INVALID_PARAMETER = "22023";
/** 23505 = unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";
/** 23514 = check_violation. */
const PG_CHECK_VIOLATION = "23514";
/** 42501 = insufficient_privilege — odmowa RLS, grantu albo strażnika. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";

const TEST_PASSWORD = "PageSlugTest!12345678";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

const sql = hasEnv ? postgres(env("SUPABASE_LOCAL_URL"), { max: 1 }) : null;

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function seedTenant(admin: SupabaseClient, label: string): Promise<string> {
  const slug = `pgs-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: `Strony test ${label}`, status: "active", locale: "pl" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać tenanta ${label}: ${error?.message}`);
  createdTenantIds.push(data.id as string);
  return data.id as string;
}

async function seedOwnerClient(admin: SupabaseClient, tenantId: string): Promise<SupabaseClient> {
  const email = `pgs-owner-${randomUUID().slice(0, 8)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role: "owner" },
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  createdUserIds.push(data.user.id);

  const { error: memberError } = await admin
    .from("members")
    .insert({ tenant_id: tenantId, user_id: data.user.id, role: "owner" });
  if (memberError) throw new Error(`members: ${memberError.message}`);

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);
  return client;
}

async function seedSite(
  admin: SupabaseClient,
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from("sites")
    .insert({ tenant_id: tenantId, name: `Strona ${randomUUID().slice(0, 6)}`, ...overrides })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać strony: ${error?.message}`);
  return data.id as string;
}

describe.skipIf(!hasEnv)("adres strony najemcy — 0073 (ADR-157)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    await sql?.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Zgodność list (anty-rozjazd TS ↔ baza)
  // -------------------------------------------------------------------
  describe("zgodność list", () => {
    it("app.reserved_page_slugs() == RESERVED_PAGE_SLUGS z @avably/core/site", async () => {
      const rows = await sql!<{ reserved: string[] }[]>`
        select app.reserved_page_slugs() as reserved
      `;
      const fromDb = [...rows[0]!.reserved].sort();
      const fromCore = [...RESERVED_PAGE_SLUGS].sort();

      expect(fromDb.length, "pusta lista w bazie — czujnik po pustym zbiorze").toBeGreaterThan(10);
      expect(
        fromDb,
        "lista w migracji 0073 rozjechała się z RESERVED_PAGE_SLUGS " +
          "(packages/core/src/site/page-slug.ts)",
      ).toEqual(fromCore);
    });

    it("KAŻDY wpis z listy trafia w warunek bramki (nie tylko kilka wybranych)", async () => {
      // Sprawdzane na TYM SAMYM wyrażeniu, którego używa trigger — bez
      // zakładania kilkunastu stron.
      const rows = await sql!<{ slug: string; blocked: boolean }[]>`
        select s.slug, lower(btrim(s.slug)) = any (app.reserved_page_slugs()) as blocked
        from unnest(${sql!.array([...RESERVED_PAGE_SLUGS])}::text[]) as s(slug)
      `;
      expect(rows.length, "pusty zbiór wejściowy").toBeGreaterThan(10);
      const passing = rows.filter((row) => !row.blocked).map((row) => row.slug);
      expect(passing, `slugi przepuszczone mimo rezerwacji: ${passing.join(", ")}`).toEqual([]);
    });

    it("slug strony GŁÓWNEJ nie jest zarezerwowany — inaczej nie dałoby się jej zapisać", async () => {
      const rows = await sql!<{ blocked: boolean }[]>`
        select ${HOME_PAGE_SLUG} = any (app.reserved_page_slugs()) as blocked
      `;
      expect(rows[0]!.blocked).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // 2. Slug zarezerwowany — bramka stoi w BAZIE
  // -------------------------------------------------------------------
  describe("slug zarezerwowany", () => {
    let tenantId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant(admin, "reserved");
    }, 60_000);

    it.each(["checkout", "cart", "product", "store", "regulamin", "pl"])(
      "slug `%s` jest odrzucony kodem 22023 — ścieżką service_role (bez RLS i bez Zoda)",
      async (slug) => {
        const { error } = await admin
          .from("sites")
          .insert({ tenant_id: tenantId, name: "Strona zajmująca trasę", slug });
        expect(error?.code, `slug ${slug} przeszedł`).toBe(PG_INVALID_PARAMETER);
        expect(error?.message).toContain(slug);
      },
    );

    it("KONTROLA POZYTYWNA: slug spoza listy przechodzi", async () => {
      // Bez tego „wszystko odrzucone" (np. przez literówkę w triggerze)
      // wyglądałoby jak działająca bramka.
      const id = await seedSite(admin, tenantId, { slug: "jak-dziala-wynajem" });
      expect(id).toBeTruthy();
    });

    it("bramka działa też na UPDATE — adresu nie da się PRZENIEŚĆ na systemowy", async () => {
      const id = await seedSite(admin, tenantId, { slug: "o-nas" });
      const { error } = await admin.from("sites").update({ slug: "cart" }).eq("id", id);
      expect(error?.code).toBe(PG_INVALID_PARAMETER);
    });

    it("UPDATE NIE ruszający sluga przechodzi, choćby slug był na liście", async () => {
      // Rozstrzygnięcie 4 migracji: rozrost listy (nowa trasa sklepu w przyszłej
      // paczce) nie może zablokować operatorowi zmiany NAZWY strony, która
      // akurat stoi pod adresem, który właśnie stał się zarezerwowany.
      const id = await seedSite(admin, tenantId, { slug: "kontakt" });
      // Stan „lista urosła po fakcie" jest z definicji nieosiągalny przez
      // bramkę, więc zasiewamy go z wyłączonymi triggerami użytkownika —
      // `set local` gaśnie razem z transakcją, więc współdzielona baza nie
      // zostaje z otwartą furtką nawet przy wyjątku.
      await sql!.begin(async (tx) => {
        await tx`set local session_replication_role = 'replica'`;
        await tx`update public.sites set slug = 'terms' where id = ${id}::uuid`;
      });

      const { error } = await admin.from("sites").update({ name: "Nowa nazwa" }).eq("id", id);
      expect(error, "zmiana nazwy zablokowana przez bramkę sluga").toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // 3. Kształt adresu — CHECK jest lustrem PAGE_SLUG_PATTERN
  // -------------------------------------------------------------------
  describe("kształt adresu", () => {
    let tenantId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant(admin, "shape");
    }, 60_000);

    it.each([
      "Kontakt",
      "kon takt",
      "-kontakt",
      "kontakt-",
      "kon--takt",
      "kontakt/podstrona",
      "kontakt.html",
      "kontakt_2",
      "kontąkt",
      "a".repeat(61),
    ])("adres `%s` odrzucony CHECK-iem 23514", async (slug) => {
      const { error } = await admin
        .from("sites")
        .insert({ tenant_id: tenantId, name: "Zły adres", slug });
      expect(error?.code, `slug ${slug} przeszedł`).toBe(PG_CHECK_VIOLATION);
    });

    it("KONTROLA POZYTYWNA: pusty slug (strona główna) i zwykły slug przechodzą", async () => {
      expect(await seedSite(admin, tenantId, { slug: HOME_PAGE_SLUG })).toBeTruthy();
      expect(await seedSite(admin, tenantId, { slug: "wynajem-krakow-2026" })).toBeTruthy();
    });

    it("strona bez podanego sluga rodzi się jako szkic strony GŁÓWNEJ", async () => {
      // To jest cała treść zdania „zero zmian widocznych": panel sprzed 0074
      // tworzy wiersz bez sluga i dostaje dokładnie to, czym `sites` był dotąd.
      const id = await seedSite(admin, tenantId);
      const rows = await sql!<{ slug: string }[]>`
        select slug from public.sites where id = ${id}::uuid
      `;
      expect(rows[0]!.slug).toBe(HOME_PAGE_SLUG);
    });
  });

  // -------------------------------------------------------------------
  // 4. Adres jest daną PUBLICZNĄ — pisze go wyłącznie publikacja
  // -------------------------------------------------------------------
  describe("bliźniak slug_published", () => {
    let tenantId: string;
    let member: SupabaseClient;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant(admin, "twin");
      member = await seedOwnerClient(admin, tenantId);
    }, 60_000);

    it("członek NIE zapisze slug_published wprost — 42501 od strażnika", async () => {
      const id = await seedSite(admin, tenantId, { slug: "kontakt" });
      const { error } = await member.from("sites").update({ slug_published: "kontakt" }).eq("id", id);
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });

    it("strona nie może URODZIĆ SIĘ pod opublikowanym adresem — 42501", async () => {
      const { error } = await member
        .from("sites")
        .insert({ tenant_id: tenantId, name: "Podstępna", slug: "cennik", slug_published: "cennik" });
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });

    it("publikacja PRZENOSI adres ze szkicu do bliźniaka", async () => {
      const id = await seedSite(admin, tenantId, { slug: "publikowana" });
      const { error } = await member.schema("app").rpc("publish_site", { p_site_id: id });
      expect(error).toBeNull();

      const rows = await sql!<{ slug: string; slug_published: string | null }[]>`
        select slug, slug_published from public.sites where id = ${id}::uuid
      `;
      expect(rows[0]!.slug_published).toBe("publikowana");
    });

    it("zmiana sluga w SZKICU nie rusza adresu opublikowanego, dopóki nie opublikujesz", async () => {
      const id = await seedSite(admin, tenantId, { slug: "adres-stary" });
      await member.schema("app").rpc("publish_site", { p_site_id: id });

      const { error } = await member.from("sites").update({ slug: "adres-nowy" }).eq("id", id);
      expect(error, "zmiana sluga w szkicu zablokowana").toBeNull();

      const przed = await sql!<{ slug: string; slug_published: string | null }[]>`
        select slug, slug_published from public.sites where id = ${id}::uuid
      `;
      expect(przed[0]!.slug).toBe("adres-nowy");
      expect(przed[0]!.slug_published, "szkic przeniósł żywy adres bez publikacji").toBe(
        "adres-stary",
      );

      await member.schema("app").rpc("publish_site", { p_site_id: id });
      const po = await sql!<{ slug_published: string | null }[]>`
        select slug_published from public.sites where id = ${id}::uuid
      `;
      expect(po[0]!.slug_published).toBe("adres-nowy");
    });

    it("strona opublikowana MA opublikowany adres — stan bez niego jest niereprezentowalny", async () => {
      const id = await seedSite(admin, tenantId, { slug: "kompletna" });
      // Rolą serwisową, czyli z pominięciem strażnika: bramką jest CHECK.
      const proba = sql!`
        update public.sites
           set published_at = now(), template_published = 'classic'
         where id = ${id}::uuid
      `;
      await expect(proba).rejects.toMatchObject({ code: PG_CHECK_VIOLATION });
    });
  });

  // -------------------------------------------------------------------
  // 5. Unikat PO ADRESIE zamiast „jedna żywa strona"
  // -------------------------------------------------------------------
  describe("unikat po adresie", () => {
    let tenantId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant(admin, "unique");
    }, 60_000);

    it("dwie żywe strony pod TYM SAMYM adresem są niereprezentowalne nawet rolą serwisową", async () => {
      const pierwsza = await seedSite(admin, tenantId, { slug: "duplikat" });
      const druga = await seedSite(admin, tenantId, { slug: "duplikat" });

      await sql!`
        update public.sites
           set published_at = now(), template_published = 'classic', slug_published = 'duplikat'
         where id = ${pierwsza}::uuid
      `;
      const proba = sql!`
        update public.sites
           set published_at = now(), template_published = 'classic', slug_published = 'duplikat'
         where id = ${druga}::uuid
      `;
      await expect(proba).rejects.toMatchObject({ code: PG_UNIQUE_VIOLATION });
      await expect(proba.catch((e: { message: string }) => e.message)).resolves.toContain(
        "sites_live_slug_unique_idx",
      );
    });

    it("dwie żywe strony pod RÓŻNYMI adresami są reprezentowalne — to jest cała zmiana 0073", async () => {
      // Własny najemca: blok wyżej zostawia po sobie żywą stronę `duplikat`,
      // a ten test liczy WSZYSTKIE żywe strony najemcy.
      const tenantId = await seedTenant(admin, "unique-multi");
      const glowna = await seedSite(admin, tenantId, { slug: HOME_PAGE_SLUG });
      const kontakt = await seedSite(admin, tenantId, { slug: "kontakt" });

      await sql!`
        update public.sites
           set published_at = now(), template_published = 'classic', slug_published = ''
         where id = ${glowna}::uuid
      `;
      await sql!`
        update public.sites
           set published_at = now(), template_published = 'classic', slug_published = 'kontakt'
         where id = ${kontakt}::uuid
      `;

      const rows = await sql!<{ n: string }[]>`
        select count(*)::text as n from public.sites
         where tenant_id = ${tenantId}::uuid and published_at is not null
      `;
      expect(Number(rows[0]!.n)).toBe(2);
    });

    it("dwie żywe strony GŁÓWNE dalej niereprezentowalne — stary niezmiennik przeżył zamianę", async () => {
      const inny = await seedTenant(admin, "unique-home");
      const a = await seedSite(admin, inny, { slug: HOME_PAGE_SLUG });
      const b = await seedSite(admin, inny, { slug: HOME_PAGE_SLUG });

      await sql!`
        update public.sites
           set published_at = now(), template_published = 'classic', slug_published = ''
         where id = ${a}::uuid
      `;
      const proba = sql!`
        update public.sites
           set published_at = now(), template_published = 'classic', slug_published = ''
         where id = ${b}::uuid
      `;
      await expect(proba).rejects.toMatchObject({ code: PG_UNIQUE_VIOLATION });
    });
  });

  // -------------------------------------------------------------------
  // 6. ZERO ZMIAN WIDOCZNYCH — koperta odczytu publicznego nietknięta
  // -------------------------------------------------------------------
  describe("koperta odczytu publicznego", () => {
    it("app.get_published_site nie oddaje ani jednego nowego klucza", async () => {
      const tenantId = await seedTenant(admin, "envelope");
      const id = await seedSite(admin, tenantId, { slug: HOME_PAGE_SLUG });
      const member = await seedOwnerClient(admin, tenantId);
      await member.schema("app").rpc("publish_site", { p_site_id: id });

      const rows = await sql!<{ envelope: Record<string, unknown> }[]>`
        select app.get_published_site(${tenantId}::uuid) as envelope
      `;
      const envelope = rows[0]!.envelope;
      expect(envelope, "brak koperty — czujnik po pustym zbiorze").toBeTruthy();
      // Koperta storefrontu jest `.strict()`: nieznany klucz nie jest ignorowany,
      // tylko WYWRACA CAŁĄ STRONĘ. Klucz `slug` dochodzi warunkowo w 0074.
      expect(Object.keys(envelope).sort()).toEqual(["published_at", "sections", "template"]);
    });
  });
});
