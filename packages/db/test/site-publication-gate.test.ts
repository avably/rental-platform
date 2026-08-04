/**
 * PUBLIKACJA JEDYNĄ BRAMKĄ (0045, ADR-091) — gwarancja DWUSTRONNA.
 *
 * Model 0019 trzymał szkic i stan opublikowany w jednym wierszu, ale rozdzielał
 * wyłącznie TREŚĆ. Kolejność (`position`), włączenie (`enabled`), ISTNIENIE
 * wiersza i szablon strony były wspólne — więc reorder, wyłączenie, usunięcie
 * sekcji i zmiana szablonu przestawiały ŻYWĄ stronę klienta natychmiast, bez
 * publikacji. 0045 dokłada bliźniaki `*_published` i znacznik `deleted_in_draft`.
 *
 * Ten plik pilnuje obu stron kontraktu, bo każda z nich psuje się inaczej:
 *
 *   (a) ŻADNA operacja edytora nie zmienia wyniku app.get_published_site przed
 *       publikacją — dowodzone CAŁĄ SESJĄ EDYCYJNĄ (siedem operacji po kolei),
 *       z porównaniem koperty po każdym kroku. Regres jednej kolumny zapala
 *       dokładnie ten krok.
 *   (b) app.publish_site przenosi KOMPLET: treść, kolejność, włączenie, szablon
 *       ORAZ usunięcia (sekcja znika z żywej strony dopiero tu). Test „nie
 *       wycieka" bez tego byłby spełniony także przez funkcję, która nie
 *       publikuje NICZEGO.
 *
 * Do tego: bramki spójności (CHECK-i czynią stan połowiczny niereprezentowalnym),
 * strażnik strukturalny odczytu publicznego (definicja funkcji nie wolno, żeby
 * wspominała kolumny szkicu), izolacja tenantów na nowych kolumnach oraz OKNO
 * WDROŻENIOWE (koperta bajtowo zgodna z odczytem sprzed 0045 dla strony, której
 * szkicu nikt nie ruszył).
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (patrz seed-tenants.ts).
 */
import { parsePublishedSite, structuredPresetFor } from "@avably/core/site";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
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
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_INVALID_PARAMETER_VALUE = "22023";

const sql = process.env.SUPABASE_LOCAL_URL
  ? postgres(process.env.SUPABASE_LOCAL_URL, { max: 1 })
  : null;

// supabase-js zawsze konstruuje klienta Realtime; Node 20 nie ma globalnego
// WebSocket (patrz helpers/seed-tenants.ts). To samo obejście.
const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

interface PublishedSitePayload {
  template: string;
  published_at: string;
  sections: { id: string; type: string; position: number; content: Record<string, unknown> }[];
}

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;

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

/** Koperta widziana przez sklep — jedyna publiczna ścieżka odczytu. */
async function envelope(tenantId: string): Promise<PublishedSitePayload | null> {
  const { data, error } = await anon
    .schema("app")
    .rpc("get_published_site", { p_tenant_id: tenantId });
  if (error) throw new Error(`get_published_site jako anon zawiodło: ${error.message}`);
  return data as PublishedSitePayload | null;
}

async function createSite(ctx: TenantCtx): Promise<string> {
  const { data, error } = await ctx.ownerClient
    .from("sites")
    .insert({ tenant_id: ctx.tenantId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się utworzyć strony: ${error?.message}`);
  return data.id as string;
}

async function addSection(
  ctx: TenantCtx,
  siteId: string,
  row: { type: string; position: number; content_draft: Record<string, unknown> },
): Promise<string> {
  const { data, error } = await ctx.ownerClient
    .from("site_sections")
    .insert({ tenant_id: ctx.tenantId, site_id: siteId, ...row })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się dodać sekcji: ${error?.message}`);
  return data.id as string;
}

async function publish(ctx: TenantCtx, siteId: string): Promise<void> {
  const { error } = await ctx.ownerClient.schema("app").rpc("publish_site", { p_site_id: siteId });
  if (error) throw new Error(`publish_site zawiodło: ${error.message}`);
}

describe.skipIf(!hasEnv)("publikacja jedyną bramką stanu publicznego (0045, ADR-091)", () => {
  let siteAId: string;
  let heroId: string;
  let pricingId: string;
  let faqId: string;

  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();
    ({ a, b } = await seedTwoTenants());

    siteAId = await createSite(a);
    heroId = await addSection(a, siteAId, { type: "hero", position: 0, content_draft: { heading: "Hero" } });
    pricingId = await addSection(a, siteAId, {
      type: "pricing",
      position: 1,
      content_draft: { heading: "Cennik" },
    });
    faqId = await addSection(a, siteAId, { type: "faq", position: 2, content_draft: { heading: "FAQ" } });
    await publish(a, siteAId);
  }, 60_000);

  afterAll(async () => {
    await cleanupSeeded(admin);
    await sql?.end({ timeout: 5 });
  });

  // -------------------------------------------------------------------
  // (a) Sesja edycyjna NIE rusza żywej strony
  // -------------------------------------------------------------------

  it("cała sesja edycyjna nie zmienia koperty ani o bajt — po KAŻDEJ operacji", async () => {
    const baseline = await envelope(a.tenantId);
    expect(baseline, "strona po publikacji nie jest publiczna").not.toBeNull();
    expect(baseline?.sections.map((s) => s.id)).toEqual([heroId, pricingId, faqId]);

    // Każda pozycja to JEDNA operacja edytora — te same zapisy, które wysyła
    // apps/panel/lib/actions/site.ts przez PostgREST.
    const operacje: { nazwa: string; run: () => Promise<void> }[] = [
      {
        nazwa: "upsertSection (treść szkicu)",
        run: async () => {
          const { error } = await a.ownerClient
            .from("site_sections")
            .update({ content_draft: { heading: "Hero PO ZMIANIE" } })
            .eq("tenant_id", a.tenantId)
            .eq("id", heroId);
          expect(error, `zapis treści szkicu: ${error?.message}`).toBeNull();
        },
      },
      {
        nazwa: "reorderSections (odwrócenie kolejności)",
        run: async () => {
          for (const [position, id] of [faqId, pricingId, heroId].entries()) {
            const { error } = await a.ownerClient
              .from("site_sections")
              .update({ position })
              .eq("tenant_id", a.tenantId)
              .eq("site_id", siteAId)
              .eq("id", id);
            expect(error, `reorder: ${error?.message}`).toBeNull();
          }
        },
      },
      {
        nazwa: "toggleSection (wyłączenie)",
        run: async () => {
          const { error } = await a.ownerClient
            .from("site_sections")
            .update({ enabled: false })
            .eq("tenant_id", a.tenantId)
            .eq("id", pricingId);
          expect(error, `wyłączenie: ${error?.message}`).toBeNull();
        },
      },
      {
        nazwa: "deleteSection (znacznik usunięcia w szkicu)",
        run: async () => {
          const { data, error } = await a.ownerClient
            .from("site_sections")
            .update({ deleted_in_draft: true })
            .eq("tenant_id", a.tenantId)
            .eq("id", faqId)
            .select("id");
          expect(error, `usunięcie w szkicu: ${error?.message}`).toBeNull();
          expect(data?.length, "znacznik usunięcia nie zapisał się").toBe(1);
        },
      },
      {
        nazwa: "upsertSection (dodanie sekcji)",
        run: async () => {
          await addSection(a, siteAId, {
            type: "contact",
            position: 3,
            content_draft: { heading: "Kontakt" },
          });
        },
      },
      {
        nazwa: "updateTemplate (szablon strony)",
        run: async () => {
          const { error } = await a.ownerClient
            .from("sites")
            .update({ template: "bold" })
            .eq("tenant_id", a.tenantId)
            .eq("id", siteAId);
          expect(error, `zmiana szablonu: ${error?.message}`).toBeNull();
        },
      },
    ];

    for (const operacja of operacje) {
      await operacja.run();
      expect(
        await envelope(a.tenantId),
        `operacja „${operacja.nazwa}" zmieniła stronę klienta PRZED publikacją`,
      ).toEqual(baseline);
    }
  }, 60_000);

  // -------------------------------------------------------------------
  // (b) Publikacja przenosi KOMPLET — w tym usunięcia
  // -------------------------------------------------------------------

  it("publikacja przenosi treść, kolejność, wyłączenie, szablon ORAZ usunięcie sekcji", async () => {
    await publish(a, siteAId);
    const after = await envelope(a.tenantId);

    expect(after?.template, "szablon nie wszedł razem z publikacją").toBe("bold");

    const ids = after?.sections.map((s) => s.id) ?? [];
    expect(ids, "sekcja usunięta w szkicu przeżyła publikację").not.toContain(faqId);
    expect(ids, "sekcja wyłączona w szkicu przeżyła publikację").not.toContain(pricingId);
    expect(ids[0], "publikacja nie przeniosła nowej kolejności").toBe(heroId);
    expect(after?.sections.find((s) => s.id === heroId)?.content).toEqual({
      heading: "Hero PO ZMIANIE",
    });

    // Sekcja dodana w szkicu wchodzi na stronę TĄ SAMĄ publikacją.
    const kontakt = after?.sections.find((s) => s.type === "contact");
    expect(kontakt?.content, "nowa sekcja nie weszła przy publikacji").toEqual({ heading: "Kontakt" });
  }, 30_000);

  it("wiersz sekcji usuniętej w szkicu znika z bazy dopiero przy publikacji", async () => {
    const { data } = await admin.from("site_sections").select("id").eq("id", faqId);
    expect(data ?? [], "nagrobek nie został sprzątnięty przez publikację").toEqual([]);
  });

  it("przywrócenie przed publikacją zostawia sekcję na stronie", async () => {
    const sectionId = await addSection(a, siteAId, {
      type: "usp",
      position: 9,
      content_draft: { heading: "Atuty" },
    });
    await publish(a, siteAId);
    expect((await envelope(a.tenantId))?.sections.some((s) => s.id === sectionId)).toBe(true);

    await a.ownerClient
      .from("site_sections")
      .update({ deleted_in_draft: true })
      .eq("tenant_id", a.tenantId)
      .eq("id", sectionId);
    const { data: restored, error } = await a.ownerClient
      .from("site_sections")
      .update({ deleted_in_draft: false })
      .eq("tenant_id", a.tenantId)
      .eq("id", sectionId)
      .eq("deleted_in_draft", true)
      .select("id");
    expect(error, `przywrócenie: ${error?.message}`).toBeNull();
    expect(restored?.length, "przywrócenie nie trafiło w nagrobek").toBe(1);

    await publish(a, siteAId);
    expect(
      (await envelope(a.tenantId))?.sections.some((s) => s.id === sectionId),
      "przywrócona sekcja zniknęła mimo cofnięcia usunięcia",
    ).toBe(true);
  }, 30_000);

  // -------------------------------------------------------------------
  // Sekcje strukturalne v3 (E1, ADR-094) — kanał publikacji BEZ MIGRACJI
  // -------------------------------------------------------------------

  describe("treść v3 przechodzi kanałem publikacji CO DO BAJTA", () => {
    /**
     * Stawka: ADR-094 wnosi TRZECIĄ generację treści sekcji do tego samego
     * `jsonb` i obiecuje, że baza nie musi o niej wiedzieć — `publish_site`
     * i `get_published_site` zostają NIETKNIĘTE. Obietnica bez pomiaru jest
     * życzeniem, więc mierzymy dwie rzeczy naraz:
     *
     *   (a) edycja treści v3 w szkicu NIE RUSZA koperty (bramka ADR-091 działa
     *       tak samo dla generacji, o której nie wie);
     *   (b) publikacja przenosi treść v3 co do POLA i co do WARTOŚCI.
     *
     * Porównanie „bajtowe" idzie po formie KANONICZNEJ (klucze posortowane
     * rekurencyjnie), bo `jsonb` normalizuje kolejność kluczy z definicji —
     * porównywanie surowego `JSON.stringify` mierzyłoby kolejność zapisu
     * w teście, a nie wierność przeniesienia.
     */
    const canonical = (value: unknown): string =>
      JSON.stringify(value, (_key, item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)))
          : item,
      );

    let v3Id: string;
    const v3 = structuredPresetFor("faq", "pl") as unknown as Record<string, unknown>;

    it("sekcja v3 zapisuje się do szkicu i NIE pojawia się na żywej stronie", async () => {
      const before = await envelope(a.tenantId);
      v3Id = await addSection(a, siteAId, { type: "faq", position: 20, content_draft: v3 });
      expect(
        await envelope(a.tenantId),
        "sekcja strukturalna weszła na stronę klienta bez publikacji",
      ).toEqual(before);
    }, 30_000);

    it("publikacja przenosi treść v3 co do bajta (forma kanoniczna)", async () => {
      await publish(a, siteAId);
      const section = (await envelope(a.tenantId))?.sections.find((s) => s.id === v3Id);

      expect(section, "sekcja strukturalna nie weszła przy publikacji").toBeDefined();
      expect(section?.content, "publikacja zmieniła kształt treści v3").toEqual(v3);
      expect(
        canonical(section?.content),
        "treść v3 wróciła z bazy inna, niż do niej weszła",
      ).toBe(canonical(v3));
      // Znacznik generacji przeżył podróż jako LICZBA, nie jako napis —
      // rozpoznanie wersji w renderze stoi na `=== 3`.
      expect((section?.content as { v?: unknown }).v).toBe(3);
    }, 30_000);

    it("edycja pary FAQ w szkicu nie rusza koperty aż do publikacji", async () => {
      const baseline = await envelope(a.tenantId);
      const edited = {
        ...v3,
        items: [{ q: "Pytanie po zmianie?", a: "Odpowiedź po zmianie." }],
      };
      const { error } = await a.ownerClient
        .from("site_sections")
        .update({ content_draft: edited })
        .eq("tenant_id", a.tenantId)
        .eq("id", v3Id);
      expect(error, `zapis szkicu v3: ${error?.message}`).toBeNull();
      expect(await envelope(a.tenantId), "edycja v3 wyciekła na żywą stronę").toEqual(baseline);

      await publish(a, siteAId);
      const after = (await envelope(a.tenantId))?.sections.find((s) => s.id === v3Id);
      expect(canonical(after?.content)).toBe(canonical(edited));
    }, 30_000);

    it("odczyt publiczny PARSUJE treść v3 (sekcja nie degraduje się do pominięcia)", async () => {
      // Koperta może nieść cokolwiek — o tym, co zobaczy sklep, rozstrzyga
      // `parsePublishedSite`. Bez tego zdania test wyżej byłby spełniony także
      // wtedy, gdyby storefront odsiewał sekcję v3 jako nieznany kształt.
      const parsed = parsePublishedSite(await envelope(a.tenantId));
      const section = parsed?.sections.find((s) => s.id === v3Id);
      expect(section, "storefront odsiałby sekcję strukturalną jako nieznaną").toBeDefined();
      expect((section?.content as { type?: string }).type).toBe("faq");
    }, 30_000);
  });

  // -------------------------------------------------------------------
  // Bramki spójności — stan połowiczny jest niereprezentowalny
  // -------------------------------------------------------------------

  describe("CHECK-i spójności stanu opublikowanego", () => {
    it("sekcja z treścią opublikowaną, ale bez pozycji/włączenia → 23514", async () => {
      const { error } = await admin.from("site_sections").insert({
        tenant_id: a.tenantId,
        site_id: siteAId,
        type: "hero",
        content_draft: { heading: "X" },
        content_published: { heading: "X" },
      });
      expect(error?.code, `oczekiwano ${PG_CHECK_VIOLATION}: ${error?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );
    });

    it("nagrobek na sekcji NIGDY nieopublikowanej → 23514 (nie ma czego chronić)", async () => {
      const fresh = await addSection(a, siteAId, {
        type: "cta",
        position: 20,
        content_draft: { heading: "Świeża" },
      });
      const { error } = await admin
        .from("site_sections")
        .update({ deleted_in_draft: true })
        .eq("id", fresh);
      expect(error?.code, `oczekiwano ${PG_CHECK_VIOLATION}: ${error?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );
      await admin.from("site_sections").delete().eq("id", fresh);
    });

    it("strona opublikowana bez opublikowanego szablonu → 23514", async () => {
      const { error } = await admin
        .from("sites")
        .update({ template_published: null })
        .eq("id", siteAId);
      expect(error?.code, `oczekiwano ${PG_CHECK_VIOLATION}: ${error?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );
    });
  });

  // -------------------------------------------------------------------
  // Strażnik kolumn opublikowanych — niezmiennik ma ZĘBY W BAZIE
  // -------------------------------------------------------------------
  //
  // Bez tego bloku cały ADR-091 opierałby się na tym, że kod panelu nie pisze
  // po `*_published`. GRANT UPDATE na tabelę ma jednak KAŻDY członek tenanta,
  // więc jedno zapytanie przez PostgREST odtwarzało wyciek, który ta migracja
  // zamyka: `update site_sections set enabled_published = false` zdejmowało
  // sekcję z żywej strony bez publikacji. Werdykt zawsze z TRWAŁEGO stanu
  // (odczyt service-rolem), nie z samego kodu błędu.

  describe("bezpośredni zapis do kolumn opublikowanych (trigger 0045)", () => {
    const PG_INSUFFICIENT_PRIVILEGE = "42501";

    let guardedSiteId: string;
    let guardedSectionId: string;

    beforeAll(async () => {
      const { data: site } = await admin
        .from("sites")
        .select("id")
        .eq("tenant_id", a.tenantId)
        .single();
      guardedSiteId = site!.id as string;
      guardedSectionId = await addSection(a, guardedSiteId, {
        type: "delivery",
        position: 40,
        content_draft: { heading: "Dostawa", text: "Tekst" },
      });
      await publish(a, guardedSiteId);
    }, 30_000);

    it.each([
      { kolumna: "enabled_published", wartosc: false },
      { kolumna: "position_published", wartosc: 999 },
      { kolumna: "content_published", wartosc: { heading: "WSTRZYKNIĘTE" } },
    ])(
      "member NIE zapisze site_sections.$kolumna wprost (42501, stan nietknięty)",
      async ({ kolumna, wartosc }) => {
        const { data: before } = await admin
          .from("site_sections")
          .select("content_published, position_published, enabled_published")
          .eq("id", guardedSectionId)
          .single();

        const { error } = await a.ownerClient
          .from("site_sections")
          .update({ [kolumna]: wartosc })
          .eq("tenant_id", a.tenantId)
          .eq("id", guardedSectionId);

        expect(error, `zapis do ${kolumna} przeszedł — niezmiennik bez zębów`).not.toBeNull();
        expect(error?.code, `oczekiwano ${PG_INSUFFICIENT_PRIVILEGE}: ${error?.message}`).toBe(
          PG_INSUFFICIENT_PRIVILEGE,
        );

        const { data: after } = await admin
          .from("site_sections")
          .select("content_published, position_published, enabled_published")
          .eq("id", guardedSectionId)
          .single();
        expect(after, `stan opublikowany zmieniony mimo odmowy (${kolumna})`).toEqual(before);
      },
    );

    it("member NIE zapisze sites.template_published ani published_at wprost (42501)", async () => {
      const { data: before } = await admin
        .from("sites")
        .select("template_published, published_at")
        .eq("id", guardedSiteId)
        .single();

      // Wartość musi być INNA niż bieżąca — inaczej test przechodziłby przez
      // zapis, który i tak niczego nie zmienia (patrz przypadek niżej).
      const innySzablon = before?.template_published === "bold" ? "classic" : "bold";
      const patches = [
        { template_published: innySzablon },
        { published_at: null },
        { published_at: "2020-01-01T00:00:00.000Z" },
      ];

      for (const patch of patches) {
        const { error } = await a.ownerClient
          .from("sites")
          .update(patch)
          .eq("tenant_id", a.tenantId)
          .eq("id", guardedSiteId);
        expect(error?.code, `${JSON.stringify(patch)}: ${error?.message ?? "brak odmowy"}`).toBe(
          PG_INSUFFICIENT_PRIVILEGE,
        );
      }

      const { data: after } = await admin
        .from("sites")
        .select("template_published, published_at")
        .eq("id", guardedSiteId)
        .single();
      expect(after, "stan opublikowany strony zmieniony mimo odmowy").toEqual(before);
    });

    it("zapis TĄ SAMĄ wartością przechodzi — strażnik broni ZMIANY, nie kolumny", async () => {
      // Świadoma granica: `is distinct from` znaczy, że no-op nie jest odmawiany.
      // Gdyby strażnik blokował każdą wzmiankę o kolumnie, zwykły UPDATE całego
      // wiersza (PostgREST potrafi wysłać komplet pól) padałby bez powodu —
      // a stan opublikowany i tak by się nie zmienił.
      const { data: before } = await admin
        .from("sites")
        .select("template_published")
        .eq("id", guardedSiteId)
        .single();

      const { error } = await a.ownerClient
        .from("sites")
        .update({ template_published: before?.template_published })
        .eq("tenant_id", a.tenantId)
        .eq("id", guardedSiteId);
      expect(error, `no-op odrzucony: ${error?.message}`).toBeNull();

      const { data: after } = await admin
        .from("sites")
        .select("template_published")
        .eq("id", guardedSiteId)
        .single();
      expect(after?.template_published).toBe(before?.template_published);
    });

    it("sekcja nie może URODZIĆ SIĘ opublikowana — INSERT z *_published to 42501", async () => {
      const { error } = await a.ownerClient.from("site_sections").insert({
        tenant_id: a.tenantId,
        site_id: guardedSiteId,
        type: "cta",
        position: 41,
        content_draft: { heading: "X", buttonLabel: "Y", buttonHref: "/" },
        content_published: { heading: "OD RAZU NA ŻYWO" },
        position_published: 41,
        enabled_published: true,
      });
      expect(error?.code, `oczekiwano ${PG_INSUFFICIENT_PRIVILEGE}: ${error?.message}`).toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
    });

    it("zapisy SZKICU idą dalej bez przeszkód — strażnik nie jest kłódką na całą tabelę", async () => {
      const { error } = await a.ownerClient
        .from("site_sections")
        .update({ position: 42, enabled: false, content_draft: { heading: "Szkic", text: "T" } })
        .eq("tenant_id", a.tenantId)
        .eq("id", guardedSectionId);
      expect(error, `zapis szkicu odrzucony: ${error?.message}`).toBeNull();
    });

    it("publikacja NADAL przenosi stan — flaga otwiera strażnika tylko z wnętrza publish_site", async () => {
      await publish(a, guardedSiteId);
      const { data: row } = await admin
        .from("site_sections")
        .select("position_published, enabled_published, content_published")
        .eq("id", guardedSectionId)
        .single();
      expect(row?.position_published, "publikacja nie przeniosła pozycji").toBe(42);
      expect(row?.enabled_published, "publikacja nie przeniosła wyłączenia").toBe(false);
      expect(row?.content_published).toEqual({ heading: "Szkic", text: "T" });

      // Flaga jest zdejmowana w ciele publikacji: kolejny zapis wprost, w tej
      // samej sesji PO udanej publikacji, dalej jest odmawiany.
      const { error } = await a.ownerClient
        .from("site_sections")
        .update({ enabled_published: true })
        .eq("tenant_id", a.tenantId)
        .eq("id", guardedSectionId);
      expect(error?.code, "okno publikacji zostało otwarte na dłużej niż jej ciało").toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
    });
  });

  // -------------------------------------------------------------------
  // Strażnik strukturalny: publiczny odczyt nie zna kolumn szkicu
  // -------------------------------------------------------------------

  it("app.get_published_site nie czyta ANI JEDNEJ kolumny szkicu", async () => {
    const [row] = await sql!<{ def: string }[]>`
      select pg_get_functiondef('app.get_published_site(uuid)'::regprocedure) as def
    `;

    // Bliźniaki znikają najpierw, żeby odwołanie `sec.enabled_published` nie
    // udawało `sec.enabled`. Szukamy ODWOŁAŃ DO KOLUMN (`alias.kolumna`), nie
    // gołych nazw: klucz koperty `'template'` ma zostać, bo to nazwa pola
    // w odpowiedzi, a nie odczyt szkicu.
    const odchudzona = (definicja: string) =>
      definicja
        .replaceAll("content_published", "")
        .replaceAll("position_published", "")
        .replaceAll("enabled_published", "")
        .replaceAll("template_published", "")
        .replaceAll("published_at", "");

    const KOLUMNY_SZKICU = ['."position"', ".enabled", ".template", ".content_draft", ".deleted_in_draft"];

    const czysta = odchudzona(row!.def);
    for (const kolumna of KOLUMNY_SZKICU) {
      expect(czysta, `odczyt publiczny sięga po kolumnę szkicu ${kolumna}`).not.toContain(kolumna);
    }

    // KONTROLA POZYTYWNA: ten sam skan puszczony na ciało sprzed 0045 musi
    // zapalić się na trzech kolumnach — inaczej test przechodziłby przez
    // pustkę, a nie przez dowód.
    const cialo0019 = `
      select jsonb_build_object('template', s.template, 'sections', (
        select jsonb_agg(jsonb_build_object('position', sec."position", 'content', sec.content_published)
        order by sec."position", sec.id)
        from public.site_sections sec where sec.enabled and sec.content_published is not null))
      from public.sites s`;
    const trafienia = KOLUMNY_SZKICU.filter((kolumna) => odchudzona(cialo0019).includes(kolumna));
    expect(trafienia.sort(), "skan nie wykrywa odczytu szkicu — dowód byłby pusty").toEqual(
      ['."position"', ".enabled", ".template"].sort(),
    );
  });

  // -------------------------------------------------------------------
  // Okno wdrożeniowe: koperta bajtowo zgodna z odczytem sprzed 0045
  // -------------------------------------------------------------------

  it("dla strony bez zmian szkicu koperta jest BAJTOWO zgodna z odczytem sprzed 0045", async () => {
    // Świeży tenant: strona opublikowana i od tej pory NIETKNIĘTA — dokładnie
    // sytuacja produkcyjnej strony w oknie między migracją a deployem kodu.
    const siteBId = await createSite(b);
    await addSection(b, siteBId, { type: "hero", position: 0, content_draft: { heading: "B hero" } });
    await addSection(b, siteBId, {
      type: "gallery",
      position: 5,
      content_draft: { heading: "B galeria" },
    });
    await publish(b, siteBId);

    // Replika ciała funkcji Z 0019 (czyta kolumny WSPÓLNE) — to jest odpowiedź,
    // którą sklep dostawał przed migracją.
    const [stare] = await sql!<{ envelope: unknown }[]>`
      select jsonb_build_object(
        'template', s.template,
        'published_at', s.published_at,
        'sections', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', sec.id,
                'type', sec.type,
                'position', sec."position",
                'content', sec.content_published
              )
              order by sec."position", sec.id
            )
            from public.site_sections sec
            where sec.tenant_id = s.tenant_id
              and sec.site_id = s.id
              and sec.enabled
              and sec.content_published is not null
          ),
          '[]'::jsonb
        )
      ) as envelope
      from public.sites s
      join public.tenants t on t.id = s.tenant_id
      where s.tenant_id = ${b.tenantId}
        and s.published_at is not null
        and t.status in ('trialing', 'active')
    `;

    const [nowe] = await sql!<{ envelope: unknown }[]>`
      select app.get_published_site(${b.tenantId}) as envelope
    `;

    expect(stare?.envelope, "replika odczytu sprzed 0045 nic nie zwróciła").not.toBeNull();
    // Porównanie tekstem, nie tylko strukturą: „bajtowo zgodna" znaczy też te
    // same klucze w tej samej kolejności i te same typy liczb.
    expect(JSON.stringify(nowe?.envelope)).toBe(JSON.stringify(stare?.envelope));
  }, 30_000);

  // -------------------------------------------------------------------
  // Izolacja na NOWYCH kolumnach
  // -------------------------------------------------------------------


  // -------------------------------------------------------------------
  // (e) MODEL STRON (0048, ADR-093) — wiele wersji, jedna ŻYWA
  // -------------------------------------------------------------------
  //
  // Model stron dokłada trzy operacje, których kanon ADR-091 dotąd nie znał:
  // utworzenie wersji, PRZEŁĄCZENIE żywej strony i usunięcie wersji. Każda
  // z nich jest mierzona tą samą miarą, co reszta tego pliku — KOPERTĄ, którą
  // widzi sklep. Rozumowanie z ADR-093 („strona z published_at is null nie
  // wnosi do koperty ani bajtu") jest tu zamienione na pomiar.

  describe("wiele wersji strony, najwyżej jedna żywa", () => {
    let wersjaId: string;

    afterAll(async () => {
      // Sprzątanie: zostawiamy tenanta A dokładnie z jedną, żywą stroną.
      await admin.from("site_sections").delete().eq("site_id", wersjaId);
      await admin.from("sites").delete().eq("id", wersjaId);
    });

    it("utworzenie DRUGIEJ wersji i praca na niej nie ruszają koperty ani o bajt", async () => {
      const baseline = await envelope(a.tenantId);
      expect(baseline, "strona A nie jest publiczna — nie ma czego bronić").not.toBeNull();

      const { data, error } = await a.ownerClient
        .from("sites")
        .insert({ tenant_id: a.tenantId, name: "Wersja jesienna" })
        .select("id")
        .single();
      expect(error, `utworzenie drugiej wersji odrzucone: ${error?.message}`).toBeNull();
      wersjaId = data!.id as string;
      expect(await envelope(a.tenantId), "utworzenie wersji zmieniło stronę klienta").toEqual(baseline);

      // Pełna sesja edycyjna na wersji roboczej — każda operacja osobno.
      const operacje: { nazwa: string; run: () => Promise<void> }[] = [
        {
          nazwa: "dodanie sekcji",
          run: async () => {
            await addSection(a, wersjaId, {
              type: "hero",
              position: 0,
              content_draft: { heading: "Zupełnie inna strona" },
            });
          },
        },
        {
          nazwa: "druga sekcja",
          run: async () => {
            await addSection(a, wersjaId, {
              type: "contact",
              position: 1,
              content_draft: { heading: "Kontakt wersji roboczej" },
            });
          },
        },
        {
          nazwa: "zmiana stylu wersji",
          run: async () => {
            const { error: styleError } = await a.ownerClient
              .from("sites")
              .update({ style_draft: { theme: "confetti" } })
              .eq("tenant_id", a.tenantId)
              .eq("id", wersjaId);
            expect(styleError, `styl wersji: ${styleError?.message}`).toBeNull();
          },
        },
        {
          nazwa: "zmiana nazwy wersji",
          run: async () => {
            const { error: nameError } = await a.ownerClient
              .from("sites")
              .update({ name: "Wersja jesienna v2" })
              .eq("tenant_id", a.tenantId)
              .eq("id", wersjaId);
            expect(nameError, `nazwa wersji: ${nameError?.message}`).toBeNull();
          },
        },
      ];

      for (const operacja of operacje) {
        await operacja.run();
        expect(
          await envelope(a.tenantId),
          `operacja „${operacja.nazwa}" na WERSJI ROBOCZEJ zmieniła stronę klienta`,
        ).toEqual(baseline);
      }
    }, 60_000);

    it("wersja NIE MOŻE urodzić się żywa — INSERT z published_at to 42501", async () => {
      // Bez tego „wersja rodzi się nieżywa" byłoby konwencją panelu, a nie
      // regułą: strażnik bliźniaków (0045) obejmuje `published_at` wprost.
      const { error } = await a.ownerClient.from("sites").insert({
        tenant_id: a.tenantId,
        name: "Od razu publiczna",
        published_at: new Date().toISOString(),
        template_published: "classic",
      });
      expect(error?.code, `oczekiwano ${PG_INSUFFICIENT_PRIVILEGE}: ${error?.message}`).toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
    });

    it("PRZEŁĄCZENIE: publikacja wersji zmienia kopertę RAZ i bez miksu dwóch stron", async () => {
      const przed = await envelope(a.tenantId);
      const sekcjeStarej = new Set((przed?.sections ?? []).map((s) => s.id));
      expect(sekcjeStarej.size, "kontrola po pustym zbiorze: stara strona bez sekcji").toBeGreaterThan(0);

      await publish(a, wersjaId);

      const po = await envelope(a.tenantId);
      expect(po, "po przełączeniu sklep nie ma strony").not.toBeNull();

      // (1) Zmiana nastąpiła.
      expect(po).not.toEqual(przed);
      // (2) ANI JEDNEJ sekcji starej strony — to jest dowód braku miksu.
      const wspolne = (po?.sections ?? []).filter((s) => sekcjeStarej.has(s.id));
      expect(wspolne, `koperta niesie sekcje OBU stron: ${wspolne.map((s) => s.id).join(", ")}`).toEqual([]);
      // (3) Treść jest treścią wersji.
      expect(po?.sections.map((s) => s.type)).toEqual(["hero", "contact"]);

      // (4) Stara strona przestała być żywa, ale ZACHOWAŁA bliźniaki (ADR-093 D2).
      const { data: stara } = await admin
        .from("sites")
        .select("published_at, template_published, style_published")
        .eq("id", siteAId)
        .single();
      expect(stara?.published_at, "stara strona dalej jest żywa — dwie żywe naraz").toBeNull();
      expect(stara?.template_published, "bliźniak szablonu wyczyszczony przy zdejmowaniu").not.toBeNull();

      const { count } = await admin
        .from("site_sections")
        .select("id", { count: "exact", head: true })
        .eq("site_id", siteAId)
        .not("content_published", "is", null);
      expect(count, "bliźniaki sekcji starej strony zniknęły").toBeGreaterThan(0);
    }, 60_000);

    it("dwie ŻYWE strony są NIEREPREZENTOWALNE — nawet rolą serwisową (23505)", async () => {
      // Rola serwisowa omija strażnika bliźniaków, więc to jest dowód na
      // poziomie DANYCH: niezmiennik trzyma po obejściu całej aplikacji.
      const { error } = await admin
        .from("sites")
        .update({ published_at: new Date().toISOString(), template_published: "classic" })
        .eq("id", siteAId);
      expect(error?.code, `oczekiwano ${PG_UNIQUE_VIOLATION}: ${error?.message}`).toBe(PG_UNIQUE_VIOLATION);
      expect(error?.message).toContain("sites_one_live_per_tenant_idx");
    });

    it("USUNIĘCIE strony nieżywej nie rusza koperty ani o bajt", async () => {
      const baseline = await envelope(a.tenantId);

      const { error } = await a.ownerClient
        .from("sites")
        .delete()
        .eq("tenant_id", a.tenantId)
        .eq("id", siteAId);
      expect(error, `usunięcie nieżywej strony odrzucone: ${error?.message}`).toBeNull();

      const { data: po } = await admin.from("sites").select("id").eq("id", siteAId).maybeSingle();
      expect(po, "strona nieżywa nie została usunięta").toBeNull();
      expect(await envelope(a.tenantId), "usunięcie NIEŻYWEJ strony zmieniło stronę klienta").toEqual(
        baseline,
      );
    }, 60_000);

    it("USUNIĘCIA strony ŻYWEJ odmawia BAZA (42501), koperta nietknięta", async () => {
      const baseline = await envelope(a.tenantId);

      const { error } = await a.ownerClient
        .from("sites")
        .delete()
        .eq("tenant_id", a.tenantId)
        .eq("id", wersjaId);
      expect(error?.code, `oczekiwano ${PG_INSUFFICIENT_PRIVILEGE}: ${error?.message}`).toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );

      // Werdykt z TRWAŁEGO stanu, nie ze zwrotu: wiersz stoi, sklep bez zmian.
      const { data: dalej } = await admin.from("sites").select("id").eq("id", wersjaId).maybeSingle();
      expect(dalej?.id, "żywa strona zniknęła mimo odmowy").toBe(wersjaId);
      expect(await envelope(a.tenantId), "odmowa i tak ruszyła stronę klienta").toEqual(baseline);
    }, 60_000);
  });

  describe("izolacja tenantów na kolumnach 0045", () => {
    let siteBId: string;
    let sectionBId: string;

    beforeAll(async () => {
      const { data } = await admin.from("sites").select("id").eq("tenant_id", b.tenantId).maybeSingle();
      siteBId = (data?.id as string) ?? (await createSite(b));
      sectionBId = await addSection(b, siteBId, {
        type: "cta",
        position: 30,
        content_draft: { heading: "B cta" },
      });
      await publish(b, siteBId);
    }, 30_000);

    it("owner A nie oznaczy sekcji tenanta B jako usuniętej (RLS: zero wierszy, stan B nietknięty)", async () => {
      const { data, error } = await a.ownerClient
        .from("site_sections")
        .update({ deleted_in_draft: true })
        .eq("id", sectionBId)
        .select("id");
      expect(error, `oczekiwano cichej odmowy RLS, nie błędu: ${error?.message}`).toBeNull();
      expect(data ?? [], "tenant A oznaczył cudzą sekcję").toEqual([]);

      const { data: after } = await admin
        .from("site_sections")
        .select("deleted_in_draft")
        .eq("id", sectionBId)
        .single();
      expect(after?.deleted_in_draft, "znacznik usunięcia u tenanta B zmienił się").toBe(false);
    });

    it("owner A nie opublikuje strony B — nagrobek B zostaje nietknięty (22023)", async () => {
      await admin.from("site_sections").update({ deleted_in_draft: true }).eq("id", sectionBId);

      const { error } = await a.ownerClient
        .schema("app")
        .rpc("publish_site", { p_site_id: siteBId });
      expect(error?.code, `oczekiwano ${PG_INVALID_PARAMETER_VALUE}: ${error?.message}`).toBe(
        PG_INVALID_PARAMETER_VALUE,
      );

      // Werdykt z TRWAŁEGO stanu: cudza publikacja nie skasowała wiersza B.
      const { data: after } = await admin
        .from("site_sections")
        .select("id, deleted_in_draft")
        .eq("id", sectionBId)
        .maybeSingle();
      expect(after?.id, "cudza publikacja skasowała sekcję tenanta B").toBe(sectionBId);
      expect(after?.deleted_in_draft).toBe(true);

      await admin.from("site_sections").update({ deleted_in_draft: false }).eq("id", sectionBId);
    });
  });
});
