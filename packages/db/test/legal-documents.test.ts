/**
 * Dokumenty prawne sklepu najemcy — szkic, NIEZMIENNE wersje i przypięcie
 * zamówienia do wiersza wersji (B4, migracja 0063_legal_documents.sql, ADR-129;
 * zamyka R18).
 *
 * Test dowodzi pięciu osi:
 *   1. PUBLIKACJA jest jedynym zdarzeniem, które zmienia to, co widać publicznie
 *      — edycja szkicu nie rusza treści w sklepie, a publikacja bez zmiany
 *      treści nie zaśmieca rejestru wersją-duplikatem.
 *   2. NIEZMIENNOŚĆ: opublikowanej wersji nie zmieni ani nie usunie nawet
 *      właściciel (42501 z grantu, strażnik jako druga warstwa).
 *   3. IZOLACJA: dokument jednego najemcy nie wychodzi pod identyfikatorem
 *      drugiego, szkic nie wychodzi w ogóle, a personel nie pisze.
 *   4. R18: orders.terms_version_id rozstrzyga BAZA po p_tenant_id. Payload nie
 *      przypnie ani cudzej, ani nieistniejącej wersji; deklaracja zgodna ze
 *      starą etykietą odrzuca zamówienie zamiast zapisać nieprawdę.
 *   5. OKAZANIE: po opublikowaniu nowej wersji stara nadal daje się odczytać
 *      permalinkiem, bajt w bajt, z tym samym sha256.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* —
 * bez nich plik jest pomijany przez strażnik jawności.
 */
import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import { publishLegalDocuments } from "./helpers/publish-legal-documents";

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

const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_INVALID_PARAMETER = "22023";

// Klasa-sygnał do wymuszenia ROLLBACK sondy strażnika: cały dowód biegnie
// w jednej transakcji, którą na końcu odwijamy, żeby zdjęte warstwy (grant,
// polityka) nie przeciekły do żadnej innej sesji (wzorzec z checkout-ticket
// i account-email-logs).
class Rollback extends Error {}

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

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

interface Actor {
  userId: string;
  client: SupabaseClient;
}

async function seedTenant(admin: SupabaseClient, status = "active"): Promise<string> {
  const slug = `legal-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: `Legal test ${status}`, status, locale: "pl" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać tenanta: ${error?.message}`);
  createdTenantIds.push(data.id as string);
  return data.id as string;
}

/** Zalogowany członek tenanta o zadanej roli — bramką testu jest RLS, nie atrapa. */
async function seedActor(
  admin: SupabaseClient,
  tenantId: string,
  role: "owner" | "staff",
): Promise<Actor> {
  const email = `${role}-${randomUUID().slice(0, 8)}@test.local`;
  const password = "LegalDocsTest!12345678";
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { tenant_id: tenantId, role },
  });
  if (error || !data.user) throw new Error(`Nie udało się utworzyć ${role}: ${error?.message}`);
  createdUserIds.push(data.user.id);

  const { error: memberError } = await admin
    .from("members")
    .insert({ tenant_id: tenantId, user_id: data.user.id, role });
  if (memberError) throw new Error(`Nie udało się dodać członka: ${memberError.message}`);

  const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Nie udało się zalogować ${role}: ${signInError.message}`);
  return { userId: data.user.id, client };
}

/** Szkic dokumentu zakładany rolą serwisową — test bada publikację, nie formularz. */
async function seedDraft(
  admin: SupabaseClient,
  tenantId: string,
  kind: "terms" | "privacy",
  body: string,
  title = "Regulamin",
): Promise<string> {
  const { data, error } = await admin
    .from("legal_documents")
    .insert({ tenant_id: tenantId, kind, title, body_draft: body, locale: "pl" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać szkicu: ${error?.message}`);
  return data.id as string;
}

interface PublishResult {
  version_id: string;
  version_no: number;
  version_label: string;
  published_at: string;
  created: boolean;
}

async function publish(actor: Actor, kind: "terms" | "privacy"): Promise<PublishResult> {
  const { data, error } = await actor.client
    .schema("app")
    .rpc("publish_legal_document", { p_kind: kind });
  if (error) throw new Error(`Publikacja nie powiodła się: ${error.message} (${error.code})`);
  return data as PublishResult;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// --- minimalny sklep, żeby checkout miał co sprzedać -------------------

async function seedSellableTenant(admin: SupabaseClient): Promise<{
  tenantId: string;
  productId: string;
  pickupId: string;
}> {
  const tenantId = await seedTenant(admin);
  const { data: product, error: productError } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: `Produkt ${randomUUID().slice(0, 8)}`,
      base_price_day_grosze: 10_000,
      deposit_grosze: 0,
    })
    .select("id")
    .single();
  if (productError || !product) throw new Error(`Produkt: ${productError?.message}`);

  const { data: pickup, error: pickupError } = await admin
    .from("pickup_locations")
    .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Warszawa" })
    .select("id")
    .single();
  if (pickupError || !pickup) throw new Error(`Punkt odbioru: ${pickupError?.message}`);

  const units = Array.from({ length: 4 }, () => ({
    tenant_id: tenantId,
    product_id: product.id as string,
    serial_number: `SN-${randomUUID().slice(0, 8)}`,
  }));
  const { error: unitsError } = await admin.from("product_units").insert(units);
  if (unitsError) throw new Error(`Egzemplarze: ${unitsError.message}`);

  return { tenantId, productId: product.id as string, pickupId: pickup.id as string };
}

function checkoutArgs(
  tenantId: string,
  productId: string,
  pickupId: string,
  termsVersion: string,
): Record<string, unknown> {
  return {
    p_tenant_id: tenantId,
    p_email: `legal-${randomUUID().slice(0, 8)}@test.local`,
    p_full_name: "Kupujący",
    p_phone: null,
    p_start_date: "2026-11-02",
    p_end_date: "2026-11-04",
    p_delivery_method: "pickup",
    p_pickup_location_id: pickupId,
    p_items: [{ product_id: productId, quantity: 1 }],
    p_terms_version: termsVersion,
    p_locale: "pl",
  };
}

describe.skipIf(!hasEnv)("dokumenty prawne najemcy — 0063 / ADR-129", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
    createdUserIds.length = 0;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
      createdTenantIds.length = 0;
    }
  });

  // -------------------------------------------------------------------
  // 1. Publikacja jako jedyne zdarzenie zmieniające stan publiczny
  // -------------------------------------------------------------------

  it("szkic nie jest widoczny publicznie, dopóki właściciel nie opublikuje", async () => {
    const tenantId = await seedTenant(admin);
    const owner = await seedActor(admin, tenantId, "owner");
    await seedDraft(admin, tenantId, "terms", "Treść regulaminu, wersja pierwsza.");

    const before = await anon
      .schema("app")
      .rpc("get_published_legal_document", { p_tenant_id: tenantId, p_kind: "terms" });
    expect(before.error, "odczyt publiczny nie powinien błądzić").toBeNull();
    expect(before.data, "szkic wyszedł publicznie przed publikacją").toBeNull();

    const published = await publish(owner, "terms");
    expect(published.created).toBe(true);
    expect(published.version_no).toBe(1);
    expect(published.version_label).toBe("v1");

    const after = await anon
      .schema("app")
      .rpc("get_published_legal_document", { p_tenant_id: tenantId, p_kind: "terms" });
    expect(after.error).toBeNull();
    expect(after.data?.body).toBe("Treść regulaminu, wersja pierwsza.");
    expect(after.data?.version_label).toBe("v1");
    expect(
      after.data?.sha256,
      "sha256 musi być liczony przez bazę z bajtów treści",
    ).toBe(sha256Hex("Treść regulaminu, wersja pierwsza."));
  });

  it("edycja szkicu po publikacji NIE zmienia treści widocznej w sklepie", async () => {
    const tenantId = await seedTenant(admin);
    const owner = await seedActor(admin, tenantId, "owner");
    await seedDraft(admin, tenantId, "terms", "Wersja opublikowana.");
    await publish(owner, "terms");

    const { error: draftError } = await owner.client
      .from("legal_documents")
      .update({ body_draft: "Wersja robocza, jeszcze nieopublikowana." })
      .eq("tenant_id", tenantId)
      .eq("kind", "terms");
    expect(draftError, "właściciel musi móc edytować własny szkic").toBeNull();

    const { data } = await anon
      .schema("app")
      .rpc("get_published_legal_document", { p_tenant_id: tenantId, p_kind: "terms" });
    expect(
      data?.body,
      "sklep pokazał treść szkicu — publikacja przestała być jedynym zdarzeniem",
    ).toBe("Wersja opublikowana.");
  });

  it("publikacja bez zmiany treści nie tworzy drugiej wersji", async () => {
    const tenantId = await seedTenant(admin);
    const owner = await seedActor(admin, tenantId, "owner");
    await seedDraft(admin, tenantId, "terms", "Treść bez zmian.");

    const first = await publish(owner, "terms");
    const second = await publish(owner, "terms");

    expect(second.created).toBe(false);
    expect(second.version_id).toBe(first.version_id);

    const { count } = await admin
      .from("legal_document_versions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    expect(count, "rejestr urósł o wersję-duplikat").toBe(1);
  });

  it("zmiana treści i publikacja daje wersję 2, a wersja 1 zostaje nietknięta", async () => {
    const tenantId = await seedTenant(admin);
    const owner = await seedActor(admin, tenantId, "owner");
    await seedDraft(admin, tenantId, "terms", "Pierwsza treść.");
    const v1 = await publish(owner, "terms");

    await owner.client
      .from("legal_documents")
      .update({ body_draft: "Druga treść." })
      .eq("tenant_id", tenantId)
      .eq("kind", "terms");
    const v2 = await publish(owner, "terms");

    expect(v2.created).toBe(true);
    expect(v2.version_no).toBe(2);
    expect(v2.version_label).toBe("v2");

    const { data: stored } = await admin
      .from("legal_document_versions")
      .select("body,sha256,version_no")
      .eq("id", v1.version_id)
      .single();
    expect(stored?.body).toBe("Pierwsza treść.");
    expect(stored?.sha256).toBe(sha256Hex("Pierwsza treść."));
  });

  // -------------------------------------------------------------------
  // 2. Niezmienność rejestru
  // -------------------------------------------------------------------

  it("właściciel NIE zmieni ani nie usunie opublikowanej wersji (42501)", async () => {
    const tenantId = await seedTenant(admin);
    const owner = await seedActor(admin, tenantId, "owner");
    await seedDraft(admin, tenantId, "terms", "Treść do podmiany.");
    const version = await publish(owner, "terms");

    const { error: updateError } = await owner.client
      .from("legal_document_versions")
      .update({ body: "Podmieniona treść." })
      .eq("id", version.version_id);
    expect(updateError?.code, "UPDATE opublikowanej wersji przeszedł").toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );

    const { error: deleteError } = await owner.client
      .from("legal_document_versions")
      .delete()
      .eq("id", version.version_id);
    expect(deleteError?.code, "DELETE opublikowanej wersji przeszedł").toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );

    const { data: stored } = await admin
      .from("legal_document_versions")
      .select("body")
      .eq("id", version.version_id)
      .single();
    expect(stored?.body).toBe("Treść do podmiany.");
  });

  it("strażnik odbija UPDATE po zdjęciu OBU wcześniejszych warstw", async () => {
    // Warstwa trzecia niezmienności (sekcja 4 migracji). Dowód wymaga zdjęcia
    // dwóch warstw stojących wyżej, bo inaczej milczą one, a nie strażnik:
    // bez GRANT-u odmowa przychodzi z uprawnień, a bez zdjęcia RLS zapytanie po
    // prostu nie widzi wiersza i kończy bez błędu (zmierzone — pierwsza wersja
    // tego testu przechodziła na ciszy, nie na strażniku). Dopiero grant + brak
    // RLS zostawiają strażnika samego, a wtedy MUSI odmówić.
    //
    // CAŁY DOWÓD BIEGNIE W JEDNEJ TRANSAKCJI ZAMKNIĘTEJ ROLLBACK-iem. Wcześniej
    // dowód robił globalny `grant ... to authenticated` z odwołaniem w `finally`;
    // grant otwierał OKNO widoczne dla każdej równoległej sesji, a że baza
    // lokalna bywa współdzielona, w tym oknie sąsiedni test niezmienności
    // widział wersję jako usuwalną i wywracał się (zmierzone 1×: 792/793). GRANT
    // i CREATE POLICY to zmiany katalogu widoczne tylko dla własnej transakcji
    // aż do COMMIT-u — my nie komitujemy, więc żadna inna sesja ich nie zobaczy,
    // a proces ubity w połowie sondy nie zostawia śladu (ROLLBACK robi za nas
    // serwer, bez `finally`). Rolę i claimy stawiamy dokładnie jak PostgREST:
    // `set local role authenticated` + `request.jwt.claims` właściciela — więc
    // strażnik widzi NIE-serwisowego wołającego, a nie sztuczną rolę.
    //
    // DLACZEGO PĘTLA I `deadlock_timeout`. CREATE POLICY zakłada AccessExclusive
    // na tabeli i pod współbieżnością wchodzi w cykl zamków z sąsiednim testem
    // zakładającym konto (wstawki do auth.users/identities) — zmierzone
    // zakleszczenie. Nie da się go usunąć samą kolejnością zamków (partnerem są
    // katalogi auth, nie ta tabela), więc zamiast tego: (1) skrajnie krótki
    // `deadlock_timeout` sprawia, że to TA transakcja pierwsza uruchamia detektor
    // i to JĄ serwer zrywa — sąsiad nie pada zamiast niej; (2) zerwaną próbę
    // (40P01) po prostu ponawiamy. Zasiew jest POZA pętlą; ponawiamy wyłącznie
    // błyskawiczną transakcję-sondę, więc koszt jest znikomy, a dowód pewny.
    const tenantId = await seedTenant(admin);
    const owner = await seedActor(admin, tenantId, "owner");
    await seedDraft(admin, tenantId, "terms", "Treść chroniona strażnikiem.");
    const version = await publish(owner, "terms");

    const ownerClaims = JSON.stringify({
      sub: owner.userId,
      role: "authenticated",
      app_metadata: { tenant_id: tenantId, role: "owner" },
    });

    const PG_DEADLOCK = "40P01";
    const MAX_ATTEMPTS = 10;
    let controlRows = -1;
    let guardCode: string | undefined;
    let storedTitle: string | undefined;
    let proven = false;

    const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !proven; attempt++) {
        // Każda próba jest niezależna — zerwana (deadlock) nie zostawia stanu.
        controlRows = -1;
        guardCode = undefined;
        storedTitle = undefined;
        try {
          await sql.begin(async (tx) => {
            // Ta transakcja ma być OFIARĄ ewentualnego zakleszczenia.
            await tx`set local deadlock_timeout = '20ms'`;

            // Zdjęcie OBU warstw — tylko wewnątrz transakcji, znika w ROLLBACK-u.
            await tx`grant update on public.legal_document_versions to authenticated`;
            await tx`
              create policy probe_update on public.legal_document_versions
                for update using (true) with check (true)
            `;
            await tx`select set_config('request.jwt.claims', ${ownerClaims}, true)`;
            await tx`set local role authenticated`;

            // KONTROLA POZYTYWNA sondy: ta sama rola i te same claimy, a szkic
            // (bez strażnika) daje się zmienić — więc gdy wersji zmienić się NIE
            // da, to zasługa strażnika, a nie ciszy RLS ani martwej sondy z JWT.
            const control = await tx<{ id: string }[]>`
              update public.legal_documents set title = 'Kontrola pozytywna'
              where tenant_id = ${tenantId} and kind = 'terms'
              returning id
            `;
            controlRows = control.length;

            // STRAŻNIK: z grantem i polityką permisywną wersja MUSI odbić UPDATE
            // wyjątkiem 42501 — nie ciszą (using(true) pokazuje wiersz), nie
            // odmową RLS (with check(true) nigdy nie pęka), nie brakiem prawa
            // (grant jest), tylko wyjątkiem z triggera. Savepoint, bo wyjątek
            // wprowadza transakcję w stan „aborted".
            try {
              await tx.savepoint(async (sp) => {
                await sp`
                  update public.legal_document_versions set title = 'Tytuł podmieniony'
                  where id = ${version.version_id}
                `;
              });
            } catch (error) {
              // Zakleszczenie zrywa CAŁĄ transakcję — nie jest odpowiedzią
              // strażnika, więc wypuszczamy je do pętli ponawiającej.
              if ((error as { code?: string }).code === PG_DEADLOCK) throw error;
              guardCode = (error as { code?: string }).code;
            }

            // Weryfikacja w tej samej transakcji (znów superuser, RLS omijane):
            // wiersz nietknięty, bo strażnik odbił zapis PRZED nim.
            await tx`reset role`;
            const [row] = await tx<{ title: string }[]>`
              select title from public.legal_document_versions where id = ${version.version_id}
            `;
            storedTitle = row?.title;

            proven = true;
            throw new Rollback();
          });
        } catch (error) {
          if (error instanceof Rollback) break; // sonda skończona — ROLLBACK
          if ((error as { code?: string }).code === PG_DEADLOCK) continue; // ponów
          throw error;
        }
      }
    } finally {
      await sql.end({ timeout: 5 });
    }

    expect(proven, `sonda strażnika zakleszczała się w każdej z ${MAX_ATTEMPTS} prób`).toBe(true);
    expect(controlRows, "kontrola pozytywna nie przeszła — sonda nic nie dowodzi").toBe(1);
    expect(
      guardCode,
      "z grantem i polityką permisywną wersję dało się zmienić — strażnik nie działa",
    ).toBe(PG_INSUFFICIENT_PRIVILEGE);
    expect(storedTitle).toBe("Regulamin");
  });

  // -------------------------------------------------------------------
  // 3. Izolacja najemców i ról
  // -------------------------------------------------------------------

  it("dokument najemcy A nie wychodzi pod identyfikatorem najemcy B", async () => {
    const tenantA = await seedTenant(admin);
    const tenantB = await seedTenant(admin);
    const ownerA = await seedActor(admin, tenantA, "owner");
    await seedDraft(admin, tenantA, "terms", "Regulamin najemcy A.");
    await publish(ownerA, "terms");

    const { data: fromB } = await anon
      .schema("app")
      .rpc("get_published_legal_document", { p_tenant_id: tenantB, p_kind: "terms" });
    expect(fromB, "dokument najemcy A wyszedł na osi najemcy B").toBeNull();

    const { data: listFromB } = await anon
      .schema("app")
      .rpc("get_published_legal_documents", { p_tenant_id: tenantB });
    expect(listFromB, "spis dokumentów przeciekł między najemcami").toEqual([]);
  });

  it("anon nie czyta tabel bezpośrednio — ani szkiców, ani wersji", async () => {
    const tenantId = await seedTenant(admin);
    const owner = await seedActor(admin, tenantId, "owner");
    await seedDraft(admin, tenantId, "terms", "Treść niedostępna anonowi.");
    await publish(owner, "terms");

    const drafts = await anon.from("legal_documents").select("body_draft");
    expect(drafts.data ?? [], "anon zobaczył szkice").toHaveLength(0);
    const versions = await anon.from("legal_document_versions").select("body");
    expect(versions.data ?? [], "anon zobaczył wersje przez PostgREST").toHaveLength(0);
  });

  it("personel czyta dokument, ale go nie zapisze ani nie opublikuje", async () => {
    const tenantId = await seedTenant(admin);
    const owner = await seedActor(admin, tenantId, "owner");
    const staff = await seedActor(admin, tenantId, "staff");
    await seedDraft(admin, tenantId, "terms", "Treść widoczna dla personelu.");
    await publish(owner, "terms");

    const { data: read, error: readError } = await staff.client
      .from("legal_documents")
      .select("body_draft")
      .eq("tenant_id", tenantId);
    expect(readError).toBeNull();
    expect(read ?? [], "personel nie widzi dokumentu własnego najemcy").toHaveLength(1);

    const { error: writeError } = await staff.client
      .from("legal_documents")
      .update({ body_draft: "Personel podmienił regulamin." })
      .eq("tenant_id", tenantId)
      .eq("kind", "terms");
    const { data: afterWrite } = await admin
      .from("legal_documents")
      .select("body_draft")
      .eq("tenant_id", tenantId)
      .eq("kind", "terms")
      .single();
    expect(
      [writeError?.code, afterWrite?.body_draft],
      "personel zmienił treść dokumentu prawnego",
    ).toEqual([writeError?.code, "Treść widoczna dla personelu."]);

    const { error: publishError } = await staff.client
      .schema("app")
      .rpc("publish_legal_document", { p_kind: "terms" });
    expect(publishError, "personel opublikował dokument prawny").not.toBeNull();
  });

  it("anon nie wykona publikacji — grant tylko dla authenticated", async () => {
    const { error } = await anon
      .schema("app")
      .rpc("publish_legal_document", { p_kind: "terms" });
    expect(error?.code, "anon dostał EXECUTE na publikację").toBe(PG_INSUFFICIENT_PRIVILEGE);
  });

  it("najemca zawieszony przestaje pokazywać dokument", async () => {
    const tenantId = await seedTenant(admin);
    const owner = await seedActor(admin, tenantId, "owner");
    await seedDraft(admin, tenantId, "terms", "Regulamin sklepu zawieszonego.");
    await publish(owner, "terms");

    await admin.from("tenants").update({ status: "suspended" }).eq("id", tenantId);
    const { data } = await anon
      .schema("app")
      .rpc("get_published_legal_document", { p_tenant_id: tenantId, p_kind: "terms" });
    expect(data, "sklep zawieszonego najemcy dalej pokazuje regulamin").toBeNull();
  });

  it("funkcje publiczne mają definer, przypięty search_path i świadome granty", async () => {
    const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    try {
      const rows = await sql<
        {
          name: string;
          prosecdef: boolean;
          proconfig: string[] | null;
          anon_exec: boolean;
          public_exec: boolean;
        }[]
      >`
        select p.oid::regprocedure::text as name,
               p.prosecdef,
               p.proconfig,
               has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
               has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and p.proname in (
            'get_published_legal_document',
            'get_published_legal_documents',
            'get_legal_document_version'
          )
      `;
      expect(rows.length, "brak funkcji odczytu publicznego").toBe(3);
      for (const row of rows) {
        expect(row.prosecdef, `${row.name}: brak SECURITY DEFINER`).toBe(true);
        expect(row.proconfig?.join(","), `${row.name}: brak przypiętego search_path`).toContain(
          "search_path=",
        );
        expect(row.anon_exec, `${row.name}: anon nie może wykonać odczytu publicznego`).toBe(true);
      }

      const [publishRow] = await sql<{ anon_exec: boolean }[]>`
        select has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'publish_legal_document'
      `;
      expect(publishRow?.anon_exec, "anon ma EXECUTE na publikację").toBe(false);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  // -------------------------------------------------------------------
  // 4. R18 — zamówienie wskazuje WIERSZ wersji
  // -------------------------------------------------------------------

  it("checkout przy zgodnej etykiecie przypina wiersz wersji", async () => {
    const shop = await seedSellableTenant(admin);
    const owner = await seedActor(admin, shop.tenantId, "owner");
    await seedDraft(admin, shop.tenantId, "terms", "Regulamin sprzedażowy v1.");
    const version = await publish(owner, "terms");
    // Od 0086 sprzedaż wymaga KOMPLETU — polityka prywatności obok regulaminu.
    await seedDraft(admin, shop.tenantId, "privacy", "Polityka prywatności v1.");
    await publish(owner, "privacy");

    const { data, error } = await anon
      .schema("app")
      .rpc("public_checkout", checkoutArgs(shop.tenantId, shop.productId, shop.pickupId, "v1"));
    expect(error, `checkout odrzucony: ${error?.message}`).toBeNull();

    const { data: order } = await admin
      .from("orders")
      .select("terms_version,terms_version_id,terms_accepted_at")
      .eq("tenant_id", shop.tenantId)
      .eq("order_number", (data as { order_number: string }).order_number)
      .single();
    expect(order?.terms_version_id, "zamówienie nie wskazało wiersza wersji").toBe(
      version.version_id,
    );
    expect(order?.terms_version).toBe("v1");
    expect(order?.terms_accepted_at).not.toBeNull();
  });

  it("żywa etykieta najemcy A deklarowana w sklepie B nie przypina wersji A (izolacja)", async () => {
    // Sklep B ma KOMPLET własnych dokumentów (v1). Najemca A opublikował
    // regulamin DWA razy — jego żywa etykieta to v2, czyli napis, który w
    // rejestrze B nie istnieje. Deklaracja v2 w sklepie B musi przejść
    // gałęzią (d): zapis napisu, ZERO przypięcia — a nie wierszem najemcy A.
    const shop = await seedSellableTenant(admin);
    await publishLegalDocuments(admin, shop.tenantId);

    const foreign = await seedTenant(admin);
    const foreignOwner = await seedActor(admin, foreign, "owner");
    await seedDraft(admin, foreign, "terms", "Regulamin obcego najemcy v1.");
    await publish(foreignOwner, "terms");
    await foreignOwner.client
      .from("legal_documents")
      .update({ body_draft: "Regulamin obcego najemcy v2." })
      .eq("tenant_id", foreign)
      .eq("kind", "terms");
    const foreignLive = await publish(foreignOwner, "terms");
    expect(foreignLive.version_label, "fikstura: obcy ma mieć żywe v2").toBe("v2");

    const { data, error } = await anon
      .schema("app")
      .rpc(
        "public_checkout",
        checkoutArgs(shop.tenantId, shop.productId, shop.pickupId, foreignLive.version_label),
      );
    expect(error, `checkout odrzucony: ${error?.message}`).toBeNull();

    const { data: order } = await admin
      .from("orders")
      .select("terms_version,terms_version_id")
      .eq("tenant_id", shop.tenantId)
      .eq("order_number", (data as { order_number: string }).order_number)
      .single();
    expect(
      order?.terms_version_id,
      "payload przypiął wersję, której najemca nigdy nie opublikował",
    ).toBeNull();
    expect(order?.terms_version).toBe(foreignLive.version_label);
  });

  it("id SZKICU nie da się przypiąć nawet service_rolem — rejestr wersji to jedyny cel FK", async () => {
    // Szkic żyje w legal_documents i NIE MA reprezentacji w rejestrze wersji,
    // więc zgoda „na szkic" jest niereprezentowalna z konstrukcji. FK celuje
    // w legal_document_versions — id szkicu musi się odbić, choć jest
    // poprawnym uuid istniejącego wiersza (tyle że w INNEJ tabeli).
    const shop = await seedSellableTenant(admin);
    await publishLegalDocuments(admin, shop.tenantId);
    // Szkic regulaminu tego najemcy — wiersz legal_documents, utworzony
    // przez publishBothDirect. Jego id jest „prawdziwym" uuid, tylko z
    // niewłaściwej tabeli.
    const { data: draft } = await admin
      .from("legal_documents")
      .select("id")
      .eq("tenant_id", shop.tenantId)
      .eq("kind", "terms")
      .single();

    const { data, error } = await anon
      .schema("app")
      .rpc("public_checkout", checkoutArgs(shop.tenantId, shop.productId, shop.pickupId, "v1"));
    expect(error, `checkout odrzucony: ${error?.message}`).toBeNull();

    const { error: pinError } = await admin
      .from("orders")
      .update({ terms_version_id: draft!.id })
      .eq("tenant_id", shop.tenantId)
      .eq("order_number", (data as { order_number: string }).order_number);
    expect(pinError?.code, "id szkicu przeszło przez FK rejestru wersji").toBe("23503");
  });

  it("FK broni granicy najemca po najemcy także przy zapisie wprost", async () => {
    const shop = await seedSellableTenant(admin);
    await publishLegalDocuments(admin, shop.tenantId);
    const foreign = await seedTenant(admin);
    const foreignOwner = await seedActor(admin, foreign, "owner");
    await seedDraft(admin, foreign, "terms", "Regulamin obcego najemcy.");
    const foreignVersion = await publish(foreignOwner, "terms");

    const { data } = await anon
      .schema("app")
      .rpc("public_checkout", checkoutArgs(shop.tenantId, shop.productId, shop.pickupId, "1.0"));
    const { error } = await admin
      .from("orders")
      .update({ terms_version_id: foreignVersion.version_id })
      .eq("tenant_id", shop.tenantId)
      .eq("order_number", (data as { order_number: string }).order_number);
    expect(
      error?.code,
      "rolą serwisową dało się wskazać wersję innego najemcy — FK złożony nie działa",
    ).toBe("23503");
  });

  it("deklaracja starej etykiety odrzuca zamówienie zamiast zapisać nieprawdę", async () => {
    const shop = await seedSellableTenant(admin);
    const owner = await seedActor(admin, shop.tenantId, "owner");
    await seedDraft(admin, shop.tenantId, "terms", "Regulamin v1.");
    await publish(owner, "terms");
    await seedDraft(admin, shop.tenantId, "privacy", "Polityka prywatności v1.");
    await publish(owner, "privacy");
    await owner.client
      .from("legal_documents")
      .update({ body_draft: "Regulamin v2 — zmieniony w trakcie." })
      .eq("tenant_id", shop.tenantId)
      .eq("kind", "terms");
    await publish(owner, "terms");

    const { error } = await anon
      .schema("app")
      .rpc("public_checkout", checkoutArgs(shop.tenantId, shop.productId, shop.pickupId, "v1"));
    expect(error?.code, "zamówienie na nieaktualną wersję przeszło").toBe(PG_INVALID_PARAMETER);
    expect(error?.message).toContain("Regulamin zmienił się");
  });

  it("najemca bez opublikowanych dokumentów NIE sprzedaje — 0086 odwraca dawną gałąź (a)", async () => {
    // Do 0086 ta sytuacja przechodziła „jak przed migracją" i utrwalała napis
    // "1.0" bez przypięcia — zapis wyglądający na dowód zgody na dokument,
    // którego nie ma (H-COMP-01). Teraz jedyną uczciwą odpowiedzią jest
    // odmowa: 22023 ze znacznikiem maszynowym, zero zamówienia, zero klienta.
    const shop = await seedSellableTenant(admin);
    const { error } = await anon
      .schema("app")
      .rpc("public_checkout", checkoutArgs(shop.tenantId, shop.productId, shop.pickupId, "1.0"));
    expect(error?.code, "checkout bez dokumentów przeszedł").toBe(PG_INVALID_PARAMETER);
    expect(error?.details).toBe("legal_documents_missing");

    const { count: orders } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", shop.tenantId);
    const { count: customers } = await admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", shop.tenantId);
    expect(orders, "odmowa zostawiła zamówienie").toBe(0);
    expect(customers, "odmowa zostawiła klienta-sierotę").toBe(0);
  });

  it("sam regulamin bez polityki prywatności NIE wystarcza (komplet, nie połowa)", async () => {
    const shop = await seedSellableTenant(admin);
    const owner = await seedActor(admin, shop.tenantId, "owner");
    await seedDraft(admin, shop.tenantId, "terms", "Regulamin bez polityki.");
    await publish(owner, "terms");

    const { error } = await anon
      .schema("app")
      .rpc("public_checkout", checkoutArgs(shop.tenantId, shop.productId, shop.pickupId, "v1"));
    expect(error?.code, "sprzedaż ruszyła bez polityki prywatności").toBe(PG_INVALID_PARAMETER);
    expect(error?.details).toBe("legal_documents_missing");
  });

  it("sama polityka prywatności bez regulaminu NIE wystarcza", async () => {
    const shop = await seedSellableTenant(admin);
    const owner = await seedActor(admin, shop.tenantId, "owner");
    await seedDraft(admin, shop.tenantId, "privacy", "Polityka bez regulaminu.");
    await publish(owner, "privacy");

    const { error } = await anon
      .schema("app")
      .rpc("public_checkout", checkoutArgs(shop.tenantId, shop.productId, shop.pickupId, "1.0"));
    expect(error?.code, "sprzedaż ruszyła bez regulaminu").toBe(PG_INVALID_PARAMETER);
    expect(error?.details).toBe("legal_documents_missing");
  });

  it("integracja z własną etykietą sprzedaje dalej, bez przypięcia", async () => {
    // Wtyczka WordPress i API v1 niosą własną stałą wersji. Opublikowanie
    // regulaminu NIE MOŻE wywrócić ich checkoutu — to byłaby awaria sprzedaży
    // wywołana z panelu, dzień po wdrożeniu.
    const shop = await seedSellableTenant(admin);
    const owner = await seedActor(admin, shop.tenantId, "owner");
    await seedDraft(admin, shop.tenantId, "terms", "Regulamin sklepu z wtyczką.");
    await publish(owner, "terms");
    await seedDraft(admin, shop.tenantId, "privacy", "Polityka sklepu z wtyczką.");
    await publish(owner, "privacy");

    const { data, error } = await anon
      .schema("app")
      .rpc("public_checkout", checkoutArgs(shop.tenantId, shop.productId, shop.pickupId, "1.0"));
    expect(error, `integracja odrzucona: ${error?.message}`).toBeNull();

    const { data: order } = await admin
      .from("orders")
      .select("terms_version,terms_version_id")
      .eq("tenant_id", shop.tenantId)
      .eq("order_number", (data as { order_number: string }).order_number)
      .single();
    expect(order?.terms_version).toBe("1.0");
    expect(order?.terms_version_id).toBeNull();
  });

  // -------------------------------------------------------------------
  // 5. Okazanie wersji, którą nosi zamówienie
  // -------------------------------------------------------------------

  it("permalink oddaje starą wersję bajt w bajt po opublikowaniu nowej", async () => {
    const tenantId = await seedTenant(admin);
    const owner = await seedActor(admin, tenantId, "owner");
    await seedDraft(admin, tenantId, "terms", "Tekst, na który przystał klient.");
    await publish(owner, "terms");
    await owner.client
      .from("legal_documents")
      .update({ body_draft: "Tekst po zmianie." })
      .eq("tenant_id", tenantId)
      .eq("kind", "terms");
    await publish(owner, "terms");

    const { data: v1 } = await anon
      .schema("app")
      .rpc("get_legal_document_version", {
        p_tenant_id: tenantId,
        p_kind: "terms",
        p_version_no: 1,
      });
    expect(v1?.body).toBe("Tekst, na który przystał klient.");
    expect(v1?.sha256).toBe(sha256Hex("Tekst, na który przystał klient."));
    expect(v1?.current, "stara wersja podaje się za żywą").toBe(false);

    const { data: v2 } = await anon
      .schema("app")
      .rpc("get_legal_document_version", {
        p_tenant_id: tenantId,
        p_kind: "terms",
        p_version_no: 2,
      });
    expect(v2?.current).toBe(true);

    const { data: foreignVersion } = await anon
      .schema("app")
      .rpc("get_legal_document_version", {
        p_tenant_id: await seedTenant(admin),
        p_kind: "terms",
        p_version_no: 1,
      });
    expect(foreignVersion, "permalink wydał wersję spod cudzego identyfikatora").toBeNull();
  });
});
