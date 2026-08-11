/**
 * Akcje kolejności/duplikatu/usuwania sekcji (Kreator A1) na ŻYWYM, lokalnym
 * Supabase — wzorzec catalog.test.ts, ale przez FAKTYCZNE server actions
 * (mock `requireMember` wstrzykuje realnego, zalogowanego membera; klient nosi
 * sesję, więc bramką jest RLS, nie mock). To czyni test celem dla dowodów
 * mutacyjnych: mutacja w akcji realnie pali asercję.
 *
 * Weryfikuje to, co MUSI być prawdą niezależnie od UI:
 *   1. reorder zapisuje KOMPLET nowych pozycji (nie tylko pierwszą) —
 *      DOWÓD MUTACYJNY #1: akcja aktualizująca samą pierwszą pozycję → czerwone;
 *   2. duplikat to WIERNA kopia draftu (ten sam typ/treść/enabled), nieopublikowana
 *      (content_published NULL), tuż za oryginałem —
 *      DOWÓD MUTACYJNY #2: duplikat gubiący content_draft → czerwone;
 *   3. IZOLACJA: obcy tenant nie przestawi, nie zduplikuje ani nie usunie sekcji
 *      cudzej strony (stan ofiary nietknięty, weryfikacja service-role).
 *
 * Werdykt zawsze z TRWAŁEGO stanu (odczyt adm/anon), nie z samego zwrotu akcji.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "SiteEditorTest!12345678";
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

function createAnonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function createTenantMember(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `site-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `site-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja strony ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

// --- mock warstwy Next: akcje mają dostać realnego membera i nie dotykać cache ---
const requireMember = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const {
  reorderSections,
  duplicateSection,
  deleteSection,
  restoreSection,
  publishSite,
  updateSiteStyle,
  applyStarterTemplate,
} =
  await import("@/lib/actions/site");

describe.skipIf(!hasEnv)("akcje sekcji strony (RLS, żywy Supabase)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };
  let siteAId: string;
  /** Sekcje A w kolejności zasiewu (positions 0..3). */
  let ids: string[];
  const heroDraft = { heading: "Kopiuj mnie", subheading: "Podtytuł do skopiowania" };

  /** Ustawia aktora akcji (klient z sesją + tenant) dla najbliższego wywołania. */
  function actAs(actor: { client: SupabaseClient; tenantId: string }) {
    requireMember.mockResolvedValue({ supabase: actor.client, tenantId: actor.tenantId });
  }

  /** Pozycje sekcji A odczytane service-rolem (werdykt z trwałego stanu). */
  async function positions(): Promise<Record<string, number>> {
    const { data } = await admin
      .from("site_sections")
      .select("id, position")
      .eq("tenant_id", tenantA.tenantId)
      .eq("site_id", siteAId);
    return Object.fromEntries((data ?? []).map((r) => [r.id as string, r.position as number]));
  }

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");

    // Strona A + 4 sekcje klientem ownera (kontrola pozytywna RLS insertu).
    const { data: site, error: siteError } = await tenantA.client
      .from("sites")
      .insert({ tenant_id: tenantA.tenantId })
      .select("id")
      .single();
    if (siteError || !site) throw new Error(`insert sites: ${siteError?.message}`);
    siteAId = site.id as string;

    // Sekcja 0 = hero z bogatym draftem (do dowodu kopii); reszta neutralna.
    const rows = [
      { type: "hero", position: 0, content_draft: heroDraft, enabled: true },
      { type: "pricing", position: 1, content_draft: { heading: "Cennik" }, enabled: true },
      { type: "faq", position: 2, content_draft: { heading: "FAQ", items: [] }, enabled: false },
      { type: "contact", position: 3, content_draft: { heading: "Kontakt" }, enabled: true },
    ];
    ids = [];
    for (const row of rows) {
      const { data, error } = await tenantA.client
        .from("site_sections")
        .insert({ tenant_id: tenantA.tenantId, site_id: siteAId, ...row })
        .select("id")
        .single();
      if (error || !data) throw new Error(`insert site_sections: ${error?.message}`);
      ids.push(data.id as string);
    }
  }, 60_000);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) await admin.from("tenants").delete().in("id", createdTenantIds);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Reorder zapisuje KOMPLET pozycji (dowód mutacyjny #1)
  // -------------------------------------------------------------------

  it("reorder zapisuje KOMPLET nowych pozycji (odwrócenie kolejności) — nie tylko pierwszą", async () => {
    const reversed = [...ids].reverse();
    actAs(tenantA);
    const result = await reorderSections(siteAId, reversed);
    expect(result.ok, `reorder jako A: ${result.ok ? "" : result.error}`).toBe(true);

    // KAŻDA sekcja dostała pozycję = swojemu miejscu w przekazanej kolejności.
    // Mutacja „zapisz tylko pierwszą pozycję" zostawia pozostałym stare wartości
    // (0..3), więc ta asercja staje się czerwona — dowód mutacyjny #1.
    const after = await positions();
    for (let i = 0; i < reversed.length; i++) {
      expect(after[reversed[i]!], `pozycja sekcji ${i} po reorderze`).toBe(i);
    }
  });

  // -------------------------------------------------------------------
  // 2. Duplikat = wierna kopia draftu, nieopublikowana (dowód mutacyjny #2)
  // -------------------------------------------------------------------

  it("duplikat kopiuje typ, content_draft i enabled; jest nieopublikowany i stoi tuż za oryginałem", async () => {
    const heroId = ids[0]!;
    actAs(tenantA);
    const result = await duplicateSection(heroId);
    expect(result.ok, `duplikat jako A: ${result.ok ? "" : result.error}`).toBe(true);
    const newId = result.ok ? result.sectionId : "";

    const { data: copy } = await admin
      .from("site_sections")
      .select("type, content_draft, content_published, enabled")
      .eq("id", newId)
      .single();

    // Treść draftu skopiowana 1:1 — mutacja `content_draft: {}` pali tę asercję
    // (dowód mutacyjny #2). Typ i enabled dziedziczone po oryginale.
    expect(copy?.content_draft).toEqual(heroDraft);
    expect(copy?.type).toBe("hero");
    expect(copy?.enabled).toBe(true);
    // Kopia jest NIEOPUBLIKOWANA z definicji.
    expect(copy?.content_published, "kopia nie może być z góry opublikowana").toBeNull();

    // Kopia sąsiaduje z oryginałem: w kolejności (position, id) stoi tuż za nim.
    const { data: ordered } = await admin
      .from("site_sections")
      .select("id")
      .eq("tenant_id", tenantA.tenantId)
      .eq("site_id", siteAId)
      .order("position", { ascending: true })
      .order("id", { ascending: true });
    const order = (ordered ?? []).map((r) => r.id as string);
    expect(order.indexOf(newId)).toBe(order.indexOf(heroId) + 1);
  });

  // -------------------------------------------------------------------
  // 3. Izolacja — obcy tenant nie ruszy sekcji cudzej strony
  // -------------------------------------------------------------------

  it("obcy tenant NIE przestawi sekcji cudzej strony (odmowa; pozycje A nietknięte)", async () => {
    const before = await positions();
    actAs(tenantB);
    const result = await reorderSections(siteAId, [...ids].reverse());
    expect(result.ok, "reorder cudzej strony powinien zostać odrzucony").toBe(false);
    expect(await positions(), "pozycje strony A zmieniły się po próbie obcego tenanta").toEqual(before);
  });

  it("obcy tenant NIE zduplikuje sekcji cudzej strony (odmowa; brak nowego wiersza)", async () => {
    const { count: before } = await admin
      .from("site_sections")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantA.tenantId)
      .eq("site_id", siteAId);
    actAs(tenantB);
    const result = await duplicateSection(ids[0]!);
    expect(result.ok, "duplikat cudzej sekcji powinien zostać odrzucony").toBe(false);
    const { count: after } = await admin
      .from("site_sections")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantA.tenantId)
      .eq("site_id", siteAId);
    expect(after, "obcy tenant utworzył kopię na cudzej stronie").toBe(before);
  });

  it("obcy tenant NIE usunie sekcji cudzej strony; właściciel usuwa własną", async () => {
    const target = ids[3]!;
    actAs(tenantB);
    const denied = await deleteSection(target);
    expect(denied.ok, "usunięcie cudzej sekcji powinno zostać odrzucone").toBe(false);
    const { data: still } = await admin.from("site_sections").select("id").eq("id", target);
    expect(still, "cudza sekcja została usunięta — wyciek izolacji").toHaveLength(1);

    // Kontrola pozytywna: właściciel usuwa własną sekcję. Sekcja NIGDY nie była
    // publikowana, więc od 0045 (ADR-091) ginie wierszem, a nie znacznikiem —
    // nie ma czego chronić do publikacji.
    actAs(tenantA);
    const ok = await deleteSection(target);
    expect(ok.ok, `właściciel nie usunął własnej sekcji: ${ok.ok ? "" : ok.error}`).toBe(true);
    expect(ok.ok && ok.mode, "sekcja nieopublikowana powinna zginąć wierszem").toBe("removed");
    const { data: gone } = await admin.from("site_sections").select("id").eq("id", target);
    expect(gone, "sekcja właściciela nie została usunięta").toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // 4. Usunięcie sekcji OPUBLIKOWANEJ jest operacją SZKICU (ADR-091)
  // -------------------------------------------------------------------

  describe("usunięcie i przywrócenie sekcji opublikowanej (0045, ADR-091)", () => {
    /** Koperta widziana przez sklep — anon, jedyna publiczna ścieżka odczytu. */
    async function envelope(): Promise<{ sections: { id: string }[]; template: string } | null> {
      const { data, error } = await createAnonClient()
        .schema("app")
        .rpc("get_published_site", { p_tenant_id: tenantA.tenantId });
      if (error) throw new Error(`get_published_site: ${error.message}`);
      return data as { sections: { id: string }[]; template: string } | null;
    }

    let victimId: string;

    beforeAll(async () => {
      // Sekcja wchodzi na ŻYWĄ stronę — inaczej test usuwałby coś, czego
      // klient i tak nie widzi, i nie dowodziłby niczego o bramce.
      const { data, error } = await tenantA.client
        .from("site_sections")
        .insert({
          tenant_id: tenantA.tenantId,
          site_id: siteAId,
          type: "cta",
          position: 50,
          content_draft: { heading: "Sekcja na żywo" },
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`insert sekcji do publikacji: ${error?.message}`);
      victimId = data.id as string;

      actAs(tenantA);
      const published = await publishSite(siteAId);
      expect(published.ok, `publikacja startowa: ${published.ok ? "" : published.error}`).toBe(true);
    }, 60_000);

    it("usunięcie sekcji opublikowanej zostawia wiersz i NIE rusza strony klienta", async () => {
      const before = await envelope();
      expect(before?.sections.some((s) => s.id === victimId), "sekcja nie weszła na żywą stronę").toBe(
        true,
      );

      actAs(tenantA);
      const result = await deleteSection(victimId);
      expect(result.ok, `usunięcie: ${result.ok ? "" : result.error}`).toBe(true);
      expect(result.ok && result.mode, "sekcja opublikowana powinna dostać znacznik, nie DELETE").toBe(
        "marked",
      );

      const { data: row } = await admin
        .from("site_sections")
        .select("id, deleted_in_draft")
        .eq("id", victimId)
        .maybeSingle();
      expect(row?.id, "akcja skasowała wiersz zamiast oznaczyć go w szkicu").toBe(victimId);
      expect(row?.deleted_in_draft).toBe(true);

      expect(await envelope(), "usunięcie w szkicu zmieniło stronę klienta").toEqual(before);
    });

    it("zmiana STYLU też nie rusza strony klienta przed publikacją", async () => {
      // Do ADR-090 tym testem chodziła zmiana szablonu graficznego. Przełącznik
      // zniknął z kreatora (szablon jest odtąd światem wybieranym w galerii),
      // ale zdanie, którego test broni, zostaje to samo i jest MOCNIEJSZE:
      // styl przemalowuje CAŁĄ stronę, więc tym bardziej nie ma prawa wejść na
      // nią przed publikacją.
      const before = await envelope();
      actAs(tenantA);
      const result = await updateSiteStyle(siteAId, { theme: "noir-lux", accent: "champagne" });
      expect(result.ok, `zmiana stylu: ${result.ok ? "" : result.error}`).toBe(true);

      const { data: site } = await admin.from("sites").select("style_draft").eq("id", siteAId).single();
      expect(site?.style_draft, "styl nie zapisał się w szkicu").toEqual({
        theme: "noir-lux",
        accent: "champagne",
      });
      expect(await envelope(), "zmiana stylu przemalowała żywą stronę przed publikacją").toEqual(before);
    });

    it("przywrócenie zdejmuje znacznik; obcy tenant nie przywróci cudzej sekcji", async () => {
      actAs(tenantB);
      const denied = await restoreSection(victimId);
      expect(denied.ok, "obcy tenant przywrócił cudzą sekcję").toBe(false);
      const { data: stillMarked } = await admin
        .from("site_sections")
        .select("deleted_in_draft")
        .eq("id", victimId)
        .single();
      expect(stillMarked?.deleted_in_draft, "znacznik zmieniony przez obcego tenanta").toBe(true);

      actAs(tenantA);
      const restored = await restoreSection(victimId);
      expect(restored.ok, `przywrócenie: ${restored.ok ? "" : restored.error}`).toBe(true);
      const { data: row } = await admin
        .from("site_sections")
        .select("deleted_in_draft")
        .eq("id", victimId)
        .single();
      expect(row?.deleted_in_draft).toBe(false);
    });

    it("SZABLON STARTOWY nie zdejmuje z żywej strony ani jednej sekcji", async () => {
      // Najostrzejszy przypadek całej K5 v2: operator ogląda inny szablon na
      // stronie, która JUŻ stoi u klientów. Do 0045 ta akcja kasowała wiersze,
      // więc sklep gasł w chwili kliknięcia — mimo że nowe sekcje wchodziły
      // wyłącznie do szkicu. Odtąd usunięcia idą nagrobkami, a żywa strona
      // zostaje bajtowo taka sama do publikacji.
      const before = await envelope();
      expect(before?.sections.length, "fixture: strona musi być opublikowana").toBeGreaterThan(0);

      actAs(tenantA);
      const applied = await applyStarterTemplate({
        siteId: siteAId,
        starterId: "photo-video",
        locale: "pl",
      });
      expect(applied.ok, `szablon: ${applied.ok ? "" : applied.error}`).toBe(true);

      expect(await envelope(), "szablon startowy zmienił stronę klienta").toEqual(before);

      // Szkic jest już szablonem: nowe sekcje istnieją i są nieopublikowane,
      // a zastane leżą pod nagrobkiem (wiersz zostaje — inaczej publikacja nie
      // miałaby czego zdjąć).
      const { data: rows } = await admin
        .from("site_sections")
        .select("id, deleted_in_draft, content_published")
        .eq("site_id", siteAId);
      const nagrobki = (rows ?? []).filter((row) => row.deleted_in_draft);
      const nowe = (rows ?? []).filter((row) => !row.deleted_in_draft);
      expect(nagrobki.length, "zastane sekcje skasowane zamiast oznaczone").toBeGreaterThan(0);
      expect(nowe.length, "szablon nie wstawił sekcji").toBeGreaterThan(0);
      expect(
        nowe.every((row) => row.content_published === null),
        "sekcja szablonu urodziła się opublikowana",
      ).toBe(true);

      // Motyw szablonu wszedł do SZKICU stylu tą samą operacją.
      const { data: site } = await admin.from("sites").select("style_draft").eq("id", siteAId).single();
      expect((site?.style_draft as { theme?: string })?.theme).toBe("noir-lux");
    });

    it("dopiero publikacja zdejmuje sekcję z żywej strony i kasuje wiersz", async () => {
      actAs(tenantA);
      const marked = await deleteSection(victimId);
      expect(marked.ok && marked.mode).toBe("marked");

      const published = await publishSite(siteAId);
      expect(published.ok, `publikacja: ${published.ok ? "" : published.error}`).toBe(true);

      const after = await envelope();
      expect(after?.sections.some((s) => s.id === victimId), "sekcja przeżyła publikację").toBe(false);
      // Publikacja przenosi TO, CO STOI W SZKICU — porównujemy z kolumną, a nie
      // z literałem, bo testy wyżej zmieniają styl i test miałby wtedy dwie
      // prawdy o tym samym stanie.
      const { data: site } = await admin.from("sites").select("style_draft").eq("id", siteAId).single();
      expect(
        (after as unknown as { style?: unknown }).style,
        "styl nie wszedł razem z publikacją",
      ).toEqual(site?.style_draft);

      const { data: gone } = await admin.from("site_sections").select("id").eq("id", victimId);
      expect(gone, "publikacja nie skasowała wiersza sekcji usuniętej w szkicu").toHaveLength(0);
    });
  });
});
