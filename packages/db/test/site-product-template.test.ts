/**
 * SZABLON STRONY PRODUKTU — migracja 0080, ADR-178.
 *
 * Faza 5 daje najemcy WIERSZ, który jest szablonem strony pojedynczego sprzętu,
 * i ŚCIEŻKĘ ODCZYTU, którą sklep go bierze. Silnik wiązań stoi w repo od fazy 3
 * (`pageProduct`), więc cała nowość po stronie bazy to rola wiersza i jej
 * konsekwencje.
 *
 * Dziewięć osi, każda mierzona TYM, CO WIDZI KLIENT (koperty `app.get_*`
 * kluczem anona), a nie stanem wiersza:
 *
 *   1. LUSTRO ROLI. Zbiór wartości `sites.kind` w bazie równa się `SITE_KINDS`
 *      z rdzenia — mierzone ZACHOWANIEM (każda wartość z listy przechodzi,
 *      wartość spoza niej pada 23514), a nie odczytem tekstu CHECK-a.
 *
 *   2. SZABLON NIE MA ADRESU. CHECK odrzuca szablon ze slugiem, w obu
 *      kolumnach. Bez tego panel mógłby pokazać ścieżkę, pod którą nic nie stoi.
 *
 *   3. ROLA JEST NIEZMIENNA. To jest DRUGA POŁOWA decyzji „rola nie dostaje
 *      bliźniaka *_published": gdyby dało się ją zmienić, żywa strona główna
 *      przełączona na szablon znikałaby z korzenia sklepu i stawała się
 *      szablonem wszystkich stron sprzętu — dwie zmiany widoczne publicznie
 *      bez ani jednego zdarzenia publikacji.
 *
 *   4. STRONA GŁÓWNA I SZABLON WSPÓŁISTNIEJĄ ŻYWE. Oba mają pusty
 *      `slug_published`, więc unikat z 0073 musiał ustąpić — a to jest zmiana,
 *      która najłatwiej cofa się przy refaktorze.
 *
 *   5. JEDEN ŻYWY SZABLON NA NAJEMCĘ. Drugi pada 23505 — nie dlatego, że
 *      aplikacja go nie wyśle, tylko dlatego, że baza go nie przyjmie.
 *
 *   6. ODCZYT PO ADRESIE NIE WIDZI SZABLONU. Najostrzejsza oś: gdyby widział,
 *      korzeń sklepu trafiałby w dwa wiersze, a funkcja `language sql` cicho
 *      oddałaby pierwszy z niesortowanego skanu (zmierzone przed 0048 — to nie
 *      jest hipoteza). Klient dostawałby raz stronę główną, raz szablon.
 *
 *   7. REJESTR ADRESÓW NIE WIDZI SZABLONU. Inaczej proxy uznałoby `/` za
 *      istniejącą stronę u najemcy, który ma sam szablon.
 *
 *   8. SZABLON NIEOPUBLIKOWANY NIE WYCHODZI DO SKLEPU W OGÓLE, a opublikowany
 *      wychodzi ze swoją treścią — także wtedy, gdy jest pusty (granica biegnie
 *      po PUBLIKACJI, nie po zawartości).
 *
 *   9. IZOLACJA. Szablon najemcy A nie ma jak wyjść na sklep najemcy B —
 *      ani treścią, ani jednym bajtem. Bramką jest jawne zawężenie w CIELE
 *      funkcji (SECURITY DEFINER, więc RLS w niej nie uczestniczy), więc oś ma
 *      osobny strażnik strukturalny z kontrolą pozytywną.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PAGE_SITE_KIND, PRODUCT_TEMPLATE_SITE_KIND, SITE_KINDS } from "@avably/core/site";

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

/** 23505 = unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";
/** 23514 = check_violation. */
const PG_CHECK_VIOLATION = "23514";
/** 42501 = insufficient_privilege — odmowa RLS, grantu albo strażnika. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";

const TEST_PASSWORD = "ProductTemplate!12345678";

interface PageRegistry {
  pages: string[];
  redirects: { from: string; to: string }[];
}

interface Envelope {
  template: string;
  published_at: string;
  sections: { id: string; type: string; position: number; content: unknown }[];
  style?: unknown;
  logo?: unknown;
}

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

describe.skipIf(!hasEnv)("szablon strony produktu — 0080 (ADR-178)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  async function seedTenant(label: string): Promise<string> {
    const slug = `tmpl-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Szablon ${label}`, status: "active", locale: "pl" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed tenanta: ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  async function ownerClient(tenantId: string): Promise<SupabaseClient> {
    const email = `tmpl-${randomUUID().slice(0, 8)}@test.local`;
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

  /**
   * Strona albo szablon — jedna fabryka, bo różnica jest JEDNĄ kolumną i tak ma
   * wyglądać w kodzie wołającego.
   *
   * `heading` jedzie do treści sekcji, żeby koperta miała czym się różnić od
   * pustej — bez tego asercja „to jest szablon A, a nie strona główna A"
   * porównywałaby dwa nierozróżnialne kształty.
   */
  async function createSite(
    owner: SupabaseClient,
    tenantId: string,
    options: { kind?: string; slug?: string; heading?: string; sections?: boolean } = {},
  ): Promise<string> {
    const kind = options.kind ?? PAGE_SITE_KIND;
    const { data, error } = await owner
      .from("sites")
      .insert({
        tenant_id: tenantId,
        name: `Wiersz ${kind} ${randomUUID().slice(0, 6)}`,
        slug: options.slug ?? "",
        kind,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert sites (${kind}): ${error?.message}`);

    if (options.sections !== false) {
      const { error: sectionError } = await admin.from("site_sections").insert({
        tenant_id: tenantId,
        site_id: data.id as string,
        type: "hero",
        position: 0,
        content_draft: { heading: options.heading ?? `Nagłówek ${kind}` },
      });
      if (sectionError) throw new Error(`insert site_sections: ${sectionError.message}`);
    }
    return data.id as string;
  }

  async function publish(owner: SupabaseClient, siteId: string): Promise<void> {
    const { error } = await owner.schema("app").rpc("publish_site", { p_site_id: siteId });
    if (error) throw new Error(`publish_site: ${error.message}`);
  }

  /** To, co widzi KLIENT pod adresem — kluczem anona, drogą storefrontu. */
  async function publicPage(tenantId: string, slug: string): Promise<Envelope | null> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_published_page", { p_tenant_id: tenantId, p_slug: slug });
    if (error) throw new Error(`get_published_page: ${error.message}`);
    return (data as Envelope | null) ?? null;
  }

  /** To, co widzi KLIENT na stronie sprzętu — ta sama droga, co w sklepie. */
  async function publicTemplate(tenantId: string): Promise<Envelope | null> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_published_product_template", { p_tenant_id: tenantId });
    if (error) throw new Error(`get_published_product_template: ${error.message}`);
    return (data as Envelope | null) ?? null;
  }

  async function registry(tenantId: string): Promise<PageRegistry | null> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_tenant_pages", { p_tenant_id: tenantId });
    if (error) throw new Error(`get_tenant_pages: ${error.message}`);
    return (data as PageRegistry | null) ?? null;
  }

  /** Nagłówki sekcji koperty — najkrótsze zdanie o TREŚCI, którą klient dostał. */
  function headings(envelope: Envelope | null): string[] {
    return (envelope?.sections ?? []).map(
      (section) => (section.content as { heading?: string } | null)?.heading ?? "",
    );
  }

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    await sql?.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Lustro roli (anty-rozjazd TS ↔ baza)
  // -------------------------------------------------------------------
  describe("zbiór ról w bazie równa się SITE_KINDS z rdzenia", () => {
    let tenantId: string;
    let owner: SupabaseClient;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("lustro");
      owner = await ownerClient(tenantId);
    }, 60_000);

    it("KAŻDA rola z listy rdzenia jest zapisywalna", async () => {
      expect(SITE_KINDS.length, "pusta lista ról — czujnik po pustym zbiorze").toBeGreaterThan(1);

      for (const kind of SITE_KINDS) {
        const { data, error } = await owner
          .from("sites")
          .insert({
            tenant_id: tenantId,
            name: `Lustro ${kind}`,
            slug: "",
            kind,
          })
          .select("id, kind")
          .single();
        expect(error, `rola „${kind}" z rdzenia odrzucona przez bazę`).toBeNull();
        expect(data?.kind).toBe(kind);
        if (data) await admin.from("sites").delete().eq("id", data.id as string);
      }
    });

    it("rola SPOZA listy pada na CHECK-u (23514), a nie wchodzi po cichu", async () => {
      const { error } = await owner
        .from("sites")
        .insert({ tenant_id: tenantId, name: "Rola z kosmosu", slug: "", kind: "category" });
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });

    it("rola pominięta = `page` (wartość zastana każdego wiersza sprzed 0080)", async () => {
      const { data, error } = await owner
        .from("sites")
        .insert({ tenant_id: tenantId, name: "Bez roli", slug: "bez-roli" })
        .select("id, kind")
        .single();
      expect(error).toBeNull();
      expect(data?.kind).toBe(PAGE_SITE_KIND);
      if (data) await admin.from("sites").delete().eq("id", data.id as string);
    });
  });

  // -------------------------------------------------------------------
  // 2. Szablon nie ma adresu
  // -------------------------------------------------------------------
  describe("szablon nie ma adresu i nie ma jak go dostać", () => {
    let tenantId: string;
    let owner: SupabaseClient;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("adres");
      owner = await ownerClient(tenantId);
    }, 60_000);

    it("szablon z niepustym slugiem pada na CHECK-u (23514)", async () => {
      const { error } = await owner.from("sites").insert({
        tenant_id: tenantId,
        name: "Szablon z adresem",
        slug: "sprzet",
        kind: PRODUCT_TEMPLATE_SITE_KIND,
      });
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });

    it("KONTROLA POZYTYWNA: ten sam slug w roli `page` przechodzi", async () => {
      const { data, error } = await owner
        .from("sites")
        .insert({
          tenant_id: tenantId,
          name: "Strona z adresem",
          slug: "sprzet",
          kind: PAGE_SITE_KIND,
        })
        .select("id")
        .single();
      expect(error, "CHECK odrzuca wszystko — dowód byłby pusty").toBeNull();
      if (data) await admin.from("sites").delete().eq("id", data.id as string);
    });

    it("szablonowi nie da się dopisać adresu także PÓŹNIEJ (UPDATE)", async () => {
      const siteId = await createSite(owner, tenantId, { kind: PRODUCT_TEMPLATE_SITE_KIND });
      const { error } = await owner.from("sites").update({ slug: "sprzet-2" }).eq("id", siteId);
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
      await admin.from("sites").delete().eq("id", siteId);
    });
  });

  // -------------------------------------------------------------------
  // 3. Rola jest niezmienna
  // -------------------------------------------------------------------
  describe("roli nie da się zmienić po utworzeniu wiersza", () => {
    let tenantId: string;
    let owner: SupabaseClient;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("niezmienna");
      owner = await ownerClient(tenantId);
    }, 60_000);

    it("ŻYWA STRONA GŁÓWNA nie da się przełączyć w szablon (42501)", async () => {
      // Ta jedna asercja jest powodem, dla którego bramka w ogóle istnieje:
      // CHECK z osi 2 przepuszcza stronę główną (slug pusty), więc bez triggera
      // korzeń sklepu gaśnie i cały katalog dostaje nowy szablon — jednym
      // UPDATE-em, bez zdarzenia publikacji.
      const homeId = await createSite(owner, tenantId, { slug: "" });
      await publish(owner, homeId);

      const { error } = await owner
        .from("sites")
        .update({ kind: PRODUCT_TEMPLATE_SITE_KIND })
        .eq("id", homeId);
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);

      // SKUTEK, nie tylko odmowa: korzeń sklepu dalej oddaje stronę główną.
      const root = await publicPage(tenantId, "");
      expect(root).not.toBeNull();
      expect(await publicTemplate(tenantId), "szablon powstał mimo odmowy").toBeNull();
    });

    it("SZABLON nie da się przełączyć w stronę (42501)", async () => {
      const templateId = await createSite(owner, tenantId, {
        kind: PRODUCT_TEMPLATE_SITE_KIND,
      });
      const { error } = await owner
        .from("sites")
        .update({ kind: PAGE_SITE_KIND })
        .eq("id", templateId);
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
      await admin.from("sites").delete().eq("id", templateId);
    });

    it("KONTROLA POZYTYWNA: UPDATE NIERUSZAJĄCY roli przechodzi", async () => {
      // Bez tej nogi „wszystko odmawiane" wyglądałoby jak działająca bramka.
      const siteId = await createSite(owner, tenantId, { slug: "kontakt" });
      const { data, error } = await owner
        .from("sites")
        .update({ name: "Nazwa po zmianie" })
        .eq("id", siteId)
        .select("id");
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(1);
      await admin.from("sites").delete().eq("id", siteId);
    });
  });

  // -------------------------------------------------------------------
  // 4 + 5. Niezmienniki żywych wierszy
  // -------------------------------------------------------------------
  describe("niezmienniki: strona główna obok szablonu, ale szablon tylko jeden", () => {
    let tenantId: string;
    let owner: SupabaseClient;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("unikaty");
      owner = await ownerClient(tenantId);
    }, 60_000);

    it("ŻYWA strona główna i ŻYWY szablon współistnieją (unikat z 0073 ustąpił)", async () => {
      const homeId = await createSite(owner, tenantId, { slug: "", heading: "Witamy" });
      await publish(owner, homeId);

      const templateId = await createSite(owner, tenantId, {
        kind: PRODUCT_TEMPLATE_SITE_KIND,
        heading: "Karta sprzętu",
      });
      // Gdyby unikat z 0073 nie ustąpił, TA publikacja padłaby 23505: oba
      // wiersze mają pusty `slug_published`.
      await publish(owner, templateId);

      expect(headings(await publicPage(tenantId, ""))).toEqual(["Witamy"]);
      expect(headings(await publicTemplate(tenantId))).toEqual(["Karta sprzętu"]);
    });

    it("DRUGI żywy szablon pada 23505", async () => {
      const secondId = await createSite(owner, tenantId, {
        kind: PRODUCT_TEMPLATE_SITE_KIND,
        heading: "Drugi szablon",
      });
      const { error } = await owner.schema("app").rpc("publish_site", { p_site_id: secondId });
      expect(error?.code).toBe(PG_UNIQUE_VIOLATION);

      // SKUTEK: klient dalej dostaje pierwszy szablon, a nie losowy z dwóch.
      expect(headings(await publicTemplate(tenantId))).toEqual(["Karta sprzętu"]);
      await admin.from("sites").delete().eq("id", secondId);
    });

    it("dwa SZKICE szablonu to dla bazy stan legalny (unikat dotyczy żywych)", async () => {
      // Niezmiennik jest CZĘŚCIOWY świadomie — wersje robocze mają prawo
      // współistnieć. Przed drugim szkicem broni panel, a nie baza, i ta
      // asercja przypina tę granicę, żeby nikt nie „naprawił" jej w migracji.
      const draftId = await createSite(owner, tenantId, {
        kind: PRODUCT_TEMPLATE_SITE_KIND,
        heading: "Szkic obok",
      });
      expect(draftId).toBeTruthy();
      await admin.from("sites").delete().eq("id", draftId);
    });
  });

  // -------------------------------------------------------------------
  // 6 + 7. Szablon nie udaje strony pod adresem
  // -------------------------------------------------------------------
  describe("odczyt po adresie i rejestr adresów nie widzą szablonu", () => {
    let tenantId: string;
    let owner: SupabaseClient;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("adresy");
      owner = await ownerClient(tenantId);
      const templateId = await createSite(owner, tenantId, {
        kind: PRODUCT_TEMPLATE_SITE_KIND,
        heading: "Karta sprzętu",
      });
      await publish(owner, templateId);
    }, 60_000);

    it("najemca Z SAMYM szablonem ma PUSTY korzeń sklepu", async () => {
      // Najostrzejsza asercja pliku. Szablon ma pusty `slug_published`, więc
      // bez warunku po roli TO WYWOŁANIE oddałoby jego treść pod `/`.
      expect(await publicPage(tenantId, "")).toBeNull();
    });

    it("najemca Z SAMYM szablonem ma PUSTY rejestr adresów", async () => {
      const pages = await registry(tenantId);
      expect(pages?.pages ?? null).toEqual([]);
    });

    it("KONTROLA POZYTYWNA: szablon JEST widoczny własną ścieżką odczytu", async () => {
      // Bez tej nogi obie asercje wyżej byłyby spełnione także przez szablon,
      // którego publikacja się nie udała — czyli przez pustkę.
      expect(headings(await publicTemplate(tenantId))).toEqual(["Karta sprzętu"]);
    });

    it("strona treściowa DALEJ wchodzi do rejestru i pod swój adres", async () => {
      const contactId = await createSite(owner, tenantId, {
        slug: "kontakt",
        heading: "Kontakt",
      });
      await publish(owner, contactId);

      expect(headings(await publicPage(tenantId, "kontakt"))).toEqual(["Kontakt"]);
      expect((await registry(tenantId))?.pages).toEqual(["kontakt"]);
    });
  });

  // -------------------------------------------------------------------
  // 8. Granica biegnie po PUBLIKACJI, nie po zawartości
  // -------------------------------------------------------------------
  describe("szablon wychodzi do sklepu dopiero po publikacji", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let templateId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("publikacja");
      owner = await ownerClient(tenantId);
      templateId = await createSite(owner, tenantId, {
        kind: PRODUCT_TEMPLATE_SITE_KIND,
        heading: "Karta sprzętu",
      });
    }, 60_000);

    it("szablon NIEOPUBLIKOWANY nie wychodzi do sklepu ani jednym bajtem", async () => {
      const envelope = await publicTemplate(tenantId);
      expect(envelope).toBeNull();

      // Zdanie mocniejsze niż `toBeNull`: treść szkicu nie pojawia się NIGDZIE
      // w odpowiedzi — ani pod innym kluczem, ani w kopercie strony.
      const surowa = JSON.stringify({
        template: envelope,
        root: await publicPage(tenantId, ""),
        registry: await registry(tenantId),
      });
      expect(surowa).not.toContain("Karta sprzętu");
    });

    it("po publikacji szablon wychodzi ze swoją treścią", async () => {
      await publish(owner, templateId);
      expect(headings(await publicTemplate(tenantId))).toEqual(["Karta sprzętu"]);
    });

    it("PUSTY opublikowany szablon jest kopertą z zerem sekcji, a NIE brakiem szablonu", async () => {
      /*
        Granica biegnie po PUBLIKACJI, nie po zawartości (ADR-178 R2). Sklep
        rozstrzyga „szablon czy strona wbudowana" po `null`, więc pusty szablon
        MUSI oddać kopertę — inaczej operator publikuje pustą stronę i dalej
        widzi stronę wbudowaną, czyli dokładnie to kłamstwo interfejsu, które
        zamknęły ADR-171 i ADR-172.
      */
      const pustyTenant = await seedTenant("pusty");
      const pustyOwner = await ownerClient(pustyTenant);
      const pustyId = await createSite(pustyOwner, pustyTenant, {
        kind: PRODUCT_TEMPLATE_SITE_KIND,
        sections: false,
      });
      await publish(pustyOwner, pustyId);

      const envelope = await publicTemplate(pustyTenant);
      expect(envelope, "pusty szablon oddał null — sklep pokazałby stronę wbudowaną").not.toBeNull();
      expect(envelope?.sections).toEqual([]);
    });

    it("po zdjęciu ze sklepu szablon znika, a wiersz zostaje (ADR-093 D2)", async () => {
      const { error } = await owner
        .schema("app")
        .rpc("unpublish_site", { p_site_id: templateId });
      expect(error).toBeNull();
      expect(await publicTemplate(tenantId)).toBeNull();

      const [row] = await sql!<{ kind: string; slug_published: string | null }[]>`
        select kind, slug_published from public.sites where id = ${templateId}
      `;
      expect(row?.kind).toBe(PRODUCT_TEMPLATE_SITE_KIND);
      expect(row?.slug_published).toBe("");
    });
  });

  // -------------------------------------------------------------------
  // 9. Izolacja najemców
  // -------------------------------------------------------------------
  describe("izolacja: szablon najemcy A nie wychodzi na sklep najemcy B", () => {
    let tenantA: string;
    let tenantB: string;
    let ownerA: SupabaseClient;
    let ownerB: SupabaseClient;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantA = await seedTenant("izolacja-a");
      tenantB = await seedTenant("izolacja-b");
      ownerA = await ownerClient(tenantA);
      ownerB = await ownerClient(tenantB);

      const szablonA = await createSite(ownerA, tenantA, {
        kind: PRODUCT_TEMPLATE_SITE_KIND,
        heading: "SZABLON-NAJEMCY-A",
      });
      await publish(ownerA, szablonA);

      const szablonB = await createSite(ownerB, tenantB, {
        kind: PRODUCT_TEMPLATE_SITE_KIND,
        heading: "SZABLON-NAJEMCY-B",
      });
      await publish(ownerB, szablonB);
    }, 90_000);

    it("odczyt w kontekście B nie niesie ANI JEDNEGO BAJTU szablonu A", async () => {
      const envelope = await publicTemplate(tenantB);
      expect(headings(envelope)).toEqual(["SZABLON-NAJEMCY-B"]);

      // Skan po CAŁEJ surowej odpowiedzi, nie po wybranym polu: wyciek pod
      // nieoczekiwanym kluczem przeszedłby przez asercję o nagłówkach.
      expect(JSON.stringify(envelope)).not.toContain("SZABLON-NAJEMCY-A");
    });

    it("KONTROLA POZYTYWNA: skan wykrywa treść A, gdy pytamy o A", async () => {
      // Bez tej nogi asercja wyżej byłaby spełniona także wtedy, gdyby funkcja
      // nie oddawała NICZEGO nikomu — czyli przez pustkę.
      expect(JSON.stringify(await publicTemplate(tenantA))).toContain("SZABLON-NAJEMCY-A");
    });

    it("właściciel B nie odczyta wiersza szablonu A przez PostgREST (RLS)", async () => {
      const { data, error } = await ownerB
        .from("sites")
        .select("id, kind")
        .eq("tenant_id", tenantA)
        .eq("kind", PRODUCT_TEMPLATE_SITE_KIND);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("najemca poza oknem handlowym nie oddaje szablonu w ogóle", async () => {
      // Sklep gaśnie razem z odczytem strony (0065) — szablon nie może być
      // furtką, którą treść wychodzi po zawieszeniu najemcy.
      await admin.from("tenants").update({ status: "suspended" }).eq("id", tenantA);
      expect(await publicTemplate(tenantA)).toBeNull();
      await admin.from("tenants").update({ status: "active" }).eq("id", tenantA);
      expect(await publicTemplate(tenantA)).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Strażnik STRUKTURALNY nowej ścieżki odczytu
  // -------------------------------------------------------------------
  describe("odczyt szablonu czyta wyłącznie stan opublikowany", () => {
    it("definicja nie sięga po ani jedną kolumnę szkicu", async () => {
      /*
        Bliźniak strażnika z `site-publication-gate.test.ts`, postawiony nad
        NOWĄ funkcją. Bez niego podmiana źródła koperty na `content_draft`
        przechodziłaby wszystkie testy wyżej dla szablonu, którego szkic równa
        się publikacji — a wyciek byłby pełny.
      */
      const [row] = await sql!<{ def: string }[]>`
        select pg_get_functiondef('app.get_published_product_template(uuid)'::regprocedure) as def
      `;
      expect(row!.def.length, "pusta definicja — czujnik po pustym zbiorze").toBeGreaterThan(500);

      // Bliźniaki znikają najpierw, żeby odwołanie `sec.enabled_published` nie
      // udawało `sec.enabled` (ta sama sztuczka, co w strażniku 0045).
      const odchudzona = (definicja: string) =>
        definicja
          .replaceAll("content_published", "")
          .replaceAll("position_published", "")
          .replaceAll("enabled_published", "")
          .replaceAll("template_published", "")
          .replaceAll("style_published", "")
          .replaceAll("logo_published", "")
          .replaceAll("slug_published", "")
          .replaceAll("published_at", "");

      const KOLUMNY_SZKICU = [
        '."position"',
        ".enabled",
        ".content_draft",
        ".style_draft",
        ".logo_draft",
        ".deleted_in_draft",
      ];

      const czysta = odchudzona(row!.def);
      for (const kolumna of KOLUMNY_SZKICU) {
        expect(czysta, `odczyt szablonu sięga po kolumnę szkicu ${kolumna}`).not.toContain(kolumna);
      }

      // KONTROLA POZYTYWNA: ten sam skan puszczony na ciało czytające szkic
      // musi się zapalić — inaczej test przechodzi przez pustkę.
      const cialoZeSzkicem = `
        select jsonb_build_object('sections', (
          select jsonb_agg(jsonb_build_object('position', sec."position", 'content', sec.content_draft))
          from public.site_sections sec where sec.enabled))
        from public.sites s`;
      const trafienia = KOLUMNY_SZKICU.filter((kolumna) =>
        odchudzona(cialoZeSzkicem).includes(kolumna),
      );
      expect(trafienia.sort(), "skan nie wykrywa odczytu szkicu — dowód byłby pusty").toEqual(
        ['."position"', ".content_draft", ".enabled"].sort(),
      );
    });

    it("izolacja szablonu stoi na JAWNYM zawężeniu w ciele funkcji", async () => {
      // Funkcja jest SECURITY DEFINER, więc RLS w niej nie uczestniczy —
      // zdjęcie tego warunku byłoby wyciekiem, którego żadna polityka nie
      // zatrzyma. Asercja pilnuje OBU członów izolacji naraz.
      const [row] = await sql!<{ def: string }[]>`
        select pg_get_functiondef('app.get_published_product_template(uuid)'::regprocedure) as def
      `;
      expect(row!.def).toContain("s.tenant_id = p_tenant_id");
      expect(row!.def).toContain("t.id = s.tenant_id");
      expect(row!.def).toContain("app.tenant_commercially_active");
    });

    it("funkcja NIE jest wołalna kluczem PUBLIC spoza ról API", async () => {
      const [row] = await sql!<{ acl: string }[]>`
        select coalesce(array_to_string(p.proacl, ','), '') as acl
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'get_published_product_template'
      `;
      expect(row!.acl.length, "puste ACL = domyślny EXECUTE dla PUBLIC").toBeGreaterThan(0);
      // `=X/` bez nazwy roli przed znakiem `=` to wpis dla PUBLIC.
      expect(row!.acl.split(",").some((entry) => entry.startsWith("=")), row!.acl).toBe(false);
      expect(row!.acl).toContain("anon=X/");
      expect(row!.acl).toContain("authenticated=X/");
    });
  });
});
