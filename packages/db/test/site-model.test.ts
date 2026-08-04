/**
 * Model sekcyjny storefrontu (0019, Zadanie 2.3a, ADR-041). Wektory, których
 * macierz izolacji tabel (rls-isolation.test.ts) NIE pokrywa — i które są
 * sednem tego zadania:
 *
 *   (a) FK ZŁOŻONY site_sections (tenant_id, site_id) → sites (tenant_id, id):
 *       sekcja z własnym, poprawnym tenant_id NIE MOŻE wskazać strony cudzego
 *       tenanta — RLS by to przepuściło (sprawdza tenant_id wstawianego
 *       wiersza), bramką jest klucz złożony: 23503 (ADR-019). Dowód mutacyjny:
 *       rozbicie FK na sam site_id → oba testy (a) przestają dostawać 23503.
 *
 *   (b) BRAMKA PUBLIC-READ (app.get_published_site): anon dostaje WYŁĄCZNIE
 *       opublikowane (content_published), WŁĄCZONE sekcje AKTYWNEGO tenanta —
 *       nigdy content_draft, sekcji wyłączonej/nieopublikowanej ani czegokolwiek
 *       dla tenanta nieaktywnego. Dowód mutacyjny: rozluźnienie warunku w
 *       funkcji (np. coalesce(content_published, content_draft) albo zdjęcie
 *       `enabled`) → testy przecieku niżej się palą.
 *
 *   (c) PUBLIKACJA (app.publish_site, SECURITY INVOKER): kopiuje draft→published
 *       atomowo i wyłącznie dla strony WŁASNEGO tenanta (RLS wołającego);
 *       cudza strona = 22023, stan nietknięty (weryfikacja service-role).
 *
 * Skuteczność bramek mierzona TRWAŁYM stanem / faktyczną treścią odpowiedzi,
 * nie samym kodem błędu — konwencja macierzy izolacji.
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (patrz seed-tenants.ts).
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";
import { cleanupSeeded, createAdminClient, seedTwoTenants, type TenantCtx } from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_UNIQUE_VIOLATION = "23505";
const PG_INVALID_PARAMETER_VALUE = "22023";

// supabase-js zawsze konstruuje klienta Realtime; Node 20 nie ma globalnego
// WebSocket (patrz helpers/seed-tenants.ts). To samo obejście.
const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function createAnonClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_LOCAL_API_URL as string,
    process.env.SUPABASE_LOCAL_ANON_KEY as string,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...realtimeTransport,
    },
  );
}

interface PublishedSitePayload {
  template: string;
  published_at: string;
  sections: { id: string; type: string; position: number; content: Record<string, unknown> }[];
}

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
let siteAId: string;
let siteBId: string;

/** Strona tenanta klientem OWNERA (kontrola pozytywna RLS insertu przy okazji). */
async function createSiteAsOwner(ctx: TenantCtx): Promise<string> {
  const { data, error } = await ctx.ownerClient
    .from("sites")
    .insert({ tenant_id: ctx.tenantId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się utworzyć strony: ${error?.message}`);
  return data.id as string;
}

async function addSectionAsOwner(
  ctx: TenantCtx,
  siteId: string,
  row: { type: string; position: number; content_draft: Record<string, unknown>; enabled?: boolean },
): Promise<string> {
  const { data, error } = await ctx.ownerClient
    .from("site_sections")
    .insert({ tenant_id: ctx.tenantId, site_id: siteId, ...row })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się dodać sekcji: ${error?.message}`);
  return data.id as string;
}

async function getPublishedAsAnon(tenantId: string): Promise<PublishedSitePayload | null> {
  const { data, error } = await anon
    .schema("app")
    .rpc("get_published_site", { p_tenant_id: tenantId });
  if (error) throw new Error(`RPC get_published_site jako anon zawiodło: ${error.message}`);
  return data as PublishedSitePayload | null;
}

describe.skipIf(!hasEnv)("model sekcyjny storefrontu (0019)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();
    ({ a, b } = await seedTwoTenants());
    siteAId = await createSiteAsOwner(a);
    siteBId = await createSiteAsOwner(b);
  }, 60_000);

  afterAll(async () => {
    await cleanupSeeded(admin);
  });

  // -------------------------------------------------------------------
  // Schemat: wiele WERSJI strony, najwyżej jedna ŻYWA (0048, ADR-093)
  // -------------------------------------------------------------------
  //
  // Do 0047 stał tu unikat `sites_tenant_unique (tenant_id)` i test mówił
  // „druga strona tego samego tenanta → 23505". Model stron uchylił tamten
  // niezmiennik, ale NIE zniósł ograniczenia — przesunął je na oś ŻYWOŚCI.
  // Oba testy niżej są tą samą parą co przedtem: co wolno i czego nie.

  it("druga WERSJA strony tego samego tenanta jest legalna", async () => {
    const { data, error } = await a.ownerClient
      .from("sites")
      .insert({ tenant_id: a.tenantId, name: "Wersja robocza" })
      .select("id, name, published_at")
      .single();
    expect(error, `druga wersja strony odrzucona: ${error?.message}`).toBeNull();
    expect(data?.name).toBe("Wersja robocza");
    // Wersja rodzi się NIEŻYWA — inaczej wpadłaby na unikat częściowy niżej
    // (i, co ważniejsze, urodziłaby się publiczna bez publikacji).
    expect(data?.published_at, "nowa wersja urodziła się widoczna w sklepie").toBeNull();

    await admin.from("site_sections").delete().eq("site_id", data!.id as string);
    await admin.from("sites").delete().eq("id", data!.id as string);
  });

  it("druga ŻYWA strona tego samego tenanta → 23505 (unikat częściowy 0048)", async () => {
    // Test jest SAMODZIELNY: sam czyni stronę A żywą i sam ją zdejmuje, żeby
    // nie zależeć od kolejności bloków w tym pliku. Wszystko rolą serwisową,
    // czyli Z POMINIĘCIEM strażnika bliźniaków — dowód ma dotyczyć DANYCH,
    // a nie tego, że akcja panelu jest grzeczna.
    const { error: liveError } = await admin
      .from("sites")
      .update({ published_at: new Date().toISOString(), template_published: "classic" })
      .eq("id", siteAId);
    expect(liveError, `nie udało się uczynić strony A żywą: ${liveError?.message}`).toBeNull();

    const { error } = await admin.from("sites").insert({
      tenant_id: a.tenantId,
      name: "Druga żywa",
      published_at: new Date().toISOString(),
      template_published: "classic",
    });
    expect(error?.code, `oczekiwano ${PG_UNIQUE_VIOLATION}: ${error?.message}`).toBe(PG_UNIQUE_VIOLATION);
    expect(error?.message, "odmowa spoza unikatu żywej strony").toContain("sites_one_live_per_tenant_idx");

    // Stan wejściowy z powrotem — kolejne bloki publikują stronę A same.
    await admin
      .from("sites")
      .update({ published_at: null, template_published: null })
      .eq("id", siteAId);
  });

  // -------------------------------------------------------------------
  // (a) FK złożony — referencja cross-tenant jest niereprezentowalna
  // -------------------------------------------------------------------

  it("odrzuca sekcję wskazującą stronę CUDZEGO tenanta (23503, ADR-019)", async () => {
    // Wiersz ma poprawny tenant_id = A (przechodzi RLS with check), ale site_id
    // to strona tenanta B. Bez klucza złożonego FK sprawdzałby samo istnienie
    // site_id (strona B istnieje) i wiersz-łącznik dwóch tenantów by wszedł.
    const { error } = await a.ownerClient.from("site_sections").insert({
      tenant_id: a.tenantId,
      site_id: siteBId,
      type: "hero",
      content_draft: { heading: "cross-tenant" },
    });
    expect(error, "INSERT sekcji pod cudzą stronę powinien zostać odrzucony").not.toBeNull();
    expect(error?.code, `oczekiwano ${PG_FOREIGN_KEY_VIOLATION} (FK złożony)`).toBe(PG_FOREIGN_KEY_VIOLATION);
  });

  it("FK złożony trzyma nawet dla service_role (23503 — spójność, nie RLS)", async () => {
    const { error } = await admin.from("site_sections").insert({
      tenant_id: a.tenantId,
      site_id: siteBId,
      type: "hero",
      content_draft: { heading: "cross-tenant-admin" },
    });
    expect(error?.code, `oczekiwano ${PG_FOREIGN_KEY_VIOLATION}: ${error?.message}`).toBe(
      PG_FOREIGN_KEY_VIOLATION,
    );
  });

  // -------------------------------------------------------------------
  // (b)+(c) Cykl draft → publikacja → publiczny odczyt
  // -------------------------------------------------------------------

  describe("cykl publikacji i bramka public-read", () => {
    let heroId: string;
    let disabledId: string;
    let pricingId: string;

    beforeAll(async () => {
      heroId = await addSectionAsOwner(a, siteAId, {
        type: "hero",
        position: 0,
        content_draft: { heading: "Wypożycz sprzęt" },
      });
      disabledId = await addSectionAsOwner(a, siteAId, {
        type: "freeform",
        position: 1,
        content_draft: { body: "sekcja wyłączona — nie dla publiczności" },
        enabled: false,
      });
      pricingId = await addSectionAsOwner(a, siteAId, {
        type: "pricing",
        position: 2,
        content_draft: { heading: "Cennik" },
      });
    }, 30_000);

    it("PRZED publikacją anon dostaje NULL — draft nie istnieje dla publiczności", async () => {
      expect(await getPublishedAsAnon(a.tenantId)).toBeNull();
    });

    it("publikacja kopiuje draft→published i otwiera publiczny odczyt (bez draftu i sekcji wyłączonej)", async () => {
      const { data: publishedAt, error } = await a.ownerClient
        .schema("app")
        .rpc("publish_site", { p_site_id: siteAId });
      expect(error, `publish_site jako owner A zawiodło: ${error?.message}`).toBeNull();
      expect(publishedAt, "publish_site nie zwróciło znacznika publikacji").toBeTruthy();

      const site = await getPublishedAsAnon(a.tenantId);
      expect(site, "opublikowana strona aktywnego tenanta powinna być publiczna").not.toBeNull();
      expect(site?.template).toBe("classic");

      // Sekcja wyłączona jest pomijana mimo że publikacja skopiowała jej treść
      // (utrwalona migawka, bramką widoczności jest odczyt).
      expect(site?.sections.map((s) => s.id)).toEqual([heroId, pricingId]);
      expect(site?.sections.some((s) => s.id === disabledId), "wyłączona sekcja w odpowiedzi").toBe(false);
      expect(site?.sections.map((s) => s.position)).toEqual([0, 2]);
      expect(site?.sections[0]?.content).toEqual({ heading: "Wypożycz sprzęt" });

      // Odpowiedź nie niesie NIGDZIE draftu ani samego klucza content_draft.
      expect(JSON.stringify(site)).not.toContain("content_draft");
      expect(JSON.stringify(site)).not.toContain("sekcja wyłączona");
    });

    it("edycja draftu PO publikacji nie wycieka — anon widzi stan z chwili publikacji", async () => {
      const { error } = await a.ownerClient
        .from("site_sections")
        .update({ content_draft: { heading: "NOWY DRAFT — niepublikowany" } })
        .eq("tenant_id", a.tenantId)
        .eq("id", heroId);
      expect(error, `edycja draftu zawiodła: ${error?.message}`).toBeNull();

      const site = await getPublishedAsAnon(a.tenantId);
      expect(
        site?.sections.find((s) => s.id === heroId)?.content,
        "anon zobaczył treść draftu sprzed publikacji — granica draft/published pękła",
      ).toEqual({ heading: "Wypożycz sprzęt" });
    });

    it("sekcja dodana PO publikacji (content_published IS NULL) jest dla anona niewidoczna", async () => {
      const freshId = await addSectionAsOwner(a, siteAId, {
        type: "contact",
        position: 3,
        content_draft: { heading: "Kontakt — jeszcze nieopublikowany" },
      });
      const site = await getPublishedAsAnon(a.tenantId);
      expect(
        site?.sections.some((s) => s.id === freshId),
        "sekcja nigdy nieopublikowana pojawiła się w publicznym odczycie",
      ).toBe(false);
    });

    it("wyłączenie sekcji PO publikacji NIE zdejmuje jej z żywej strony — bramką jest enabled_published (0045)", async () => {
      // Do 0045 `enabled` było kolumną WSPÓLNĄ i ten UPDATE chował sekcję
      // natychmiast. Po ADR-091 wyłączenie jest operacją SZKICU; publiczny
      // odczyt filtruje po `enabled_published`, które rusza tylko publikacja.
      const { error } = await a.ownerClient
        .from("site_sections")
        .update({ enabled: false })
        .eq("tenant_id", a.tenantId)
        .eq("id", pricingId);
      expect(error).toBeNull();

      const beforePublish = await getPublishedAsAnon(a.tenantId);
      expect(
        beforePublish?.sections.some((s) => s.id === pricingId),
        "wyłączenie w szkicu zdjęło sekcję z żywej strony przed publikacją",
      ).toBe(true);

      const { error: publishError } = await a.ownerClient
        .schema("app")
        .rpc("publish_site", { p_site_id: siteAId });
      expect(publishError, `publikacja zawiodła: ${publishError?.message}`).toBeNull();

      const afterPublish = await getPublishedAsAnon(a.tenantId);
      expect(
        afterPublish?.sections.some((s) => s.id === pricingId),
        "publikacja nie przeniosła wyłączenia sekcji",
      ).toBe(false);

      // Przywrócenie (dane wspólne dla kolejnych testów) — też przez publikację.
      await a.ownerClient
        .from("site_sections")
        .update({ enabled: true })
        .eq("tenant_id", a.tenantId)
        .eq("id", pricingId);
      await a.ownerClient.schema("app").rpc("publish_site", { p_site_id: siteAId });
    });

    it("odpowiedź dla tenanta A nie zawiera sekcji tenanta B (dwa opublikowane sklepy)", async () => {
      const bSectionId = await addSectionAsOwner(b, siteBId, {
        type: "freeform",
        position: 0,
        content_draft: { body: "treść tenanta B" },
      });
      const { error } = await b.ownerClient.schema("app").rpc("publish_site", { p_site_id: siteBId });
      expect(error, `publish_site jako owner B zawiodło: ${error?.message}`).toBeNull();

      const siteA = await getPublishedAsAnon(a.tenantId);
      expect(siteA?.sections.some((s) => s.id === bSectionId)).toBe(false);
      expect(JSON.stringify(siteA)).not.toContain("treść tenanta B");

      const siteB = await getPublishedAsAnon(b.tenantId);
      expect(siteB?.sections.map((s) => s.id), "kontrola pozytywna sklepu B").toEqual([bSectionId]);
    });
  });

  // -------------------------------------------------------------------
  // (b) Tenant nieaktywny — nieodróżnialny od nieistniejącego
  // -------------------------------------------------------------------

  it("opublikowana strona ZAWIESZONEGO tenanta jest dla anona NULL (spójnie z 0017)", async () => {
    // Stan opublikowany budowany service-rolem (grant tabelaryczny — publikacja
    // przez RPC wymaga sesji membera, którego zawieszony tenant tu nie ma mieć).
    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .insert({ slug: `site-susp-${randomUUID().slice(0, 12)}`, name: "Suspended site", status: "suspended" })
      .select("id")
      .single();
    if (tenantError || !tenant) throw new Error(`seed zawieszonego tenanta: ${tenantError?.message}`);
    const suspendedTenantId = tenant.id as string;

    try {
      // Stan opublikowany od 0045 to KOMPLET bliźniaków (*_published), a nie
      // sama treść — CHECK-i site_sections_published_complete i
      // sites_published_template_complete czynią stan połowiczny
      // niereprezentowalnym, także dla service_role.
      const { data: site, error: siteError } = await admin
        .from("sites")
        .insert({
          tenant_id: suspendedTenantId,
          published_at: new Date().toISOString(),
          template_published: "classic",
        })
        .select("id")
        .single();
      if (siteError || !site) throw new Error(`seed strony: ${siteError?.message}`);
      const { error: sectionError } = await admin.from("site_sections").insert({
        tenant_id: suspendedTenantId,
        site_id: site.id as string,
        type: "hero",
        position: 0,
        content_draft: { heading: "X" },
        content_published: { heading: "X" },
        position_published: 0,
        enabled_published: true,
      });
      if (sectionError) throw new Error(`seed sekcji: ${sectionError.message}`);

      expect(
        await getPublishedAsAnon(suspendedTenantId),
        "sklep zawieszonego tenanta jest osiągalny publicznie — bramka statusu pękła",
      ).toBeNull();
    } finally {
      await admin.from("tenants").delete().eq("id", suspendedTenantId);
    }
  });

  it("nieznany tenant_id zwraca NULL (nie błąd)", async () => {
    expect(await getPublishedAsAnon(randomUUID())).toBeNull();
  });

  // -------------------------------------------------------------------
  // RPC to JEDYNA ścieżka publiczna; publikacja tylko własnej strony
  // -------------------------------------------------------------------

  it("anon nie odczyta sites/site_sections wprost (42501 — brak grantu, RPC jedyną ścieżką)", async () => {
    for (const table of ["sites", "site_sections", "domains"] as const) {
      const { data, error } = await anon.from(table).select("*");
      expect(data ?? [], `anon zobaczył wiersze ${table}`).toEqual([]);
      expect(error?.code, `anon dostał z ${table} odpowiedź inną niż odmowa uprawnień: ${error?.message}`).toBe(
        "42501",
      );
    }
  });

  it("anon nie wykona publish_site (grant tylko dla authenticated)", async () => {
    const { error } = await anon.schema("app").rpc("publish_site", { p_site_id: siteAId });
    expect(error, "anon opublikował stronę — publikacja musi wymagać sesji membera").not.toBeNull();
  });

  it("owner A nie opublikuje strony tenanta B (22023, stan B nietknięty)", async () => {
    // Świeży tenant z NIEopublikowaną stroną — bez sprzężenia z testami wyżej.
    const { data: tenant } = await admin
      .from("tenants")
      .insert({ slug: `site-vict-${randomUUID().slice(0, 12)}`, name: "Victim site" })
      .select("id")
      .single();
    const victimTenantId = tenant!.id as string;
    try {
      const { data: site } = await admin
        .from("sites")
        .insert({ tenant_id: victimTenantId })
        .select("id")
        .single();
      const victimSiteId = site!.id as string;

      const { error } = await a.ownerClient.schema("app").rpc("publish_site", { p_site_id: victimSiteId });
      expect(error, "publikacja cudzej strony powinna zostać odrzucona").not.toBeNull();
      expect(error?.code, `oczekiwano ${PG_INVALID_PARAMETER_VALUE}: ${error?.message}`).toBe(
        PG_INVALID_PARAMETER_VALUE,
      );

      // Werdykt z TRWAŁEGO stanu: published_at ofiary pozostało NULL.
      const { data: after } = await admin
        .from("sites")
        .select("published_at")
        .eq("id", victimSiteId)
        .single();
      expect(after?.published_at, "cudza publikacja ZMIENIŁA stan ofiary — wyciek izolacji").toBeNull();
    } finally {
      await admin.from("tenants").delete().eq("id", victimTenantId);
    }
  });
});
