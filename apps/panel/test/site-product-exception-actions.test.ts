/**
 * WŁASNA STRONA WYBRANEGO PRODUKTU — AKCJE FAZY B (ADR-200) na ŻYWYM Supabase,
 * przez FAKTYCZNE server actions (wzorzec `site-pages-actions.test.ts`: mock
 * `requireMember` wstrzykuje realnego, zalogowanego membera; bramką zostaje
 * RLS i schemat 0088, nie mock).
 *
 * Pakiet `packages/db/test/site-product-exception.test.ts` (faza A) dowodzi
 * reguł na poziomie DANYCH: limit, unikaty, niezmienność, rozstrzyganie.
 * TU mierzone jest to, czego tamten nie widzi — czy WARSTWA AKCJI nie rozmija
 * się z bazą:
 *
 *   1. FORK tworzy poprawny wiersz: `kind='product'`, wskazany `product_id`,
 *      treść == treść ROBOCZA matki (kopia, nie pustka; bez nagrobków);
 *   2. IZOLACJA: fork cudzego produktu i przywrócenie cudzego wiersza to
 *      odmowy bez śladu w bazie;
 *   3. LIMIT z bazy DOCIERA do operatora jako zdanie (PT409 → komunikat
 *      z liczbą), a nie surowa treść ani zamaskowane 500;
 *   4. „PRZYWRÓĆ DOMYŚLNY" usuwa właściwy wiersz i TYLKO jego (nie matkę,
 *      nie cudzy), a sklep wraca pod matkę tą samą drogą, którą czyta trasa
 *      (`app.get_published_product_template` kluczem anona);
 *   5. STAFF forkuje na równi z ownerem — tworzenie stron jest w tym repo
 *      pracą lady (polityki 0019 dla każdego członka), a fork jest tym samym
 *      czasownikiem na innym wierszu.
 *
 * Werdykt zawsze z TRWAŁEGO stanu (odczyt service-rolem), nie ze zwrotu akcji.
 */
import { randomUUID } from "node:crypto";

import { createTranslator } from "next-intl";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import plMessages from "../messages/pl.json";
import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "SiteExceptionActions!12345678";
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function createAdminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function createTenantMember(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `exc-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `exc-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja wyjątków ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);
  return { client: await signIn(email), tenantId: tenantId as string };
}

/** Staff w ISTNIEJĄCYM tenancie (wzorzec export-csv.test.ts). */
async function createStaffMember(admin: SupabaseClient, tenantId: string): Promise<SupabaseClient> {
  const email = `exc-staff-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(staff): ${error?.message}`);
  createdUserIds.push(data.user.id);
  const { error: memberError } = await admin
    .from("members")
    .insert({ tenant_id: tenantId, user_id: data.user.id, role: "staff" });
  if (memberError) throw new Error(`insert members(staff): ${memberError.message}`);
  await admin.auth.admin.updateUserById(data.user.id, {
    app_metadata: { tenant_id: tenantId, role: "staff" },
  });
  return signIn(email);
}

const requireMember = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
/*
 * Tłumaczenia jak w produkcji (PL, realny słownik) — akcje oddają zdania
 * z `site.pages.*`, a test ma mierzyć DOKŁADNIE ten tekst, który zobaczy
 * operator, nie atrapę klucza.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace?: string) =>
    createTranslator({
      locale: "pl",
      messages: plMessages as never,
      ...(namespace ? { namespace: namespace as never } : {}),
    }),
}));

const { forkProductPage, restoreDefaultProductPage } = await import(
  "@/lib/actions/site-product-exception"
);
const { publishSite } = await import("@/lib/actions/site");
const { MAX_PRODUCT_EXCEPTIONS } = await import("@/lib/site-validation");

const pagesPl = plMessages.site.pages;

describe.skipIf(!hasEnv)("akcje własnej strony produktu (RLS, żywy Supabase)", () => {
  let admin: SupabaseClient;
  /** Klient sklepu: klucz publikowalny, ZERO sesji — tak czyta klient najemcy. */
  let anon: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };

  function actAs(actor: { client: SupabaseClient; tenantId: string }) {
    requireMember.mockResolvedValue({ supabase: actor.client, tenantId: actor.tenantId });
  }

  async function seedProduct(tenantId: string, name: string): Promise<string> {
    const { data, error } = await admin
      .from("products")
      .insert({
        tenant_id: tenantId,
        name,
        base_price_day_grosze: 12_000,
        deposit_grosze: 0,
        auto_increment_multiplier: 1.0,
        buffer_before_days: 0,
        buffer_after_days: 0,
        active: true,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed products(${name}): ${error?.message}`);
    return data.id as string;
  }

  /** Szablon-matka z DWIEMA sekcjami roboczymi i JEDNYM nagrobkiem. */
  async function seedMother(tenantId: string): Promise<{ siteId: string }> {
    const { data: site, error } = await admin
      .from("sites")
      .insert({
        tenant_id: tenantId,
        name: "Strona sprzętu",
        slug: "",
        kind: "product",
        template: "bold",
        style_draft: { theme: "warm" },
      })
      .select("id")
      .single();
    if (error || !site) throw new Error(`seed mother: ${error?.message}`);
    const siteId = site.id as string;

    const { error: sectionsError } = await admin.from("site_sections").insert([
      {
        tenant_id: tenantId,
        site_id: siteId,
        type: "hero",
        position: 0,
        enabled: true,
        content_draft: { heading: "Nagłówek matki", subheading: "Szkic roboczy" },
      },
      {
        tenant_id: tenantId,
        site_id: siteId,
        type: "pricing",
        position: 1,
        enabled: false,
        content_draft: { heading: "Cennik matki", note: "Wyłączona w szkicu" },
      },
    ]);
    if (sectionsError) throw new Error(`seed mother sections: ${sectionsError.message}`);

    /*
     * NAGROBEK: sekcja opublikowana i usunięta W SZKICU (`deleted_in_draft`).
     * Operator już ją skasował, więc fork NIE MA prawa jej wskrzesić — a CHECK
     * 0045 wymaga stanu opublikowanego, stąd `content_published` (zapis idzie
     * service-rolem, strażnik kolumn opublikowanych go przepuszcza).
     */
    const { error: tombError } = await admin.from("site_sections").insert({
      tenant_id: tenantId,
      site_id: siteId,
      type: "faq",
      position: 2,
      enabled: true,
      content_draft: { heading: "Usunięta w szkicu", items: [] },
      // Stan opublikowany jest KOMPLETEM bliźniaków (CHECK
      // `site_sections_published_complete`, 0045) — treść bez pozycji
      // i włączenia jest niereprezentowalna.
      content_published: { heading: "Usunięta w szkicu", items: [] },
      position_published: 2,
      enabled_published: true,
      deleted_in_draft: true,
    });
    if (tombError) throw new Error(`seed mother tombstone: ${tombError.message}`);
    return { siteId };
  }

  async function exceptionRows(tenantId: string) {
    const { data } = await admin
      .from("sites")
      .select("id, name, kind, product_id, slug, template, style_draft, published_at")
      .eq("tenant_id", tenantId)
      .not("product_id", "is", null)
      .order("created_at", { ascending: true });
    return data ?? [];
  }

  /** Rozstrzyganie sklepu — dokładnie tą drogą, którą czyta trasa produktu. */
  async function publishedTemplateFor(tenantId: string, productId: string): Promise<unknown> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_published_product_template", { p_tenant_id: tenantId, p_product_id: productId });
    if (error) throw new Error(`get_published_product_template: ${error.message}`);
    return data;
  }

  beforeAll(async () => {
    admin = createAdminClient();
    anon = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...realtimeTransport,
    });
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");
  }, 60_000);

  beforeEach(async () => {
    await admin.from("sites").delete().eq("tenant_id", tenantA.tenantId);
    await admin.from("sites").delete().eq("tenant_id", tenantB.tenantId);
    await admin.from("products").delete().eq("tenant_id", tenantA.tenantId);
    await admin.from("products").delete().eq("tenant_id", tenantB.tenantId);
    actAs(tenantA);
  });

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) await admin.from("tenants").delete().in("id", createdTenantIds);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  }, 60_000);

  it("FORK tworzy wiersz wyjątku z PEŁNĄ KOPIĄ treści roboczej matki (bramka 1)", async () => {
    const { siteId: motherId } = await seedMother(tenantA.tenantId);
    const productId = await seedProduct(tenantA.tenantId, "Rower górski Kross");

    const result = await forkProductPage({ productId });
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
    if (!result.ok) throw new Error(result.error);

    const rows = await exceptionRows(tenantA.tenantId);
    expect(rows).toHaveLength(1);
    const fork = rows[0]!;
    expect(fork.id).toBe(result.siteId);
    expect(fork.kind).toBe("product");
    expect(fork.product_id).toBe(productId);
    expect(fork.slug, "wyjątek nie ma własnego adresu").toBe("");
    expect(fork.name, "nazwa strony ma mówić, którego sprzętu dotyczy").toBe(
      "Rower górski Kross",
    );
    expect(fork.published_at, "fork urodził się widoczny w sklepie").toBeNull();
    // Kolumny szkicu strony — skopiowane z matki, nie domyślne.
    expect(fork.template).toBe("bold");
    expect(fork.style_draft).toEqual({ theme: "warm" });

    // TREŚĆ: kopia sekcji roboczych 1:1 (typ, treść, enabled, pozycja),
    // BEZ nagrobka — i nieopublikowana (bliźniaki puste).
    const { data: sections } = await admin
      .from("site_sections")
      .select("type, content_draft, content_published, enabled, position, deleted_in_draft")
      .eq("site_id", result.siteId)
      .order("position", { ascending: true });
    expect(sections).toHaveLength(2);
    expect(sections![0]).toMatchObject({
      type: "hero",
      content_draft: { heading: "Nagłówek matki", subheading: "Szkic roboczy" },
      content_published: null,
      enabled: true,
      position: 0,
      deleted_in_draft: false,
    });
    expect(sections![1]).toMatchObject({
      type: "pricing",
      content_draft: { heading: "Cennik matki", note: "Wyłączona w szkicu" },
      content_published: null,
      enabled: false,
      position: 1,
    });

    // KOPIA, NIE REFERENCJA (ADR-199 R6): zmiana matki po forku nie propaguje.
    const { data: motherHero } = await admin
      .from("site_sections")
      .select("id")
      .eq("site_id", motherId)
      .eq("type", "hero")
      .single();
    await admin
      .from("site_sections")
      .update({ content_draft: { heading: "Matka zmieniona PO forku" } })
      .eq("id", motherHero!.id);
    const { data: forkHero } = await admin
      .from("site_sections")
      .select("content_draft")
      .eq("site_id", result.siteId)
      .eq("type", "hero")
      .single();
    expect(forkHero!.content_draft).toEqual({
      heading: "Nagłówek matki",
      subheading: "Szkic roboczy",
    });
  }, 60_000);

  it("FORK bez szablonu-matki: odmowa ze wskazaniem następnego kroku, zero wierszy", async () => {
    const productId = await seedProduct(tenantA.tenantId, "Agregat bez matki");

    const result = await forkProductPage({ productId });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("fork bez matki przeszedł");
    expect(result.error).toBe(pagesPl.exceptionNoTemplate);
    expect(await exceptionRows(tenantA.tenantId)).toHaveLength(0);
  }, 60_000);

  it("IZOLACJA: fork produktu INNEGO najemcy = odmowa i zero wierszy po obu stronach (bramka 2)", async () => {
    await seedMother(tenantA.tenantId);
    const cudzyProdukt = await seedProduct(tenantB.tenantId, "Cudzy sprzęt");

    actAs(tenantA);
    const result = await forkProductPage({ productId: cudzyProdukt });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("fork cudzego produktu przeszedł");
    // RLS tnie wiersz produktu — odmowa nieodróżnialna od braku.
    expect(result.error).toBe(pagesPl.exceptionProductNotFound);

    expect(await exceptionRows(tenantA.tenantId), "wyjątek powstał u wołającego").toHaveLength(0);
    expect(await exceptionRows(tenantB.tenantId), "wyjątek powstał u ofiary").toHaveLength(0);
  }, 60_000);

  it("LIMIT z bazy dociera jako ZDANIE z liczbą, nie surowe PT409 ani 500 (bramka 3)", async () => {
    await seedMother(tenantA.tenantId);

    // Pięć wyjątków zasiewa rola serwisowa (trigger ją przepuszcza) — akcja
    // NIE MA skąd znać tej liczby inaczej niż z odmowy bazy przy szóstym.
    for (let i = 0; i < MAX_PRODUCT_EXCEPTIONS; i++) {
      const productId = await seedProduct(tenantA.tenantId, `Sprzęt ${i + 1}`);
      const { error } = await admin.from("sites").insert({
        tenant_id: tenantA.tenantId,
        name: `Wyjątek ${i + 1}`,
        slug: "",
        kind: "product",
        product_id: productId,
      });
      expect(error, `zasiew wyjątku ${i + 1}: ${error?.message}`).toBeNull();
    }

    const szostyProdukt = await seedProduct(tenantA.tenantId, "Szósty sprzęt");
    const result = await forkProductPage({ productId: szostyProdukt });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("limit nie zadziałał");

    const oczekiwane = pagesPl.exceptionLimitReached.replaceAll(
      "{max}",
      String(MAX_PRODUCT_EXCEPTIONS),
    );
    expect(result.error, "odmowa limitu ma być zdaniem interfejsu").toBe(oczekiwane);
    // Kontrola negatywna klasy „gołe 500 / surowa treść triggera":
    expect(result.error).not.toContain("Something went wrong");
    expect(result.error).not.toContain("PT409");

    expect(await exceptionRows(tenantA.tenantId), "szósty wyjątek wszedł mimo odmowy").toHaveLength(
      MAX_PRODUCT_EXCEPTIONS,
    );
  }, 60_000);

  it("PRZYWRÓĆ DOMYŚLNY zdejmuje ŻYWY wyjątek, usuwa właściwy wiersz i sklep wraca pod matkę (bramka 5)", async () => {
    const { siteId: motherId } = await seedMother(tenantA.tenantId);
    const productId = await seedProduct(tenantA.tenantId, "Rower do przywrócenia");

    const fork = await forkProductPage({ productId });
    if (!fork.ok) throw new Error(fork.error);

    // Fork dostaje WŁASNĄ treść (edycja szkicu jak w kreatorze) — żeby wynik
    // rozstrzygania dało się odróżnić od matki PO TREŚCI, nie po wierze.
    const { error: editError } = await tenantA.client
      .from("site_sections")
      .update({ content_draft: { heading: "Własny nagłówek wyjątku", subheading: "Fork" } })
      .eq("tenant_id", tenantA.tenantId)
      .eq("site_id", fork.siteId)
      .eq("type", "hero");
    expect(editError, `edycja szkicu forka: ${editError?.message}`).toBeNull();

    // Matka i wyjątek ŻYWE — publikacja tą samą drogą, którą chodzi każda strona.
    actAs(tenantA);
    const publishMother = await publishSite(motherId);
    expect(publishMother.ok, publishMother.ok ? "" : publishMother.error).toBe(true);
    const publishFork = await publishSite(fork.siteId);
    expect(publishFork.ok, publishFork.ok ? "" : publishFork.error).toBe(true);

    // Sklep rozstrzyga WYJĄTEK: pod adresem produktu stoi treść forka.
    const przed = JSON.stringify(await publishedTemplateFor(tenantA.tenantId, productId));
    expect(przed, "sklep nie widzi żywego wyjątku").toContain("Własny nagłówek wyjątku");

    const result = await restoreDefaultProductPage(fork.siteId);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);

    // Wiersz wyjątku ZNIKNĄŁ — matka stoi nietknięta i żywa.
    expect(await exceptionRows(tenantA.tenantId)).toHaveLength(0);
    const { data: mother } = await admin
      .from("sites")
      .select("id, published_at")
      .eq("id", motherId)
      .maybeSingle();
    expect(mother, "przywrócenie usunęło MATKĘ").not.toBeNull();
    expect(mother!.published_at).not.toBeNull();

    // Adres produktu wraca pod matkę — tą samą drogą, którą czyta trasa —
    // a treść forka znika ze sklepu co do bajta.
    const po = await publishedTemplateFor(tenantA.tenantId, productId);
    expect(po, "po przywróceniu sklep nie oddaje matki").not.toBeNull();
    expect(JSON.stringify(po)).not.toContain("Własny nagłówek wyjątku");
    expect(JSON.stringify(po)).toContain("Nagłówek matki");
  }, 60_000);

  it("PRZYWRÓĆ DOMYŚLNY na matce i na cudzym wierszu: odmowa, zero zmian", async () => {
    const { siteId: motherId } = await seedMother(tenantA.tenantId);
    const productId = await seedProduct(tenantA.tenantId, "Sprzęt izolacji");
    const fork = await forkProductPage({ productId });
    if (!fork.ok) throw new Error(fork.error);

    // (a) matka NIE jest wyjątkiem — czasownik odmawia zamiast usuwać.
    const naMatce = await restoreDefaultProductPage(motherId);
    expect(naMatce.ok).toBe(false);
    if (naMatce.ok) throw new Error("przywrócenie usunęło matkę");
    expect(naMatce.error).toBe(pagesPl.restoreDefaultNotException);

    // (b) cudzy wiersz — RLS tnie, odmowa nieodróżnialna od braku.
    actAs(tenantB);
    const cudzy = await restoreDefaultProductPage(fork.siteId);
    expect(cudzy.ok).toBe(false);

    const rows = await exceptionRows(tenantA.tenantId);
    expect(rows, "cudze przywrócenie usunęło wiersz najemcy A").toHaveLength(1);
    const { data: mother } = await admin.from("sites").select("id").eq("id", motherId).maybeSingle();
    expect(mother).not.toBeNull();
  }, 60_000);

  it("STAFF forkuje i przywraca na równi z ownerem (spójnie z createSite — praca lady, 0019)", async () => {
    await seedMother(tenantA.tenantId);
    const productId = await seedProduct(tenantA.tenantId, "Sprzęt staffa");
    const staff = await createStaffMember(admin, tenantA.tenantId);

    requireMember.mockResolvedValue({ supabase: staff, tenantId: tenantA.tenantId });
    const fork = await forkProductPage({ productId });
    expect(fork.ok, fork.ok ? "" : fork.error).toBe(true);
    if (!fork.ok) throw new Error(fork.error);
    expect(await exceptionRows(tenantA.tenantId)).toHaveLength(1);

    const restore = await restoreDefaultProductPage(fork.siteId);
    expect(restore.ok, restore.ok ? "" : restore.error).toBe(true);
    expect(await exceptionRows(tenantA.tenantId)).toHaveLength(0);
  }, 60_000);
});
