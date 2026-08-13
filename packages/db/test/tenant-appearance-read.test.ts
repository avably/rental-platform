import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

/**
 * POWŁOKA SKLEPU CZYTANA TOREM NAJEMCY — app.get_tenant_appearance
 * (0079, ADR-171; wada K2 z audytu kreatora 2026-08-13).
 *
 * ==================== CO SIĘ ZEPSUŁO ====================
 *
 * 0076 i 0077 przeniosły znak firmy i wygląd na wiersz NAJEMCY i wystawiły je
 * w kopercie `app.get_published_page`. Sklep czytał je stamtąd — z koperty
 * STRONY GŁÓWNEJ, bo tamtędy przechodził jedyny odczyt powłoki. Skutkiem był
 * stan DOMYŚLNY nowego najemcy: dopóki strona główna nie jest opublikowana,
 * koperta jest NULL-em, więc klient nie widzi ani znaku, ani wybranego motywu
 * — także na opublikowanej podstronie i na trasach, które wiersza `sites` nie
 * mają w ogóle (katalog, koszyk, kasa, dokumenty prawne).
 *
 * ==================== CZEGO PILNUJE TEN PLIK ====================
 *
 *   1. NAJEMCA BEZ ANI JEDNEJ OPUBLIKOWANEJ STRONY MA POWŁOKĘ — i w tym samym
 *      przebiegu koperta strony głównej jest NULL-em. Kontrast jest tu całą
 *      treścią dowodu: bez niego test przechodziłby także wtedy, gdyby powłoka
 *      dalej jechała stroną;
 *   2. OPUBLIKOWANA PODSTRONA PRZY NIEOPUBLIKOWANEJ STRONIE GŁÓWNEJ — dokładny
 *      układ z audytu, wyrażony w bazie;
 *   3. ODCZYT WIDZI WYŁĄCZNIE STAN OPUBLIKOWANY — zapis szkicu nie zmienia
 *      odpowiedzi o bajt, a strażnik strukturalny skanuje ciało funkcji;
 *   4. IZOLACJA — wygląd i znak najemcy A nie wychodzą najemcy B. Bramką jest
 *      SAMO ZAPYTANIE: funkcja jest SECURITY DEFINER, więc RLS w niej nie
 *      uczestniczy;
 *   5. OKNO HANDLOWE — najemca poza oknem znika CAŁY, a nie zostawia w sklepie
 *      własny znak;
 *   6. KSZTAŁT KOPERTY — klucze `style` i `logo` dokładają się WARUNKOWO,
 *      a `template` przechodzi przez `coalesce`, więc NULL nie ma jak trafić
 *      pod klucz bezwarunkowy (po drugiej stronie stoi `z.enum`).
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (patrz seed-tenants).
 */
const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/** Wygląd najemcy A — rozpoznawalny co do bajtu w każdej asercji. */
const STYL_A = { theme: "noir-lux", accent: "champagne" } as const;
/** Identyfikator wgrania w znaku — ścieżka musi pasować do wzorca z 0076. */
const UPLOAD_A = "44444444-4444-4444-8444-444444444444";
/** Znak najemcy A — składany po zasiewie, bo ścieżka niesie id najemcy. */
let LOGO_A: { path: string; inFooter: boolean };

const sql = process.env.SUPABASE_LOCAL_URL
  ? postgres(process.env.SUPABASE_LOCAL_URL, { max: 1 })
  : null;

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
      realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    },
  );
}

/** Powłoka najemcy — TA SAMA droga, którą czyta ją sklep (klient anon). */
async function appearance(tenantId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await anon
    .schema("app")
    .rpc("get_tenant_appearance", { p_tenant_id: tenantId });
  if (error) throw new Error(`get_tenant_appearance jako anon zawiodło: ${error.message}`);
  return data as Record<string, unknown> | null;
}

/** Koperta strony pod adresem — do dowodu przez KONTRAST (patrz punkt 1). */
async function pageEnvelope(
  tenantId: string,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await anon
    .schema("app")
    .rpc("get_published_page", { p_tenant_id: tenantId, p_slug: slug });
  if (error) throw new Error(`get_published_page jako anon zawiodło: ${error.message}`);
  return data as Record<string, unknown> | null;
}

/** Strona najemcy — `publish` decyduje, czy klient ją widzi. */
async function createSite(ctx: TenantCtx, slug: string, publish: boolean): Promise<string> {
  const { data, error } = await ctx.ownerClient
    .from("sites")
    .insert({ tenant_id: ctx.tenantId, slug })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się utworzyć strony: ${error?.message}`);
  const siteId = data.id as string;
  await ctx.ownerClient.from("site_sections").insert({
    tenant_id: ctx.tenantId,
    site_id: siteId,
    type: "hero",
    position: 0,
    content_draft: { heading: `Hero ${slug || "/"}` },
  });
  if (publish) {
    const published = await ctx.ownerClient
      .schema("app")
      .rpc("publish_site", { p_site_id: siteId });
    if (published.error) throw new Error(`publish_site zawiodło: ${published.error.message}`);
  }
  return siteId;
}

describe.skipIf(!hasEnv)("powłoka sklepu torem najemcy (0079, ADR-171)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();
    ({ a, b } = await seedTwoTenants());

    // Najemca A: znak i wygląd OPUBLIKOWANE, a przy tym ANI JEDNEJ strony —
    // czyli dokładnie ten stan, w którym panel meldował „Ten znak widzą
    // klienci", a klient nie widział niczego.
    LOGO_A = { path: `${a.tenantId}/logo/${UPLOAD_A}.png`, inFooter: true };

    const style = await a.ownerClient.schema("app").rpc("set_tenant_style", { p_style: STYL_A });
    if (style.error) throw new Error(`set_tenant_style zawiodło: ${style.error.message}`);
    const logo = await a.ownerClient.schema("app").rpc("set_tenant_logo", { p_logo: LOGO_A });
    if (logo.error) throw new Error(`set_tenant_logo zawiodło: ${logo.error.message}`);
    const publishedLook = await a.ownerClient.schema("app").rpc("publish_tenant_appearance");
    if (publishedLook.error) throw new Error(publishedLook.error.message);
    const publishedLogo = await a.ownerClient.schema("app").rpc("publish_tenant_logo");
    if (publishedLogo.error) throw new Error(publishedLogo.error.message);
  }, 60_000);

  afterAll(async () => {
    await cleanupSeeded(admin);
    await sql?.end({ timeout: 5 });
  });

  it("NAJEMCA BEZ STRON ma znak i wygląd — koperta strony głównej jest NULL-em", async () => {
    // KONTRAST jest tu całą treścią dowodu: gdyby powłoka dalej jechała
    // stroną, pierwsza asercja i druga nie mogłyby być prawdziwe naraz.
    expect(await pageEnvelope(a.tenantId, ""), "najemca nie miał być bez strony głównej").toBeNull();

    const shell = await appearance(a.tenantId);
    expect(shell, "powłoka pusta — dowód po pustym zbiorze").not.toBeNull();
    expect(shell!.style).toEqual(STYL_A);
    expect(shell!.logo).toEqual(LOGO_A);
    expect(shell!.template).toBe("classic");
  });

  it("OPUBLIKOWANA PODSTRONA przy nieopublikowanej stronie głównej — układ z audytu", async () => {
    await createSite(a, "kontakt", true);
    await createSite(a, "", false);

    // Podstrona jest żywa, strona główna nie — czyli stan domyślny najemcy,
    // który zaczął od „Kontaktu" albo jeszcze nie opublikował korzenia.
    expect(await pageEnvelope(a.tenantId, "kontakt")).not.toBeNull();
    expect(await pageEnvelope(a.tenantId, ""), "strona główna miała zostać szkicem").toBeNull();

    const shell = await appearance(a.tenantId);
    expect(shell!.style, "wygląd zniknął razem z nieopublikowaną stroną główną").toEqual(STYL_A);
    expect(shell!.logo, "znak zniknął razem z nieopublikowaną stroną główną").toEqual(LOGO_A);
  });

  it("ODCZYT NIE WIDZI SZKICU — zapis stanu roboczego nie zmienia powłoki o bajt", async () => {
    const przed = await appearance(a.tenantId);

    const zapis = await a.ownerClient
      .schema("app")
      .rpc("set_tenant_style", { p_style: { theme: "bold-brutal" } });
    expect(zapis.error).toBeNull();

    expect(await appearance(a.tenantId), "szkic wyglądu wyszedł na sklep").toEqual(przed);

    // Publikacja i dopiero ona zmienia to, co widzi klient — kontrola
    // pozytywna, bez której poprzednia asercja przechodziłaby też wtedy,
    // gdyby funkcja nie czytała NICZEGO.
    expect((await a.ownerClient.schema("app").rpc("publish_tenant_appearance")).error).toBeNull();
    expect((await appearance(a.tenantId))!.style).toEqual({ theme: "bold-brutal" });

    // Stan przywrócony dla przypadków niżej.
    expect(
      (await a.ownerClient.schema("app").rpc("set_tenant_style", { p_style: STYL_A })).error,
    ).toBeNull();
    expect((await a.ownerClient.schema("app").rpc("publish_tenant_appearance")).error).toBeNull();
  });

  it("IZOLACJA: znak i wygląd najemcy A nie wychodzą na sklep najemcy B", async () => {
    // Asercja nazwana WPROST o izolację. `app.get_tenant_appearance` jest
    // SECURITY DEFINER, więc RLS w tym odczycie NIE UCZESTNICZY — jedyną
    // bramką jest zawężenie `t.id = p_tenant_id` w ciele. Bez niego sklep
    // najemcy B renderowałby się motywem i znakiem najemcy A.
    const powlokaA = await appearance(a.tenantId);
    const powlokaB = await appearance(b.tenantId);

    expect(powlokaA, "brak powłoki A — dowód po pustym zbiorze").not.toBeNull();
    expect(powlokaB, "brak powłoki B — dowód po pustym zbiorze").not.toBeNull();

    expect(powlokaA!.style, "kontrola pozytywna: najemca A NIE MA stylu").toEqual(STYL_A);
    expect(powlokaA!.logo, "kontrola pozytywna: najemca A NIE MA znaku").toEqual(LOGO_A);

    expect(Object.keys(powlokaB!), "styl najemcy A wyciekł na sklep najemcy B").not.toContain(
      "style",
    );
    expect(Object.keys(powlokaB!), "znak najemcy A wyciekł na sklep najemcy B").not.toContain(
      "logo",
    );
    expect(powlokaB!.template, "szablon najemcy A wyciekł na sklep najemcy B").toBe("classic");
  });

  it("OKNO HANDLOWE: najemca poza oknem znika cały, razem ze znakiem", async () => {
    const status = await sql!<{ status: string }[]>`
      select status from public.tenants where id = ${a.tenantId}
    `;
    await sql!`update public.tenants set status = 'cancelled' where id = ${a.tenantId}`;
    try {
      expect(await appearance(a.tenantId), "zamknięty najemca zostawił znak w sklepie").toBeNull();
    } finally {
      await sql!`update public.tenants set status = ${status[0]!.status} where id = ${a.tenantId}`;
    }
    expect(await appearance(a.tenantId), "przywrócenie statusu nie zadziałało").not.toBeNull();
  });

  it("najemca nieistniejący jest NIEODRÓŻNIALNY od nieaktywnego", async () => {
    expect(await appearance("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("KSZTAŁT: bez zapisanego wyglądu koperta ma sam szablon, i to nie NULL", async () => {
    const powloka = await appearance(b.tenantId);
    expect(powloka).toEqual({ template: "classic" });
  });

  it("STRAŻNIK STRUKTURALNY: ciało funkcji nie sięga po ani jedną kolumnę szkicu", async () => {
    // Gdyby ktoś podmienił źródło na kolumnę szkicu, KAŻDY przypadek wyżej
    // dalej by przeszedł dla najemcy, którego szkic równa się publikacji —
    // a wyciek stanu roboczego do sklepu byłby pełny. Nazwy kolumn na
    // `tenants` są lustrem nazw na `sites`, więc ten skan broni obu tabel.
    const [row] = await sql!<{ def: string }[]>`
      select pg_get_functiondef('app.get_tenant_appearance(uuid)'::regprocedure) as def
    `;
    expect(row!.def.length, "pusta definicja — czujnik po pustym zbiorze").toBeGreaterThan(300);
    expect(row!.def).not.toContain("style_draft");
    expect(row!.def).not.toContain("logo_draft");
    expect(row!.def).toContain("style_published");
    expect(row!.def).toContain("logo_published");
    expect(row!.def).toContain("template_published");

    // Odwołanie do kolumny SZKICU szablonu (`<alias>.template`) po zdjęciu
    // bliźniaka: gołe słowo `template` zostaje, bo jest nazwą klucza koperty.
    expect(
      row!.def.replaceAll("template_published", ""),
      "odczyt publiczny sięga po kolumnę szkicu szablonu",
    ).not.toContain(".template");
  });
});
