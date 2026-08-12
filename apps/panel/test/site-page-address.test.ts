/**
 * ADRES STRONY W PANELU (Faza 2, 0073/0074, ADR-157/158) — walidacja w polu
 * i akcje na ŻYWYM Supabase.
 *
 * Dwie warstwy, obie potrzebne z osobna:
 *
 *   1. WALIDACJA W POLU. `pageSlugIssue` jest tym, co widzi operator ZANIM
 *      cokolwiek wyśle — i musi mówić, CO poprawić. Odmowa po zapisie byłaby
 *      za późna: adres zarezerwowany nie wywraca zapisu w oczywisty sposób,
 *      tylko produkuje stronę, która NIGDY się nie wyświetli (statyczna trasa
 *      Next zawsze wygrywa z dynamiczną), a operator widzi ją w panelu jako
 *      opublikowaną.
 *
 *   2. AKCJE PRZY ŻYWEJ BAZIE. Bramką jest baza, nie Zod: surowe PostgREST ma
 *      tę samą drogę do tabeli co formularz. Testy niżej sprawdzają, czy
 *      warstwa akcji nie rozmija się z bazą — że odmowa triggera dociera jako
 *      ZDANIE, że adres w szkicu nie przenosi żywej strony i że unikat żywego
 *      adresu jest tłumaczony, a nie przepuszczany surowy.
 *
 * Werdykt zawsze z TRWAŁEGO stanu (odczyt service-rolem), nie ze zwrotu akcji.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "SitePageAddress!12345678";
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
  const email = `addr-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `addr-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja adresów ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

const requireMember = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { createSite, renameSite, publishSite } = await import("@/lib/actions/site");
const { pageSlugIssue, suggestSiteSlug } = await import("@/lib/site-validation");

// -------------------------------------------------------------------
// 1. Walidacja W POLU — bez bazy, bo operator widzi ją przed zapisem
// -------------------------------------------------------------------
describe("odmowa adresu jest ZDANIEM, nie kodem błędu", () => {
  it("adres zarezerwowany mówi, KTÓRY adres i dlaczego", () => {
    const issue = pageSlugIssue("regulamin");
    expect(issue, "adres zarezerwowany przeszedł").not.toBeNull();
    expect(issue).toContain("regulamin");
    expect(issue).toContain("zarezerwowany");
  });

  it("zły kształt mówi, co wolno wpisać — i podaje przykład", () => {
    const issue = pageSlugIssue("Jak Działa Wynajem");
    expect(issue).not.toBeNull();
    expect(issue).toContain("małe litery");
  });

  it("pusty adres NIE udaje strony głównej — mówi, że nazwa go nie daje", () => {
    // `suggestPageSlug("???")` zwraca pustkę; bez tej gałęzi operator
    // wyprodukowałby DRUGĄ stronę główną, nie zauważając niczego.
    expect(suggestSiteSlug("???")).toBe("");
    expect(pageSlugIssue("")).toContain("Podaj adres");
  });

  it("KONTROLA POZYTYWNA: poprawny adres nie ma żadnej uwagi", () => {
    // Bez tego „wszystko odrzucone" wyglądałoby jak działająca walidacja.
    expect(pageSlugIssue("jak-dziala-wynajem")).toBeNull();
    expect(pageSlugIssue(suggestSiteSlug("Rowery górskie"))).toBeNull();
  });

  it("propozycja z nazwy transliteruje polskie znaki, zamiast je odrzucać", () => {
    expect(suggestSiteSlug("Rowery górskie")).toBe("rowery-gorskie");
    expect(suggestSiteSlug("Łódki i kajaki")).toBe("lodki-i-kajaki");
  });
});

// -------------------------------------------------------------------
// 2. Akcje przy ŻYWEJ bazie
// -------------------------------------------------------------------
describe.skipIf(!hasEnv)("akcje adresu strony (RLS, żywy Supabase)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };

  function actAs(actor: { client: SupabaseClient; tenantId: string }) {
    requireMember.mockResolvedValue({ supabase: actor.client, tenantId: actor.tenantId });
  }

  async function rows(tenantId: string) {
    const { data } = await admin
      .from("sites")
      .select("id, name, slug, slug_published, published_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });
    return data ?? [];
  }

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");
  }, 120_000);

  beforeEach(async () => {
    await admin.from("sites").delete().eq("tenant_id", tenantA.tenantId);
    await admin.from("sites").delete().eq("tenant_id", tenantB.tenantId);
    actAs(tenantA);
  });

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) await admin.from("tenants").delete().in("id", createdTenantIds);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  }, 60_000);

  it("createSite zapisuje ADRES, a strona rodzi się bez adresu opublikowanego", async () => {
    const result = await createSite({ name: "Jak działa wynajem", slug: "jak-dziala-wynajem" });
    expect(result.ok, result.ok ? "" : result.error).toBe(true);

    const [row] = await rows(tenantA.tenantId);
    expect(row?.slug).toBe("jak-dziala-wynajem");
    expect(row?.slug_published, "adres wszedł do sklepu bez publikacji").toBeNull();
  });

  it("createSite bez adresu zakłada kolejny szkic strony GŁÓWNEJ", async () => {
    const result = await createSite({ name: "Szkic" });
    expect(result.ok).toBe(true);
    expect((await rows(tenantA.tenantId))[0]?.slug).toBe("");
  });

  it("adres zarezerwowany odrzuca BAZA, a panel oddaje jej zdanie", async () => {
    // Ścieżka omija Zoda: wejście przechodzi walidację panelu tylko dlatego, że
    // test woła akcję z wartością, którą formularz zablokowałby wcześniej —
    // dowód ma dotyczyć BAZY, bo to ona widzi także surowe PostgREST.
    const result = await createSite({ name: "Regulamin", slug: "regulamin" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("regulamin");
    expect(await rows(tenantA.tenantId), "strona mimo odmowy powstała").toEqual([]);
  });

  it("renameSite zmienia adres SZKICU — żywy adres zostaje do publikacji", async () => {
    const created = await createSite({ name: "Kontakt", slug: "kontakt" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await publishSite(created.siteId);

    const zmiana = await renameSite({ siteId: created.siteId, name: "Kontakt", slug: "kontakt-nowy" });
    expect(zmiana.ok, zmiana.ok ? "" : zmiana.error).toBe(true);

    const [row] = await rows(tenantA.tenantId);
    expect(row?.slug).toBe("kontakt-nowy");
    expect(row?.slug_published, "zmiana szkicu przeniosła żywy adres").toBe("kontakt");

    await publishSite(created.siteId);
    expect((await rows(tenantA.tenantId))[0]?.slug_published).toBe("kontakt-nowy");
  });

  it("publikacja pod ZAJĘTYM adresem dostaje zdanie o adresie, nie surowe 23505", async () => {
    const pierwsza = await createSite({ name: "Kontakt", slug: "kontakt" });
    const druga = await createSite({ name: "Kontakt 2", slug: "kontakt" });
    expect(pierwsza.ok && druga.ok).toBe(true);
    if (!pierwsza.ok || !druga.ok) return;

    expect((await publishSite(pierwsza.siteId)).ok).toBe(true);

    const kolizja = await publishSite(druga.siteId);
    expect(kolizja.ok).toBe(false);
    if (kolizja.ok) return;
    expect(kolizja.error).toContain("adres");
    expect(kolizja.error, "surowy komunikat bazy przeciekł do operatora").not.toContain(
      "duplicate key",
    );

    // Werdykt z trwałego stanu: żywa jest DOKŁADNIE pierwsza strona.
    const zywe = (await rows(tenantA.tenantId)).filter((row) => row.published_at !== null);
    expect(zywe.map((row) => row.id)).toEqual([pierwsza.siteId]);
  });

  it("publikacja strony pod INNYM adresem NIE gasi strony głównej", async () => {
    const glowna = await createSite({ name: "Sklep" });
    const kontakt = await createSite({ name: "Kontakt", slug: "kontakt" });
    expect(glowna.ok && kontakt.ok).toBe(true);
    if (!glowna.ok || !kontakt.ok) return;

    await publishSite(glowna.siteId);
    await publishSite(kontakt.siteId);

    const zywe = (await rows(tenantA.tenantId)).filter((row) => row.published_at !== null);
    expect(zywe.map((row) => row.slug_published).sort()).toEqual(["", "kontakt"]);
  });

  it("IZOLACJA: właściciel A nie zmieni adresu strony najemcy B", async () => {
    actAs(tenantB);
    const cudza = await createSite({ name: "Kontakt B", slug: "kontakt-b" });
    expect(cudza.ok).toBe(true);
    if (!cudza.ok) return;

    actAs(tenantA);
    const proba = await renameSite({ siteId: cudza.siteId, name: "Przejęte", slug: "przejete" });
    expect(proba.ok).toBe(false);

    const [row] = await rows(tenantB.tenantId);
    expect(row?.slug, "adres cudzej strony został zmieniony").toBe("kontakt-b");
    expect(row?.name).toBe("Kontakt B");
  });
});
