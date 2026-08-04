/**
 * NIEZMIENNIK „STOPKA OSTATNIA W SZKICU" PRZEŻYWA WYŚCIG ZAPISÓW
 * STRUKTURALNYCH (K6-delta do ADR-092), na ŻYWYM Supabase, przez FAKTYCZNE
 * server actions.
 *
 * ===================== CO ZNALAZŁ PM =====================
 *
 * Dwa szybkie kliknięcia w kafel sekcji puszczają DWA `addSection` w locie
 * (zapisy strukturalne przestały blokować kreator w #172). Każde z nich robiło
 * dwa kroki: `upsertSection` (wstawka na `max(position) + 1`, czyli POD stopkę)
 * i `reorderSections` z kompletem pozycji policzonym ze stanu KLIENTA. Drugi
 * klient nie znał sekcji dodanej przez pierwszego, więc jego komplet nie był
 * permutacją stanu bazy — a bramka `reorderPlan` odrzucała takie żądanie
 * w całości. Skutek: obie nowe sekcje zostawały tam, gdzie postawiła je
 * wstawka, czyli POD STOPKĄ, i to trwale (przeżywa przeładowanie; prostuje
 * dopiero kolejna operacja strukturalna).
 *
 * ===================== CZEGO PILNUJE TEN PLIK =====================
 *
 * Wada jest KLASY „plan liczony ze stanu klienta", więc testy niżej nie
 * odtwarzają jednego kliknięcia, tylko trzy zdania o warstwie serwera:
 *
 *   1. WSTAWKA SAMA W SOBIE nie łamie niezmiennika — nawet gdy krok drugi
 *      (reorder) nigdy nie przyjdzie. To jest asercja, która czyni cały
 *      mechanizm odpornym na wyścig, zamiast łatać jeden jego przebieg.
 *   2. DWA `addSection` BEZ `await` między nimi kończą się stopką na końcu.
 *      Test odpala je dokładnie tak, jak robi to kreator: bez czekania.
 *   3. Żądanie NIEPEŁNE (klient nie zna świeżej sekcji) jest UZUPEŁNIANE ze
 *      stanu bazy, a żądanie z identyfikatorem SPOZA strony — odmawiane.
 *      Rozdzielenie tych dwóch przypadków jest sednem poprawki: przed deltą
 *      oba dostawały tę samą odmowę.
 *
 * Werdykt zawsze z TRWAŁEGO stanu (odczyt service-rolem), nie ze zwrotu akcji.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "SiteOrderRace!12345678";
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
  const email = `race-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await bootstrap.schema("app").rpc("create_tenant", {
    p_slug: `race-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja wyścigu ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

const requireMember = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireMember: () => requireMember() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { upsertSection, reorderSections, duplicateSection, toggleSection } = await import(
  "@/lib/actions/site"
);
const { sectionCanvasFrom, presetContentFor } = await import("@avably/core/site");

/** Treść nowej sekcji dokładnie taka, jaką składa kreator (płótno v2). */
function canvasOf(type: "faq" | "cta" | "footer" | "usp") {
  return sectionCanvasFrom(type, presetContentFor(type, "pl"));
}

describe.skipIf(!hasEnv)("kolejność sekcji przeżywa równoległe zapisy strukturalne", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };
  let siteAId: string;

  function actAs(actor: { client: SupabaseClient; tenantId: string }) {
    requireMember.mockResolvedValue({ supabase: actor.client, tenantId: actor.tenantId });
  }

  /** Szkic strony A odczytany service-rolem: typy w kolejności zapisanej. */
  async function draftTypes(): Promise<string[]> {
    const { data } = await admin
      .from("site_sections")
      .select("type, position, id")
      .eq("tenant_id", tenantA.tenantId)
      .eq("site_id", siteAId)
      .order("position", { ascending: true })
      .order("id", { ascending: true });
    return (data ?? []).map((row) => row.type as string);
  }

  async function seedPage(): Promise<void> {
    await admin.from("site_sections").delete().eq("site_id", siteAId);
    const rows = [
      { type: "hero", position: 0, content_draft: { heading: "Pierwszy ekran" } },
      { type: "footer", position: 1, content_draft: { businessName: "Firma", legal: "© Firma." } },
    ];
    for (const row of rows) {
      const { error } = await admin
        .from("site_sections")
        .insert({ tenant_id: tenantA.tenantId, site_id: siteAId, enabled: true, ...row });
      if (error) throw new Error(`seed: ${error.message}`);
    }
  }

  beforeAll(async () => {
    admin = createAdminClient();
    tenantA = await createTenantMember(admin, "a");
    tenantB = await createTenantMember(admin, "b");

    const { data: site, error } = await tenantA.client
      .from("sites")
      .insert({ tenant_id: tenantA.tenantId })
      .select("id")
      .single();
    if (error || !site) throw new Error(`insert sites: ${error?.message}`);
    siteAId = site.id as string;
  }, 60_000);

  beforeEach(async () => {
    await seedPage();
    actAs(tenantA);
  });

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) await admin.from("tenants").delete().in("id", createdTenantIds);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  }, 60_000);

  it("kontrola po pustym zbiorze: strona startowa to hero + stopka", async () => {
    // Bez tego wszystkie asercje niżej mogłyby badać stronę bez stopki, na
    // której niezmiennik jest prawdziwy z braku czego łamać.
    expect(await draftTypes()).toEqual(["hero", "footer"]);
  });

  it("SAMA WSTAWKA nie wsuwa sekcji pod stopkę — bez drugiego kroku klienta", async () => {
    // Sedno poprawki: `upsertSection` wstawia na `max(position) + 1`, więc
    // przed deltą świeża sekcja lądowała POD stopką i tam zostawała, gdy
    // reorder nie dojechał. Tu NIE WOŁAMY reorderu w ogóle.
    const added = await upsertSection({ siteId: siteAId, type: "faq", content: canvasOf("faq") });
    expect(added.ok, added.ok ? "" : added.error).toBe(true);

    expect(await draftTypes()).toEqual(["hero", "faq", "footer"]);
  });

  it("DWA addSection BEZ await kończą się stopką na końcu (scenariusz PM)", async () => {
    // Dwa szybkie kliknięcia w kafel palety: obie akcje lecą naraz, obie liczą
    // swój komplet pozycji na stanie klienta sprzed drugiej.
    const klientaWidok = ["placeholder"]; // komplet z chwili renderu — bez świeżych id
    const before = await admin
      .from("site_sections")
      .select("id")
      .eq("site_id", siteAId)
      .order("position", { ascending: true });
    klientaWidok.length = 0;
    klientaWidok.push(...(before.data ?? []).map((row) => row.id as string));

    const pierwszy = upsertSection({ siteId: siteAId, type: "faq", content: canvasOf("faq") });
    const drugi = upsertSection({ siteId: siteAId, type: "cta", content: canvasOf("cta") });
    const [a, b] = await Promise.all([pierwszy, drugi]);
    expect(a.ok && b.ok, "wstawki nie przeszły").toBe(true);

    // Krok drugi kreatora: OBA klienty wysyłają komplet, którego nie zdążyły
    // odświeżyć — każdy zna tylko SWOJĄ nową sekcję.
    if (!a.ok || !b.ok) throw new Error("wstawki nie przeszły");
    await Promise.all([
      reorderSections(siteAId, [klientaWidok[0]!, a.sectionId, klientaWidok[1]!]),
      reorderSections(siteAId, [klientaWidok[0]!, b.sectionId, klientaWidok[1]!]),
    ]);

    const typy = await draftTypes();
    expect(typy.length, "obie sekcje miały wejść").toBe(4);
    expect(typy.at(-1), `stopka nie jest ostatnia: ${typy.join(" > ")}`).toBe("footer");
  });

  it("żądanie NIEPEŁNE jest uzupełniane ze stanu bazy, a nie odrzucane", async () => {
    const added = await upsertSection({ siteId: siteAId, type: "usp", content: canvasOf("usp") });
    if (!added.ok) throw new Error(added.error);

    const { data } = await admin
      .from("site_sections")
      .select("id, type")
      .eq("site_id", siteAId)
      .order("position", { ascending: true });
    const hero = (data ?? []).find((row) => row.type === "hero")!.id as string;

    // Klient zna WYŁĄCZNIE hero — tak wygląda komplet sprzed dwóch wstawek.
    const result = await reorderSections(siteAId, [hero]);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);

    const typy = await draftTypes();
    expect(typy, "sekcja nieznana klientowi wypadła ze strony").toContain("usp");
    expect(typy.at(-1)).toBe("footer");
  });

  it("żądanie z identyfikatorem SPOZA strony jest ODMAWIANE (kontrola negatywna)", async () => {
    // Kontrola, bez której poprawka wyżej zamieniłaby odmowę izolacji w ciche
    // „ok": tolerowanie braków nie może znaczyć tolerowania obcych id.
    const { data } = await admin
      .from("site_sections")
      .select("id")
      .eq("site_id", siteAId)
      .order("position", { ascending: true });
    const swoje = (data ?? []).map((row) => row.id as string);

    const przed = await draftTypes();
    const result = await reorderSections(siteAId, [...swoje, randomUUID()]);
    expect(result.ok, "kolejność z obcym identyfikatorem powinna zostać odrzucona").toBe(false);
    expect(await draftTypes(), "stan zmieniony mimo odmowy").toEqual(przed);
  });

  it("IZOLACJA bez zmian: obcy tenant nie przestawi sekcji cudzej strony", async () => {
    const przed = await draftTypes();
    const { data } = await admin
      .from("site_sections")
      .select("id")
      .eq("site_id", siteAId)
      .order("position", { ascending: true });
    const swoje = (data ?? []).map((row) => row.id as string);

    actAs(tenantB);
    const result = await reorderSections(siteAId, [...swoje].reverse());
    expect(result.ok, "reorder cudzej strony powinien zostać odrzucony").toBe(false);
    expect(await draftTypes(), "pozycje ofiary ruszone").toEqual(przed);
  });

  it("DUPLIKAT prostuje kolejność, gdy pozycje w bazie są ROZJECHANE", async () => {
    /*
     * Stan wejściowy jest celowo niepoprawny: stopka stoi PIERWSZA. Taki stan
     * jest osiągalny i opisany w samej akcji — przenumerowanie to seria
     * UPDATE-ów, a „częściowa awaria psuje najwyżej kolejność". Duplikat, który
     * ufałby zastanym pozycjom, utrwaliłby rozjazd i dołożył do niego kopię.
     */
    const { data: przed } = await admin
      .from("site_sections")
      .select("id, type")
      .eq("site_id", siteAId);
    const hero = (przed ?? []).find((row) => row.type === "hero")!.id as string;
    const footer = (przed ?? []).find((row) => row.type === "footer")!.id as string;
    await admin.from("site_sections").update({ position: 0 }).eq("id", footer);
    await admin.from("site_sections").update({ position: 1 }).eq("id", hero);
    expect(await draftTypes(), "kontrola: stan wejściowy miał być rozjechany").toEqual([
      "footer",
      "hero",
    ]);

    actAs(tenantA);
    const result = await duplicateSection(hero);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
    expect(await draftTypes()).toEqual(["hero", "hero", "footer"]);
  });

  it("duplikat STOPKI jest odmawiany czytelnie (jedna żywa stopka, 0047)", async () => {
    const { data } = await admin
      .from("site_sections")
      .select("id, type")
      .eq("site_id", siteAId);
    const footer = (data ?? []).find((row) => row.type === "footer")!.id as string;

    const result = await duplicateSection(footer);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("duplikat stopki przeszedł");
    expect(result.error).toContain("stopk");
    expect(await draftTypes()).toEqual(["hero", "footer"]);
  });

  it("toggleSection NIE rusza pozycji — niezmiennik jest poza jego zasięgiem", async () => {
    // Trzecia oś z recenzji PM. Akcja pisze wyłącznie `enabled`, więc nie ma
    // czym złamać kolejności; test jest zdaniem o tym, a nie domysłem.
    const { data } = await admin
      .from("site_sections")
      .select("id, type, position")
      .eq("site_id", siteAId)
      .order("position", { ascending: true });
    const przed = (data ?? []).map((row) => `${row.type}:${row.position}`);
    const hero = (data ?? []).find((row) => row.type === "hero")!.id as string;

    const result = await toggleSection(hero, false);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);

    const { data: po } = await admin
      .from("site_sections")
      .select("id, type, position")
      .eq("site_id", siteAId)
      .order("position", { ascending: true });
    expect((po ?? []).map((row) => `${row.type}:${row.position}`)).toEqual(przed);
    expect(await draftTypes()).toEqual(["hero", "footer"]);
  });
});
