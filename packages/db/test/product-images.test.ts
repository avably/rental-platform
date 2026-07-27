/**
 * Izolacja zdjęć produktów (0018, Zadanie 2.2). Dwa wektory, których macierz
 * izolacji tabel (rls-isolation.test.ts) NIE pokrywa i które są sednem tego
 * zadania:
 *
 *   (b) FK ZŁOŻONY product_images (tenant_id, product_id) → products
 *       (tenant_id, id): zdjęcie z własnym, poprawnym tenant_id NIE MOŻE
 *       wskazać produktu cudzego tenanta. RLS by to przepuściło (sprawdza tylko
 *       tenant_id wstawianego wiersza) — bramką jest klucz złożony (ADR-019),
 *       który czyni taki wiersz niereprezentowalnym (23503). Dowód mutacyjny:
 *       rozbicie FK na sam product_id → ten test przestaje dostawać 23503.
 *
 *   (c) Storage write-gated RLS: członek tenanta A nie wgra ani nie skasuje
 *       obiektu w ścieżce tenanta B (pierwszy segment ścieżki = folder tenanta,
 *       polityki storage.objects porównują go z app.tenant_id()). ODCZYT jest
 *       publiczny (ADR-040) — bucket public, kontrola pozytywna niżej.
 *
 * Skuteczność bramki ZAPISU Storage mierzymy TRWAŁYM stanem (obiekt istnieje /
 * nie istnieje wg klienta service-role), a nie samym faktem, że klient zwrócił
 * błąd — `storage.remove` potrafi zwrócić „sukces" nie skasowawszy nic, gdy
 * polityka DELETE odcina wiersze (dokładnie ta klasa fałszywej zieleni, którą
 * projekt tępi w macierzy tabel).
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (patrz
 * seed-tenants.ts / docs/konwencje-migracji.md). Bez nich cały plik jest
 * pomijany — strażnik integration-env failuje suitę, jeśli pominięcie nie jest
 * jawnie dozwolone (job rls go nie dozwala).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { integrationEnv } from "./helpers/integration-env";
import { cleanupSeeded, createAdminClient, seedTwoTenants, type TenantCtx } from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const BUCKET = "product-images";
// Klasa naruszenia klucza obcego — odróżnia odmowę FK (spójność referencji,
// ADR-019) od 42501 (RLS) czy 23505 (duplikat), które maskowałyby lukę.
const PG_FOREIGN_KEY_VIOLATION = "23503";

// Minimalny poprawny PNG (1×1, przezroczysty) — treść nieistotna, liczy się
// ścieżka i tożsamość wołającego.
const PNG_1PX = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

let admin: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
let productAId: string;
let productBId: string;

// Ścieżki obiektów utworzonych w teście — sprzątane w afterAll (storage.objects
// NIE kaskaduje z tenants, więc reruny bez `supabase db reset` akumulowałyby pliki).
const uploadedPaths: string[] = [];

async function createProductFor(tenantId: string): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: `Zdjęcia test ${randomUUID().slice(0, 8)}`,
      base_price_day_grosze: 10_000,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się utworzyć produktu: ${error?.message}`);
  return data.id as string;
}

async function uploadWithTicket(
  client: SupabaseClient,
  productId: string,
): Promise<string> {
  const issued = await client
    .schema("app")
    .rpc("issue_product_image_upload", {
      p_product_id: productId,
      p_declared_mime: "image/png",
      p_declared_size: PNG_1PX.length,
    })
    .single();
  if (issued.error || !issued.data) {
    throw new Error(`Nie udało się wydać biletu: ${issued.error?.message}`);
  }
  const path = issued.data.storage_path as string;
  const signed = await client.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data) {
    throw new Error(`Nie udało się podpisać uploadu: ${signed.error?.message}`);
  }
  const uploaded = await client.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, signed.data.token, PNG_1PX, {
      contentType: "image/png",
      upsert: false,
    });
  if (uploaded.error) {
    throw new Error(`Nie udało się wgrać obiektu: ${uploaded.error.message}`);
  }
  return path;
}

describe.skipIf(!hasEnv)("izolacja zdjęć produktów (0018)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    ({ a, b } = await seedTwoTenants());
    productAId = await createProductFor(a.tenantId);
    productBId = await createProductFor(b.tenantId);
  }, 30_000);

  afterAll(async () => {
    if (uploadedPaths.length > 0) {
      await admin.storage.from(BUCKET).remove(uploadedPaths);
    }
    await cleanupSeeded(admin);
  });

  // -------------------------------------------------------------------
  // (b) FK złożony — referencja cross-tenant jest niereprezentowalna
  // -------------------------------------------------------------------

  it("odrzuca zdjęcie wskazujące produkt CUDZEGO tenanta (23503, ADR-019)", async () => {
    // Wiersz ma poprawny tenant_id = A (przechodzi RLS with check), ale product_id
    // to produkt tenanta B. Bez klucza złożonego FK sprawdzałby samo istnienie
    // product_id (produkt B istnieje) i wiersz-łącznik dwóch tenantów by wszedł.
    const { error } = await a.ownerClient.from("product_images").insert({
      tenant_id: a.tenantId,
      product_id: productBId,
      storage_path: `${a.tenantId}/${productBId}/${randomUUID()}.png`,
    });

    expect(error, "INSERT zdjęcia pod cudzy produkt powinien zostać odrzucony").not.toBeNull();
    expect(error?.code, `oczekiwano ${PG_FOREIGN_KEY_VIOLATION} (naruszenie FK złożonego)`).toBe(
      PG_FOREIGN_KEY_VIOLATION,
    );
  });

  it("dopuszcza zdjęcie pod WŁASNY produkt (kontrola pozytywna FK)", async () => {
    const { error } = await a.ownerClient.from("product_images").insert({
      tenant_id: a.tenantId,
      product_id: productAId,
      storage_path: `${a.tenantId}/${productAId}/${randomUUID()}.png`,
    });
    expect(error, `INSERT pod własny produkt nie powinien być odrzucony: ${error?.message}`).toBeNull();
  });

  it("wymusza dokładny kształt i unikalność storage_path", async () => {
    const invalidPath = `${a.tenantId}/${productAId}/${randomUUID()}`;
    const invalid = await a.ownerClient.from("product_images").insert({
      tenant_id: a.tenantId,
      product_id: productAId,
      storage_path: invalidPath,
    });
    expect(invalid.error?.code).toBe("23514");

    const validPath = `${a.tenantId}/${productAId}/${randomUUID()}.png`;
    const first = await a.ownerClient.from("product_images").insert({
      tenant_id: a.tenantId,
      product_id: productAId,
      storage_path: validPath,
    });
    expect(first.error, first.error?.message).toBeNull();
    const duplicate = await a.ownerClient.from("product_images").insert({
      tenant_id: a.tenantId,
      product_id: productAId,
      storage_path: validPath,
    });
    expect(duplicate.error?.code).toBe("23505");
  });

  // -------------------------------------------------------------------
  // (c) Storage — bramka ZAPISU do ścieżki własnego tenanta
  // -------------------------------------------------------------------

  it("blokuje UPLOAD członka tenanta A do ścieżki tenanta B", async () => {
    const crossPath = `${b.tenantId}/${productBId}/${randomUUID()}.png`;
    const { error } = await a.ownerClient.storage.from(BUCKET).upload(crossPath, PNG_1PX, {
      contentType: "image/png",
    });

    expect(error, "upload do folderu cudzego tenanta powinien zostać odrzucony").not.toBeNull();

    // Stan TRWAŁY: obiekt nie powstał (odczyt service-role, omija RLS).
    const { error: downloadError } = await admin.storage.from(BUCKET).download(crossPath);
    expect(
      downloadError,
      "obiekt w folderze tenanta B nie powinien istnieć po odrzuconym uploadzie A",
    ).not.toBeNull();
  });

  it("pozwala właścicielowi wgrać zdjęcie z własnym biletem, a odczyt jest publiczny (ADR-040)", async () => {
    const ownPath = await uploadWithTicket(a.ownerClient, productAId);
    uploadedPaths.push(ownPath);

    // Kontrola pozytywna odczytu: publiczny URL bez żadnej sesji zwraca bajty.
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(ownPath).data.publicUrl;
    const res = await fetch(publicUrl);
    expect(res.status, "publiczny odczyt zdjęcia powinien zwrócić 200").toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length, "publiczny odczyt powinien zwrócić niepustą treść").toBeGreaterThan(0);
  });

  it("blokuje USUNIĘCIE przez tenanta A obiektu w ścieżce tenanta B", async () => {
    // Seed: B wgrywa własny obiekt przez dokładny bilet.
    const bPath = await uploadWithTicket(b.ownerClient, productBId);
    uploadedPaths.push(bPath);

    // A próbuje skasować plik B. storage.remove potrafi zwrócić brak błędu, nic
    // nie skasowawszy — dlatego werdykt bierzemy z TRWAŁEGO stanu obiektu.
    await a.ownerClient.storage.from(BUCKET).remove([bPath]);

    const { error: downloadError } = await admin.storage.from(BUCKET).download(bPath);
    expect(
      downloadError,
      "obiekt tenanta B powinien PRZETRWAĆ próbę usunięcia przez tenanta A",
    ).toBeNull();
  });
});
