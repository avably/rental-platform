import { randomUUID } from "node:crypto";

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
 * WYGLĄD SKLEPU NA POZIOMIE NAJEMCY (0077, ADR-161).
 *
 * Faza 2 (0073–0075) zamieniła wiersze `sites` z wersji jednej strony w osobne
 * STRONY — i tym samym, bez ani jednej linijki o wyglądzie, zamieniła szablon
 * i styl w ustawienie PER PODSTRONA. Ta migracja przenosi je na najemcę.
 * Plik dowodzi siedmiu rzeczy, a każda psuje się inaczej:
 *
 *   1. OKNO WDROŻENIOWE — najemca, który nigdy nic nie zapisał, ma kopertę
 *      BAJTOWO taką, jak przed 0077. Migracja wchodzi na produkcję PRZED kodem,
 *      a stary storefront parsuje kopertę `.strict()`: nadmiarowy klucz kładzie
 *      stronę, a `null` pod bezwarunkowym kluczem `template` kładzie ją tak
 *      samo skutecznie (po drugiej stronie stoi `z.enum`);
 *   2. GLOBALNOŚĆ — dwie różne opublikowane strony JEDNEGO najemcy oddają ten
 *      sam szablon i ten sam styl. To jest zdanie, dla którego cała ta migracja
 *      powstała, i jedyne, którego nie da się wyprowadzić z pozostałych;
 *   3. ZAPIS SZKICU NIE RUSZA SKLEPU — `style_draft` nie zmienia koperty o bajt;
 *   4. PUBLIKACJA PRZENOSI WYGLĄD — i dopiero wtedy koperta dostaje `style`;
 *   5. STRAŻNIK obejmuje obie kolumny opublikowane — bezpośredni zapis rolą,
 *      która MA politykę UPDATE na `tenants` (superadmin), to 42501;
 *   6. PRÓG UPRAWNIENIA — zmiana wyglądu wymaga ŻYWEGO członkostwa, czyli tego
 *      samego progu, którego wymaga publikacja. Przeniesienie kolumn nie ma
 *      prawa obniżyć go przy okazji;
 *   7. IZOLACJA — wygląd najemcy A nie wychodzi na sklep najemcy B, a bramką
 *      jest SAMO ZAPYTANIE (`app.get_published_page` jest SECURITY DEFINER,
 *      więc RLS w nim nie uczestniczy).
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

/** Odmowa UPRAWNIENIA — ten sam SQLSTATE, co RLS i grant (ADR-091). */
const PG_INSUFFICIENT_PRIVILEGE = "42501";
/** Odmowa RPC — jedno zdanie dla wszystkich powodów (wzorzec 0043/0076). */
const PG_INVALID_PARAMETER = "22023";

/** Styl spoza domyślnego motywu — widoczny w kopercie co do bajtu. */
const STYL = { theme: "noir-lux", accent: "champagne" } as const;

const sql = process.env.SUPABASE_LOCAL_URL
  ? postgres(process.env.SUPABASE_LOCAL_URL, { max: 1 })
  : null;

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
let superadmin: SupabaseClient;
let superadminUserId: string;
/** Staff najemcy A — potrzebny do dowodu progu uprawnienia (patrz punkt 6). */
let staffUserId: string;

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

/** Koperta strony GŁÓWNEJ — ta sama droga, którą czyta ją sklep. */
async function envelope(tenantId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await anon
    .schema("app")
    .rpc("get_published_site", { p_tenant_id: tenantId });
  if (error) throw new Error(`get_published_site jako anon zawiodło: ${error.message}`);
  return data as Record<string, unknown> | null;
}

/** Koperta DOWOLNEJ strony po adresie — wejście proxy sklepu (0074). */
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

async function createPublishedSite(ctx: TenantCtx, slug = ""): Promise<string> {
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
  const published = await ctx.ownerClient.schema("app").rpc("publish_site", { p_site_id: siteId });
  if (published.error) throw new Error(`publish_site zawiodło: ${published.error.message}`);
  return siteId;
}

function setStyle(client: SupabaseClient, style: Record<string, unknown>) {
  return client.schema("app").rpc("set_tenant_style", { p_style: style });
}

function publishAppearance(client: SupabaseClient) {
  return client.schema("app").rpc("publish_tenant_appearance");
}

async function appearanceColumns(tenantId: string) {
  const [row] = await sql!<
    {
      template: string;
      template_published: string | null;
      style_draft: unknown;
      style_published: unknown;
    }[]
  >`
    select template, template_published, style_draft, style_published
      from public.tenants where id = ${tenantId}
  `;
  return row!;
}

describe.skipIf(!hasEnv)("wygląd sklepu jest własnością najemcy (0077, ADR-161)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();
    ({ a, b } = await seedTwoTenants());

    // Najemca A ma DWIE opublikowane strony — bez tego „szablon jest globalny"
    // nie ma czego porównać, a test punktu 2 przechodziłby przez pustkę.
    await createPublishedSite(a, "");
    await createPublishedSite(a, "kontakt");
    await createPublishedSite(b, "");

    // Superadmin: JEDYNA rola interaktywna z polityką UPDATE na `tenants`
    // (0001). Bez niego dowód strażnika byłby po pustym zbiorze — członek
    // dostaje od RLS „zero wierszy", a nie odmowę, więc niczego by nie mierzył.
    const email = `tenant-appearance-super-${randomUUID()}@test.local`;
    const created = await admin.auth.admin.createUser({
      email,
      password: "TenantLook!12345678",
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw created.error;
    superadminUserId = created.data.user.id;
    await sql!`insert into app.superadmins (user_id) values (${superadminUserId})`;
    superadmin = createAnonClient();
    const signedIn = await superadmin.auth.signInWithPassword({
      email,
      password: "TenantLook!12345678",
    });
    if (signedIn.error) throw signedIn.error;

    // Staff najemcy A — dowód progu uprawnienia idzie po nim, a nie po
    // ownerze: `app.members_last_owner_guard` nie pozwala usunąć ostatniego
    // właściciela, więc członkostwo odbieramy komuś, komu wolno je odebrać.
    staffUserId = randomUUID();
    await sql!`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values (${staffUserId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`look-staff-${staffUserId}@test.local`}, '', now(), now())
    `;
    await sql!`
      insert into public.members (tenant_id, user_id, role)
      values (${a.tenantId}, ${staffUserId}, 'staff')
    `;
  }, 60_000);

  afterAll(async () => {
    if (staffUserId) {
      await sql!`delete from public.members where user_id = ${staffUserId}`;
      await sql!`delete from auth.users where id = ${staffUserId}`;
    }
    if (superadminUserId) {
      await sql!`delete from app.superadmins where user_id = ${superadminUserId}`;
      await admin.auth.admin.deleteUser(superadminUserId);
    }
    await cleanupSeeded(admin);
    await sql?.end({ timeout: 5 });
  });

  it("kolumny wyglądu istnieją w kształcie, którego wymaga koperta", async () => {
    const rows = await sql!<
      { column_name: string; is_nullable: string; column_default: string | null }[]
    >`
      select column_name, is_nullable, column_default
        from information_schema.columns
       where table_schema = 'public' and table_name = 'tenants'
         and column_name in ('template', 'template_published', 'style_draft', 'style_published')
       order by column_name`;
    expect(rows.map((row) => row.column_name)).toEqual([
      "style_draft",
      "style_published",
      "template",
      "template_published",
    ]);

    const byName = new Map(rows.map((row) => [row.column_name, row]));

    // OSTRA KRAWĘDŹ Z ADR-160: klucz `style` dokłada się warunkowo przez
    // porównanie `= '{}'`. Kolumna dopuszczająca NULL oddałaby w nim NULL
    // zamiast prawdy, `case` wpadłby w gałąź przeciwną i koperta `.strict()`
    // wywróciłaby KAŻDĄ stronę KAŻDEGO sklepu w oknie wdrożeniowym.
    for (const name of ["style_draft", "style_published"]) {
      expect(byName.get(name)!.is_nullable, `${name} musi być NOT NULL`).toBe("NO");
      expect(String(byName.get(name)!.column_default)).toContain("'{}'");
    }

    // Szablon: szkic NOT NULL z motywem zastanym, bliźniak NULLOWALNY —
    // NULL znaczy „najemca nigdy nie publikował wyglądu" (lustro `sites`).
    expect(byName.get("template")!.is_nullable).toBe("NO");
    expect(String(byName.get("template")!.column_default)).toContain("'classic'");
    expect(byName.get("template_published")!.is_nullable).toBe("YES");
  });

  it("OKNO WDROŻENIOWE: najemca bez zapisanego wyglądu ma kopertę sprzed migracji", async () => {
    const koperta = await envelope(a.tenantId);
    expect(koperta).not.toBeNull();
    // Ani jednego klucza więcej: nadmiarowy klucz kładzie stary storefront.
    expect(Object.keys(koperta!).sort()).toEqual(["published_at", "sections", "template"]);
    // I ani jednego `null` pod kluczem bezwarunkowym: `template_published` jest
    // dla świeżego najemcy NULL-em, więc bez `coalesce` w odczycie koperta
    // niosłaby `"template": null`, a `z.enum` po drugiej stronie kładzie na tym
    // CAŁĄ stronę — tak samo skutecznie jak klucz nieznany.
    expect(koperta!.template, "koperta bez ważnego szablonu").toBe("classic");
    expect((await appearanceColumns(a.tenantId)).template_published).toBeNull();
  });

  it("GLOBALNOŚĆ: dwie strony jednego najemcy mają ten sam szablon i ten sam styl", async () => {
    // TO JEST ZDANIE, DLA KTÓREGO POWSTAŁA MIGRACJA 0077. Przed nią wygląd
    // siedział na wierszu strony, więc „Kontakt" mógł mieć inny motyw niż
    // strona główna — nagłówek zmieniał krój i kolor przy przejściu między
    // podstronami TEGO SAMEGO sklepu.
    expect((await setStyle(a.ownerClient, { ...STYL })).error).toBeNull();
    expect((await publishAppearance(a.ownerClient)).error).toBeNull();

    const glowna = await pageEnvelope(a.tenantId, "");
    const kontakt = await pageEnvelope(a.tenantId, "kontakt");
    expect(glowna, "strona główna nie jest opublikowana — dowód po pustym zbiorze").not.toBeNull();
    expect(kontakt, "druga strona nie jest opublikowana — dowód po pustym zbiorze").not.toBeNull();

    expect(kontakt!.style, "druga strona sklepu ma INNY styl niż główna").toEqual(glowna!.style);
    expect(kontakt!.template, "druga strona sklepu ma INNY szablon niż główna").toEqual(
      glowna!.template,
    );
    expect(glowna!.style).toEqual(STYL);

    // Treść pozostaje WŁASNOŚCIĄ STRONY — inaczej dowód wyżej mówiłby tylko
    // tyle, że obie koperty są tym samym wierszem.
    expect(JSON.stringify(kontakt!.sections)).not.toBe(JSON.stringify(glowna!.sections));
  });

  it("zapis SZKICU wyglądu nie zmienia koperty ani o bajt", async () => {
    const przed = JSON.stringify(await envelope(a.tenantId));

    const saved = await setStyle(a.ownerClient, { theme: "classic", accent: "forest" });
    expect(saved.error, saved.error?.message).toBeNull();
    expect((await appearanceColumns(a.tenantId)).style_draft).toEqual({
      theme: "classic",
      accent: "forest",
    });

    expect(JSON.stringify(await envelope(a.tenantId))).toBe(przed);
  });

  it("PUBLIKACJA przenosi wygląd — obie pary naraz", async () => {
    const published = await publishAppearance(a.ownerClient);
    expect(published.error, published.error?.message).toBeNull();

    const columns = await appearanceColumns(a.tenantId);
    expect(columns.style_published).toEqual(columns.style_draft);
    // Bliźniak szablonu jedzie w tej samej publikacji: motyw zastany jest
    // fallbackiem dla najemcy bez zapisanego stylu, więc bez niego bliźniak
    // niósłby połowę wyglądu.
    expect(columns.template_published).toBe(columns.template);

    const koperta = await envelope(a.tenantId);
    expect(Object.keys(koperta!).sort()).toEqual([
      "published_at",
      "sections",
      "style",
      "template",
    ]);
    expect(koperta!.style).toEqual({ theme: "classic", accent: "forest" });
  });

  it("pusty obiekt zdejmuje styl ze sklepu po publikacji", async () => {
    expect((await setStyle(a.ownerClient, {})).error).toBeNull();
    expect((await publishAppearance(a.ownerClient)).error).toBeNull();

    const koperta = await envelope(a.tenantId);
    expect(Object.keys(koperta!).sort()).toEqual(["published_at", "sections", "template"]);
    expect(koperta!.template).toBe("classic");
  });

  it("STRAŻNIK: superadmin nie zapisze wprost ani stylu, ani szablonu opublikowanego", async () => {
    for (const patch of [{ style_published: STYL }, { template_published: "bold" }]) {
      const { error } = await superadmin.from("tenants").update(patch).eq("id", b.tenantId);
      expect(error?.code, `przeszedł zapis ${JSON.stringify(patch)}: ${error?.message}`).toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
    }
  });

  it("zapis TĄ SAMĄ wartością przechodzi — strażnik broni ZMIANY", async () => {
    const { error } = await superadmin
      .from("tenants")
      .update({ style_published: {}, template_published: null })
      .eq("id", b.tenantId);
    expect(error, `zapis bez zmiany powinien przejść: ${error?.message}`).toBeNull();
  });

  it("najemca nie może URODZIĆ SIĘ z opublikowanym wyglądem — INSERT to 42501", async () => {
    for (const patch of [{ style_published: STYL }, { template_published: "bold" }]) {
      const { error } = await superadmin
        .from("tenants")
        .insert({ slug: `look-guard-${randomUUID().slice(0, 8)}`, name: "Strażnik", ...patch })
        .select("id");
      expect(error?.code, `przeszedł INSERT ${JSON.stringify(patch)}: ${error?.message}`).toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
    }
  });

  it("anon nie ma EXECUTE ani do zapisu, ani do publikacji wyglądu", async () => {
    expect((await setStyle(anon, {})).error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    expect((await publishAppearance(anon)).error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
  });

  it("PRÓG UPRAWNIENIA: zmiana wyglądu wymaga ŻYWEGO członkostwa, tak jak publikacja", async () => {
    // Token członka żyje jeszcze do godziny po usunięciu z zespołu (ADR-126),
    // więc claim SAM W SOBIE nie może wystarczyć. Symulujemy to dokładnie tak,
    // jak robi to bramka predykatów live: te same claimy przed i po.
    const claims = JSON.stringify({
      sub: staffUserId,
      role: "authenticated",
      app_metadata: { tenant_id: a.tenantId, role: "staff" },
    });
    const asStaff = async <T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
      sql!.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx`set local role authenticated`;
        return fn(tx);
      });

    // KONTROLA POZYTYWNA — bez niej „odmowa" nie dowodzi niczego: mogłaby
    // wynikać z byle czego w konstrukcji sesji, a nie z odebranego dostępu.
    await expect(
      asStaff((tx) => tx`select app.set_tenant_style('{"theme":"classic"}'::jsonb)`),
    ).resolves.toBeDefined();
    await expect(asStaff((tx) => tx`select app.publish_tenant_appearance()`)).resolves.toBeDefined();

    await sql!`delete from public.members where tenant_id = ${a.tenantId} and user_id = ${staffUserId}`;

    await expect(
      asStaff((tx) => tx`select app.set_tenant_style('{"theme":"bold-brutal"}'::jsonb)`),
      "były członek zapisał wygląd sklepu",
    ).rejects.toMatchObject({ code: PG_INVALID_PARAMETER });
    await expect(
      asStaff((tx) => tx`select app.publish_tenant_appearance()`),
      "były członek opublikował wygląd sklepu",
    ).rejects.toMatchObject({ code: PG_INVALID_PARAMETER });

    // Wygląd nietknięty przez odrzucone zapisy.
    expect((await appearanceColumns(a.tenantId)).style_draft).toEqual({ theme: "classic" });

    await sql!`
      insert into public.members (tenant_id, user_id, role)
      values (${a.tenantId}, ${staffUserId}, 'staff')
    `;
  });

  it("IZOLACJA: wygląd najemcy A nie wychodzi na sklep najemcy B", async () => {
    // Asercja nazwana WPROST o izolację, a nie o publikację czy okno handlowe.
    // `app.get_published_page` jest SECURITY DEFINER, więc RLS w tym odczycie
    // NIE UCZESTNICZY — jedyną bramką jest warunek złączenia `t.id =
    // s.tenant_id` złożony z filtrem `s.tenant_id = p_tenant_id`. Bez niego
    // sklep najemcy B renderowałby się motywem najemcy A.
    expect((await setStyle(a.ownerClient, { ...STYL })).error).toBeNull();
    expect((await publishAppearance(a.ownerClient)).error).toBeNull();

    const kopertaA = await pageEnvelope(a.tenantId, "");
    const kopertaB = await pageEnvelope(b.tenantId, "");
    expect(kopertaA, "brak koperty A — dowód po pustym zbiorze").not.toBeNull();
    expect(kopertaB, "brak koperty B — dowód po pustym zbiorze").not.toBeNull();

    expect(kopertaA!.style, "kontrola pozytywna: najemca A NIE MA stylu").toEqual(STYL);
    expect(Object.keys(kopertaB!), "styl najemcy A wyciekł na sklep najemcy B").not.toContain(
      "style",
    );
    expect(kopertaB!.template, "szablon najemcy A wyciekł na sklep najemcy B").toBe("classic");
  });

  it("IZOLACJA ZAPISU: najemca A nie zapisze ani nie opublikuje wyglądu najemcy B", async () => {
    // Tenant bierze się z `app.tenant_id()`, a nie z argumentu, więc „zapisz
    // cudzy wygląd" nie jest odmawiane — jest NIEWYRAŻALNE. Dowodem jest to,
    // że wywołanie ownera A zmienia WYŁĄCZNIE wiersz A.
    const przedB = await appearanceColumns(b.tenantId);
    expect((await setStyle(a.ownerClient, { theme: "bold-brutal" })).error).toBeNull();
    expect((await publishAppearance(a.ownerClient)).error).toBeNull();

    const poB = await appearanceColumns(b.tenantId);
    expect(poB, "wywołanie najemcy A ruszyło wiersz najemcy B").toEqual(przedB);
    expect((await appearanceColumns(a.tenantId)).style_published).toEqual({ theme: "bold-brutal" });

    // Odczyt wiersza cudzego najemcy: RLS oddaje zero wierszy (own_select).
    const foreign = await a.ownerClient
      .from("tenants")
      .select("id, style_published")
      .eq("id", b.tenantId);
    expect(foreign.data ?? []).toEqual([]);
  });

  it("odczyt publiczny nie czyta ANI JEDNEJ kolumny szkicu wyglądu najemcy", async () => {
    // Strażnik STRUKTURALNY (wzorzec z site-style-gate/tenant-logo): gdyby ktoś
    // podmienił źródło koperty na kolumnę szkicu, wszystkie testy wyżej dalej
    // by przeszły dla najemcy, którego szkic równa się publikacji — a wyciek
    // byłby pełny. Nazwy kolumn na `tenants` są LUSTREM nazw na `sites`, więc
    // ten skan broni obu tabel naraz.
    const [row] = await sql!<{ def: string }[]>`
      select pg_get_functiondef('app.get_published_site(uuid)'::regprocedure)
        || pg_get_functiondef('app.get_published_page(uuid,text)'::regprocedure) as def
    `;
    expect(row!.def.length, "puste definicje — czujnik po pustym zbiorze").toBeGreaterThan(500);
    expect(row!.def).not.toContain("style_draft");
    expect(row!.def).toContain("style_published");
    expect(row!.def).toContain("template_published");

    // Odwołanie do kolumny SZKICU szablonu (`<alias>.template`) po zdjęciu
    // bliźniaka: gołe słowo `template` zostaje, bo jest nazwą klucza koperty.
    expect(
      row!.def.replaceAll("template_published", ""),
      "odczyt publiczny sięga po kolumnę szkicu szablonu",
    ).not.toContain(".template");
  });
});
