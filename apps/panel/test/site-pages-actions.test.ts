/**
 * AKCJE MODELU STRON (0048, ADR-093) na ŻYWYM Supabase, przez FAKTYCZNE server
 * actions — wzorzec `site-editor-actions.test.ts` (mock `requireMember`
 * wstrzykuje realnego, zalogowanego membera; bramką zostaje RLS, nie mock).
 *
 * Pakiet `packages/db/test/site-publication-gate.test.ts` dowodzi tego samego
 * na poziomie DANYCH (koperta przed/po, unikat, trigger). Tutaj mierzone jest
 * to, czego tamten nie widzi — **czy warstwa akcji nie rozmija się z bazą**:
 *
 *   1. limit wersji liczony ze STANU BAZY, a nie z listy od klienta (lekcja
 *      wyścigu z K6-delty: dwa równoległe „Nowa strona" nie mają go obejść);
 *   2. odmowa usunięcia ŻYWEJ strony dociera do operatora jako ZDANIE, co
 *      zrobić, a nie jako „brak uprawnień" — 42501 z triggera jest tłumaczone
 *      w jednym miejscu i test pilnuje, że nie przecieka surowe;
 *   3. `createSite` nie ma jak urodzić wersji żywej — nawet gdyby ktoś dopisał
 *      `published_at` do wstawki, strażnik 0045 odpowiada 42501;
 *   4. izolacja: cudzej wersji nie da się ani przemianować, ani usunąć;
 *   5. KORZEŃ SKLEPU (ADR-168): najemca bez ani jednej strony dochodzi do
 *      opublikowanej strony głównej, a druga strona główna dalej nie powstaje
 *      — ani akcją panelu, ani z pominięciem panelu (surowy PostgREST).
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

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "SitePagesActions!12345678";
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
  const email = `pages-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
    p_slug: `pages-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja stron ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

const requireMember = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { createSite, renameSite, deleteSite, publishSite, unpublishSite } = await import(
  "@/lib/actions/site"
);
const { MAX_SITES } = await import("@/lib/site-validation");

describe.skipIf(!hasEnv)("akcje modelu stron (RLS, żywy Supabase)", () => {
  let admin: SupabaseClient;
  /** Klient sklepu: klucz publikowalny, ZERO sesji — tak czyta klient najemcy. */
  let anon: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };

  function actAs(actor: { client: SupabaseClient; tenantId: string }) {
    requireMember.mockResolvedValue({ supabase: actor.client, tenantId: actor.tenantId });
  }

  async function sites(tenantId: string) {
    const { data } = await admin
      .from("sites")
      .select("id, name, slug, slug_published, published_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });
    return data ?? [];
  }

  /**
   * KORZEŃ SKLEPU OCZAMI KLIENTA — nie stan tabeli, tylko to, co pod `/`
   * oddaje odczyt publiczny. Klucz anona i `app.get_published_site` to
   * dokładnie ta droga, którą chodzi storefront (0074: funkcja jest
   * wywołaniem `get_published_page` dla pustego sluga).
   */
  async function storeRoot(tenantId: string): Promise<unknown> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_published_site", { p_tenant_id: tenantId });
    if (error) throw new Error(`get_published_site: ${error.message}`);
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
    actAs(tenantA);
  });

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) await admin.from("tenants").delete().in("id", createdTenantIds);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  }, 60_000);

  it("createSite zakłada wersję NIEŻYWĄ i z nazwą", async () => {
    const result = await createSite({ name: "Wersja jesienna" });
    expect(result.ok, result.ok ? "" : result.error).toBe(true);

    const rows = await sites(tenantA.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Wersja jesienna");
    expect(rows[0]!.published_at, "nowa wersja urodziła się widoczna w sklepie").toBeNull();
  });

  it("pusta nazwa jest odrzucana PRZED dotknięciem bazy", async () => {
    const result = await createSite({ name: "   " });
    expect(result.ok).toBe(false);
    expect(await sites(tenantA.tenantId), "odrzucona nazwa i tak założyła wiersz").toHaveLength(0);
  });

  it("LIMIT wersji liczy się ze STANU BAZY (lekcja wyścigu K6-delty)", async () => {
    // Wiersze wstawia rola serwisowa, więc akcja NIE MA skąd znać ich liczby
    // inaczej niż pytając bazę. Gdyby limit szedł z listy podanej przez
    // klienta, ten test przechodziłby przy każdej implementacji.
    const rows = Array.from({ length: MAX_SITES }, (_, index) => ({
      tenant_id: tenantA.tenantId,
      name: `Wersja ${index + 1}`,
    }));
    const { error } = await admin.from("sites").insert(rows);
    expect(error, `zasiew limitu: ${error?.message}`).toBeNull();

    const result = await createSite({ name: "O jedną za dużo" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("limit stron nie zadziałał");
    expect(result.error).toContain(String(MAX_SITES));
    expect(await sites(tenantA.tenantId), "limit przekroczony mimo odmowy").toHaveLength(MAX_SITES);
  }, 60_000);

  it("deleteSite usuwa wersję NIEŻYWĄ razem z jej sekcjami", async () => {
    const created = await createSite({ name: "Do usunięcia" });
    if (!created.ok) throw new Error(created.error);
    const { error: sectionError } = await admin.from("site_sections").insert({
      tenant_id: tenantA.tenantId,
      site_id: created.siteId,
      type: "hero",
      position: 0,
      content_draft: { heading: "Treść wersji" },
    });
    expect(sectionError, `zasiew sekcji: ${sectionError?.message}`).toBeNull();

    const result = await deleteSite(created.siteId);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);

    expect(await sites(tenantA.tenantId)).toHaveLength(0);
    const { count } = await admin
      .from("site_sections")
      .select("id", { count: "exact", head: true })
      .eq("site_id", created.siteId);
    expect(count, "sekcje usuniętej wersji zostały w bazie").toBe(0);
  }, 60_000);

  it("deleteSite ŻYWEJ wersji: odmowa bazy dociera jako ZDANIE, co zrobić", async () => {
    const created = await createSite({ name: "Żywa" });
    if (!created.ok) throw new Error(created.error);
    const published = await publishSite(created.siteId);
    expect(published.ok, published.ok ? "" : published.error).toBe(true);

    const result = await deleteSite(created.siteId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("usunięto żywą wersję");

    /*
     * Asercja celuje w zdanie PANELU, a nie w cokolwiek zawierające „opublikuj
     * inną" — bo komunikat triggera też te słowa zawiera. Wersja słabsza
     * (`toContain("opublikuj inną")`) przechodziła również wtedy, gdy akcja
     * przepuszczała surowy tekst z Postgresa: znalazł to dowód mutacyjny M4
     * i to jest dokładny powód, dla którego ta asercja wygląda tak, jak wygląda.
     */
    expect(result.error, "surowa odmowa bazy zamiast zdania panelu").toContain(
      "bo widzą ją klienci",
    );
    expect(result.error).not.toContain("42501");

    /*
     * RADA MA WSKAZYWAĆ DROGĘ, KTÓRA ISTNIEJE (ADR-170). „Najpierw opublikuj
     * inną" było prawdą do 0073, gdy publikacja PRZEŁĄCZAŁA żywą stronę — od
     * 0074 strony współistnieją, więc operator wykonywał polecenie i wracał
     * w to samo miejsce. Asercja negatywna stoi obok pozytywnej, bo sam fakt
     * „jest jakieś zdanie" nie odróżnia rady dobrej od martwej.
     */
    expect(result.error, "panel dalej radzi czynność, która nic nie zmienia").not.toContain(
      "opublikuj inną",
    );
    expect(result.error).toContain("zdejmij ją ze sklepu");

    expect(await sites(tenantA.tenantId), "żywa wersja zniknęła mimo odmowy").toHaveLength(1);
  }, 60_000);

  /* ============ ZDJĘCIE STRONY ZE SKLEPU (0078, ADR-170) ============ */

  it("unpublishSite zdejmuje stronę ze sklepu — klient przestaje ją widzieć", async () => {
    const created = await createSite({ name: "Strona główna" });
    if (!created.ok) throw new Error(created.error);
    const { error: sectionError } = await admin.from("site_sections").insert({
      tenant_id: tenantA.tenantId,
      site_id: created.siteId,
      type: "hero",
      position: 0,
      content_draft: { heading: "Wypożyczalnia nad jeziorem" },
    });
    expect(sectionError, `zasiew sekcji: ${sectionError?.message}`).toBeNull();

    const published = await publishSite(created.siteId);
    expect(published.ok, published.ok ? "" : published.error).toBe(true);
    expect(await storeRoot(tenantA.tenantId), "korzeń sklepu pusty PRZED zdjęciem").not.toBeNull();

    const result = await unpublishSite(created.siteId);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);

    // Werdykt z tego, co widzi klient — nie ze zwrotu akcji.
    expect(await storeRoot(tenantA.tenantId), "klient dalej widzi zdjętą stronę").toBeNull();
    expect((await sites(tenantA.tenantId))[0]!.published_at).toBeNull();
  }, 60_000);

  it("unpublishSite otwiera drogę do usunięcia strony opublikowanej przez pomyłkę", async () => {
    const created = await createSite({ name: "Pomyłka" });
    if (!created.ok) throw new Error(created.error);
    await publishSite(created.siteId);

    const odmowa = await deleteSite(created.siteId);
    expect(odmowa.ok, "żywa strona dała się usunąć").toBe(false);

    expect((await unpublishSite(created.siteId)).ok).toBe(true);
    const usuniete = await deleteSite(created.siteId);
    expect(usuniete.ok, usuniete.ok ? "" : usuniete.error).toBe(true);
    expect(await sites(tenantA.tenantId)).toHaveLength(0);
  }, 60_000);

  it("IZOLACJA: cudzej strony nie da się zdjąć ze sklepu", async () => {
    const created = await createSite({ name: "Strona najemcy A" });
    if (!created.ok) throw new Error(created.error);
    await publishSite(created.siteId);

    actAs(tenantB);
    const result = await unpublishSite(created.siteId);
    expect(result.ok, "najemca B zdjął stronę najemcy A").toBe(false);
    if (result.ok) throw new Error("cudza strona zdjęta ze sklepu");
    // Odmowa jest ZDANIEM, a nie surowym kodem bazy — i nie zdradza, czy taka
    // strona w ogóle istnieje.
    expect(result.error).toBe("Nie znaleziono strony.");

    actAs(tenantA);
    expect((await sites(tenantA.tenantId))[0]!.published_at).not.toBeNull();
  }, 60_000);

  it("renameSite zmienia WYŁĄCZNIE nazwę, nie rusza żywości", async () => {
    const created = await createSite({ name: "Przed" });
    if (!created.ok) throw new Error(created.error);
    await publishSite(created.siteId);

    const result = await renameSite({ siteId: created.siteId, name: "Po zmianie" });
    expect(result.ok, result.ok ? "" : result.error).toBe(true);

    const rows = await sites(tenantA.tenantId);
    expect(rows[0]!.name).toBe("Po zmianie");
    expect(rows[0]!.published_at, "zmiana nazwy zdjęła stronę ze sklepu").not.toBeNull();
  }, 60_000);

  /* ================= KORZEŃ SKLEPU NOWEGO NAJEMCY (ADR-168) ================= */

  it("najemca BEZ ANI JEDNEJ strony dochodzi do opublikowanej strony głównej", async () => {
    /*
     * Stan wyjściowy jest stanem konta założonego dziś: `app.create_tenant`
     * (ostatnia definicja — 0070) nie zasiewa ani jednego wiersza `sites`.
     * Test przechodzi CAŁĄ drogę operatora, aż do odczytu, którym storefront
     * pyta o korzeń — bo werdyktem jest „klient coś widzi", a nie „wiersz
     * istnieje".
     */
    expect(await sites(tenantA.tenantId), "test nie startuje ze stanu świeżego konta").toHaveLength(
      0,
    );
    expect(await storeRoot(tenantA.tenantId), "korzeń sklepu miał treść PRZED publikacją").toBeNull();

    // Wywołanie BEZ klucza `slug` — jedyna droga do strony głównej.
    const created = await createSite({ name: "Strona główna" });
    expect(created.ok, created.ok ? "" : created.error).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const { error: sectionError } = await admin.from("site_sections").insert({
      tenant_id: tenantA.tenantId,
      site_id: created.siteId,
      type: "hero",
      position: 0,
      content_draft: { heading: "Wypożyczalnia nad jeziorem" },
    });
    expect(sectionError, `zasiew sekcji: ${sectionError?.message}`).toBeNull();

    const published = await publishSite(created.siteId);
    expect(published.ok, published.ok ? "" : published.error).toBe(true);

    const root = await storeRoot(tenantA.tenantId);
    expect(root, "korzeń sklepu został pusty mimo publikacji").not.toBeNull();
    expect(
      JSON.stringify(root),
      "koperta korzenia nie niesie treści opublikowanej strony",
    ).toContain("Wypożyczalnia nad jeziorem");

    const rows = await sites(tenantA.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slug, "szkic strony głównej dostał adres").toBe("");
    expect(rows[0]!.slug_published, "publikacja nie wystawiła adresu strony głównej").toBe("");
  }, 60_000);

  it("DRUGA strona główna: akcja odmawia zdaniem, zanim cokolwiek wstawi", async () => {
    const first = await createSite({ name: "Strona główna" });
    expect(first.ok, first.ok ? "" : first.error).toBe(true);

    const second = await createSite({ name: "Jeszcze jedna główna" });
    expect(second.ok, "powstała DRUGA strona główna").toBe(false);
    if (second.ok) throw new Error("druga strona główna przeszła");
    expect(second.error).toContain("Sklep ma już stronę główną");

    // Werdykt z trwałego stanu, nie ze zwrotu akcji.
    expect(await sites(tenantA.tenantId), "odmowa i tak zostawiła drugi wiersz").toHaveLength(1);
  }, 60_000);

  it("pusty adres WPISANY W POLE dalej jest odmawiany — także przy zerze stron", async () => {
    /*
     * Zawężenie nie zdejmuje zakazu ze schematu: `slug: ""` znaczy „z tej
     * nazwy nie dało się wyprowadzić adresu", a nie „to strona główna". Gdyby
     * zakaz padł razem z poprawką, ta sama pomyłka („???" jako nazwa) znów
     * produkowałaby stronę główną bez wiedzy operatora.
     */
    const result = await createSite({ name: "Bez adresu", slug: "" });
    expect(result.ok, "pusty adres z pola przeszedł").toBe(false);
    if (result.ok) throw new Error("pusty slug przeszedł walidację");
    expect(result.error).toContain("Podaj adres strony");
    expect(await sites(tenantA.tenantId)).toHaveLength(0);
  }, 60_000);

  it("SUROWY PostgREST: druga ŻYWA strona główna jest niereprezentowalna", async () => {
    const first = await createSite({ name: "Strona główna" });
    if (!first.ok) throw new Error(first.error);
    const firstPublished = await publishSite(first.siteId);
    expect(firstPublished.ok, firstPublished.ok ? "" : firstPublished.error).toBe(true);

    /*
     * Z POMINIĘCIEM PANELU: wiersz wstawia sam member przez PostgREST, więc
     * odczyt „czy strona główna już jest" z akcji nie wykona się w ogóle.
     * Wstawka SIĘ UDAJE i tak ma być — szkiców pod jednym adresem może być
     * wiele (0073, sekcja 4), to są wersje robocze. Bramką jest publikacja.
     */
    const { data: smuggled, error: insertError } = await tenantA.client
      .from("sites")
      .insert({ tenant_id: tenantA.tenantId, name: "Podszywka", slug: "" })
      .select("id")
      .single();
    expect(insertError, `wstawka szkicu: ${insertError?.message}`).toBeNull();

    // Droga na skróty do żywości: strażnik 0045 odpowiada 42501.
    const { error: guardError } = await tenantA.client
      .from("sites")
      .update({ published_at: new Date().toISOString(), slug_published: "" })
      .eq("id", smuggled!.id as string);
    expect(guardError?.code, "ręczny zapis kolumn opublikowanych przeszedł").toBe("42501");

    // Jedyna prawdziwa droga publikacji pada na unikacie żywego adresu.
    const secondPublished = await publishSite(smuggled!.id as string);
    expect(secondPublished.ok, "druga strona główna weszła do sklepu").toBe(false);
    if (secondPublished.ok) throw new Error("unikat żywego adresu nie zadziałał");
    expect(secondPublished.error).toContain("Inna opublikowana strona ma już ten adres");

    const live = (await sites(tenantA.tenantId)).filter(
      (row) => row.published_at !== null && row.slug_published === "",
    );
    expect(live, "pod adresem „/” stoi więcej niż jedna żywa strona").toHaveLength(1);
    expect(live[0]!.id).toBe(first.siteId);
  }, 60_000);

  it("IZOLACJA: obcy tenant nie przemianuje ani nie usunie cudzej wersji", async () => {
    const created = await createSite({ name: "Wersja tenanta A" });
    if (!created.ok) throw new Error(created.error);

    actAs(tenantB);
    const renamed = await renameSite({ siteId: created.siteId, name: "Przejęta" });
    expect(renamed.ok, "obcy tenant przemianował cudzą wersję").toBe(false);

    const removed = await deleteSite(created.siteId);
    expect(removed.ok, "obcy tenant usunął cudzą wersję").toBe(false);

    // Werdykt z trwałego stanu: wiersz ofiary nietknięty.
    const rows = await sites(tenantA.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Wersja tenanta A");
  }, 60_000);
});
