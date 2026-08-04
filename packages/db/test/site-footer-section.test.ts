/**
 * STOPKA JAKO SEKCJA PRZYPIĘTA I JEDYNA (0047, K6, ADR-092).
 *
 * Trzy niezmienniki, których nie widzi ani macierz izolacji, ani model sekcyjny
 * z 0019 — bo wszystkie trzy dotyczą ZBIORU sekcji, a nie pojedynczego wiersza
 * ani granicy tenanta:
 *
 *   (a) TYP `footer` JEST DOPUSZCZONY, a typ spoza listy dalej nie — czyli
 *       rozszerzenie CHECK-a POSZERZYŁO zbiór, a nie otworzyło go. Bez drugiej
 *       połowy tego testu migracja, która skasowałaby CHECK zamiast go
 *       przepisać, przeszłaby na zielono.
 *
 *   (b) DRUGA ŻYWA STOPKA JEST NIEREPREZENTOWALNA (23505 z unikatu
 *       częściowego), ale stopka obok NAGROBKA po poprzedniej — legalna.
 *       To jest cała treść słowa „częściowy": bez predykatu `not
 *       deleted_in_draft` operator, który skasował stopkę przed publikacją,
 *       nie mógłby postawić nowej.
 *
 *   (c) ODCZYT PUBLICZNY STAWIA STOPKĘ NA KOŃCU niezależnie od zapisanej
 *       pozycji. Mierzymy to na stanie CELOWO ROZJECHANYM — stopka dostaje
 *       pozycję 0, czyli taką, jakiej normalizacja w panelu nigdy by nie
 *       zapisała. Test bez tego rozjazdu przechodziłby również wtedy, gdyby
 *       sortowanie w funkcji nie istniało w ogóle.
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (patrz seed-tenants.ts).
 */
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

const PG_CHECK_VIOLATION = "23514";
const PG_UNIQUE_VIOLATION = "23505";

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

const FOOTER_CONTENT = {
  businessName: "Wypożyczalnia Przykład",
  legal: "© Wypożyczalnia Przykład. Wszelkie prawa zastrzeżone.",
};

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TenantCtx;
let siteId: string;

async function addSection(
  ctx: TenantCtx,
  row: { type: string; position: number; content_draft: Record<string, unknown> },
): Promise<{ id: string | null; code: string | undefined; message: string | undefined }> {
  const { data, error } = await ctx.ownerClient
    .from("site_sections")
    .insert({ tenant_id: ctx.tenantId, site_id: siteId, ...row })
    .select("id")
    .maybeSingle();
  return { id: (data?.id as string) ?? null, code: error?.code, message: error?.message };
}

describe.skipIf(!hasEnv)("stopka strony: trzynasty typ, jedyność i przypięcie (0047)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();
    ({ a } = await seedTwoTenants());
    const { data, error } = await a.ownerClient
      .from("sites")
      .insert({ tenant_id: a.tenantId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Nie udało się utworzyć strony: ${error?.message}`);
    siteId = data.id as string;
  }, 60_000);

  afterAll(async () => {
    await cleanupSeeded(admin);
  });

  // -------------------------------------------------------------------
  // (a) CHECK: lista poszerzona, nie otwarta
  // -------------------------------------------------------------------

  describe("CHECK typów sekcji", () => {
    it("przyjmuje typ footer", async () => {
      const result = await addSection(a, {
        type: "footer",
        position: 5,
        content_draft: FOOTER_CONTENT,
      });
      expect(result.code, `stopka odrzucona: ${result.message}`).toBeUndefined();
      expect(result.id, "stopka nie dostała identyfikatora").not.toBeNull();
      // Sprzątamy od razu — kolejne bloki zakładają stronę BEZ żywej stopki.
      await admin.from("site_sections").delete().eq("id", result.id!);
    });

    it("dalej odrzuca typ spoza listy (23514 — CHECK poszerzony, nie skasowany)", async () => {
      const result = await addSection(a, {
        type: "newsletter",
        position: 6,
        content_draft: { heading: "typ, którego nie ma" },
      });
      expect(result.code, `oczekiwano ${PG_CHECK_VIOLATION}: ${result.message}`).toBe(PG_CHECK_VIOLATION);
    });
  });

  // -------------------------------------------------------------------
  // (b) Unikat częściowy: jedna ŻYWA stopka
  // -------------------------------------------------------------------

  describe("jedna żywa stopka na stronę", () => {
    let firstFooterId: string;

    beforeAll(async () => {
      const first = await addSection(a, {
        type: "footer",
        position: 9,
        content_draft: FOOTER_CONTENT,
      });
      if (!first.id) throw new Error(`Nie udało się dodać pierwszej stopki: ${first.message}`);
      firstFooterId = first.id;
    });

    afterAll(async () => {
      await admin.from("site_sections").delete().eq("site_id", siteId).eq("type", "footer");
    });

    it("druga stopka na tej samej stronie → 23505", async () => {
      const second = await addSection(a, {
        type: "footer",
        position: 10,
        content_draft: FOOTER_CONTENT,
      });
      expect(second.code, `oczekiwano ${PG_UNIQUE_VIOLATION}: ${second.message}`).toBe(
        PG_UNIQUE_VIOLATION,
      );
    });

    it("unikat trzyma także dla service_role (spójność danych, nie RLS)", async () => {
      const { error } = await admin.from("site_sections").insert({
        tenant_id: a.tenantId,
        site_id: siteId,
        type: "footer",
        position: 11,
        content_draft: FOOTER_CONTENT,
      });
      expect(error?.code, `oczekiwano ${PG_UNIQUE_VIOLATION}: ${error?.message}`).toBe(
        PG_UNIQUE_VIOLATION,
      );
    });

    it("stopka obok NAGROBKA po poprzedniej jest legalna (predykat unikatu)", async () => {
      // Nagrobek: sekcja skasowana w szkicu, ale wciąż stojąca na żywej stronie
      // (ADR-091). Wiersz istnieje, więc unikat BEZ predykatu blokowałby nową
      // stopkę do najbliższej publikacji.
      const { error: markError } = await admin
        .from("site_sections")
        .update({
          deleted_in_draft: true,
          content_published: FOOTER_CONTENT,
          position_published: 9,
          enabled_published: true,
        })
        .eq("id", firstFooterId);
      expect(markError, `nie udało się postawić nagrobka: ${markError?.message}`).toBeNull();

      const replacement = await addSection(a, {
        type: "footer",
        position: 12,
        content_draft: { ...FOOTER_CONTENT, businessName: "Wypożyczalnia Przykład II" },
      });
      expect(
        replacement.code,
        `stopka po nagrobku odrzucona: ${replacement.message}`,
      ).toBeUndefined();
      expect(replacement.id).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // (c) Odczyt publiczny: stopka na końcu wbrew zapisanej pozycji
  // -------------------------------------------------------------------

  describe("odczyt publiczny przypina stopkę do końca", () => {
    beforeAll(async () => {
      await admin.from("site_sections").delete().eq("site_id", siteId);

      const hero = await addSection(a, {
        type: "hero",
        position: 1,
        content_draft: { heading: "Pierwszy ekran" },
      });
      const cta = await addSection(a, {
        type: "cta",
        position: 2,
        content_draft: { heading: "Zarezerwuj", buttonLabel: "Katalog", buttonHref: "#produkty" },
      });
      // Stopka z pozycją 0 — stan, którego normalizacja panelu nie zapisze.
      // Bez wymuszenia w odczycie wyszłaby PIERWSZA.
      const footer = await addSection(a, {
        type: "footer",
        position: 0,
        content_draft: FOOTER_CONTENT,
      });
      if (!hero.id || !cta.id || !footer.id) {
        throw new Error(`Nie udało się przygotować strony: ${hero.message ?? cta.message ?? footer.message}`);
      }

      const { error } = await a.ownerClient.schema("app").rpc("publish_site", { p_site_id: siteId });
      if (error) throw new Error(`Publikacja zawiodła: ${error.message}`);
    });

    it("stopka jest OSTATNIA, mimo że ma najniższą pozycję", async () => {
      const { data, error } = await anon
        .schema("app")
        .rpc("get_published_site", { p_tenant_id: a.tenantId });
      expect(error, `RPC zawiodło: ${error?.message}`).toBeNull();

      const payload = data as PublishedSitePayload | null;
      expect(payload, "opublikowana strona nie wróciła").not.toBeNull();

      const types = payload!.sections.map((section) => section.type);
      expect(types.length, "kontrola po pustym zbiorze: strona bez sekcji").toBeGreaterThan(1);
      expect(types.at(-1), `stopka nie jest ostatnia: ${types.join(" > ")}`).toBe("footer");
      // Kontrola pozytywna: to NIE jest zwykłe sortowanie po pozycji — stopka
      // ma pozycję najniższą ze wszystkich.
      const footer = payload!.sections.find((section) => section.type === "footer")!;
      const others = payload!.sections.filter((section) => section.type !== "footer");
      expect(
        others.every((section) => section.position > footer.position),
        "stopka nie miała najniższej pozycji — test nie dowodzi przypięcia",
      ).toBe(true);
    });

    it("kolejność sekcji ZWYKŁYCH dalej idzie po pozycji", async () => {
      // Przypięcie ma przesunąć jedną sekcję, a nie przestawić stronę.
      const payload = (await anon
        .schema("app")
        .rpc("get_published_site", { p_tenant_id: a.tenantId })
        .then((r) => r.data)) as PublishedSitePayload;
      const loose = payload.sections.filter((section) => section.type !== "footer");
      const positions = loose.map((section) => section.position);
      expect(positions, "sekcje zwykłe wyszły nie po pozycji").toEqual([...positions].sort((x, y) => x - y));
    });
  });
});
