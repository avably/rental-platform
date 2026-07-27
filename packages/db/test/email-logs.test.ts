/**
 * Historia wysłanych e-maili (0021, Zadanie 2.8, ADR-045) — wektory, których
 * macierz izolacji tabel (rls-isolation.test.ts) NIE pokrywa:
 *
 *   (b) FK ZŁOŻONY email_logs (tenant_id, order_id) → orders (tenant_id, id):
 *       log z własnym, poprawnym tenant_id NIE MOŻE wskazać zamówienia
 *       cudzego tenanta. RLS by to przepuściło (sprawdza wyłącznie tenant_id
 *       wstawianego wiersza) — bramką jest klucz złożony, który czyni taki
 *       wiersz niereprezentowalnym (23503, wzorzec ADR-019). Dowód mutacyjny:
 *       rozbicie FK na sam order_id → ten test przestaje dostawać 23503.
 *
 *   (d) APPEND-ONLY: brak grantów i polityk UPDATE/DELETE (wzorzec
 *       deposit_events z 0007). Historia, którą da się poprawić po fakcie,
 *       nie jest dowodem na to, co wyszło do klienta.
 *
 *   (e) SET NULL (order_id): usunięcie zamówienia nie może wymazać dowodu, że
 *       coś do klienta wyszło. Test pilnuje też, że lista kolumn w `on delete
 *       set null (order_id)` jest na miejscu — bez niej zerowałby się także
 *       tenant_id (not null) i usunięcie zamówienia wywracałoby się na 23502.
 *
 *   (f) app.log_public_checkout_email — jedyna anonowa ścieżka zapisu:
 *       anon NIE MA grantu na tabelę, funkcja ogranicza rodzaj wiadomości,
 *       wymaga zamówienia z TEGO tenanta i limituje liczbę wpisów.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*
 * (patrz seed-tenants.ts / docs/konwencje-migracji.md).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

// Klasa naruszenia klucza obcego — odróżnia odmowę FK (spójność referencji)
// od 42501 (RLS) czy 23505 (duplikat), które maskowałyby lukę.
const PG_FOREIGN_KEY_VIOLATION = "23503";
// Naruszenie CHECK-a — para status ↔ (provider_message_id, error).
const PG_CHECK_VIOLATION = "23514";
// Odmowa funkcji publicznej (wzorzec 0020: raise ... using errcode = '22023').
const PG_INVALID_PARAMETER = "22023";

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
let orderAId: string;
let orderANumber: string;
let orderAToken: string;
let orderBId: string;

async function createOrderFor(
  tenantId: string,
): Promise<{ id: string; number: string; token: string }> {
  const { data: customer, error: customerError } = await admin
    .from("customers")
    .insert({
      tenant_id: tenantId,
      email: `email-logs-${randomUUID()}@test.local`,
      full_name: "Historia test",
    })
    .select("id")
    .single();
  if (customerError || !customer) {
    throw new Error(`Nie udało się utworzyć klienta: ${customerError?.message}`);
  }

  const { data, error } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      start_date: "2026-09-01",
      end_date: "2026-09-03",
      // courier, nie pickup: CHECK orders_pickup_requires_location wymagałby
      // punktu odbioru, a ten test nie ma z nim nic wspólnego.
      delivery_method: "courier",
    })
    .select("id, order_number")
    .single();
  if (error || !data) throw new Error(`Nie udało się utworzyć zamówienia: ${error?.message}`);

  // Zamówienia panelowe NIE mają tokenu (0021): wydaje go wyłącznie
  // app.public_checkout. Tu nadajemy go wprost klientem service-role, żeby
  // testować bramkę dziennika bez przechodzenia całego checkoutu.
  const token = randomUUID();
  const { error: tokenError } = await admin
    .from("orders")
    .update({ checkout_log_token: token })
    .eq("id", data.id);
  if (tokenError) throw new Error(`Nie udało się nadać log_tokenu: ${tokenError.message}`);

  return { id: data.id as string, number: data.order_number as string, token };
}

/** Minimalny poprawny wpis udanej wysyłki dla podanego tenanta/zamówienia. */
function sentRow(tenantId: string, orderId: string | null): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    order_id: orderId,
    kind: "rental_confirmed",
    recipient: `odbiorca-${randomUUID().slice(0, 8)}@test.local`,
    subject: "Rezerwacja potwierdzona",
    status: "sent",
    provider_message_id: `resend-${randomUUID().slice(0, 8)}`,
  };
}

describe.skipIf(!hasEnv)("historia wysyłek e-mail (0021)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    anon = createClient(
      process.env.SUPABASE_LOCAL_API_URL!,
      process.env.SUPABASE_LOCAL_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    ({ a, b } = await seedTwoTenants());
    const orderA = await createOrderFor(a.tenantId);
    orderAId = orderA.id;
    orderANumber = orderA.number;
    orderAToken = orderA.token;
    orderBId = (await createOrderFor(b.tenantId)).id;
  }, 30_000);

  afterAll(async () => {
    await cleanupSeeded(admin);
  });

  // -------------------------------------------------------------------
  // (b) FK złożony — referencja cross-tenant jest niereprezentowalna
  // -------------------------------------------------------------------

  it("odrzuca log wskazujący zamówienie CUDZEGO tenanta (23503)", async () => {
    // Wiersz ma poprawny tenant_id = A (przechodzi RLS with check), ale
    // order_id to zamówienie tenanta B. Bez klucza ZŁOŻONEGO FK sprawdzałby
    // samo istnienie order_id (zamówienie B istnieje) i wiersz-łącznik dwóch
    // tenantów by wszedł — a historia wysyłek A pokazywałaby cudze zamówienie.
    const { error } = await a.ownerClient.from("email_logs").insert(sentRow(a.tenantId, orderBId));

    expect(error, "INSERT logu pod cudze zamówienie powinien zostać odrzucony").not.toBeNull();
    expect(error?.code, `oczekiwano ${PG_FOREIGN_KEY_VIOLATION} (naruszenie FK złożonego)`).toBe(
      PG_FOREIGN_KEY_VIOLATION,
    );
  });

  it("dopuszcza log pod WŁASNE zamówienie (kontrola pozytywna FK)", async () => {
    const { error } = await a.ownerClient.from("email_logs").insert(sentRow(a.tenantId, orderAId));
    expect(error, `INSERT pod własne zamówienie nie powinien być odrzucony: ${error?.message}`)
      .toBeNull();
  });

  it("dopuszcza log BEZ zamówienia (zaproszenie — order_id nullable)", async () => {
    const { error } = await a.ownerClient
      .from("email_logs")
      .insert({ ...sentRow(a.tenantId, null), kind: "invitation" });
    expect(error, `zaproszenie nie dotyczy zamówienia i musi się zapisać: ${error?.message}`)
      .toBeNull();
  });

  // -------------------------------------------------------------------
  // (c) CHECK email_logs_result_shape — 'failed' bez powodu jest bezużyteczny
  // -------------------------------------------------------------------

  it("odrzuca wpis 'failed' BEZ powodu (23514)", async () => {
    // To jest dokładnie ten bezużyteczny ślad, którego tabela ma być końcem:
    // „nie wyszło" bez odpowiedzi na pytanie „dlaczego".
    const { error } = await a.ownerClient.from("email_logs").insert({
      ...sentRow(a.tenantId, orderAId),
      status: "failed",
      provider_message_id: null,
    });
    expect(error?.code, `oczekiwano ${PG_CHECK_VIOLATION}`).toBe(PG_CHECK_VIOLATION);
  });

  it("odrzuca wpis 'sent' z powodem błędu (23514)", async () => {
    const { error } = await a.ownerClient.from("email_logs").insert({
      ...sentRow(a.tenantId, orderAId),
      error: "coś poszło nie tak",
    });
    expect(error?.code, `oczekiwano ${PG_CHECK_VIOLATION}`).toBe(PG_CHECK_VIOLATION);
  });

  it("dopuszcza wpis 'failed' z powodem (kontrola pozytywna)", async () => {
    const { error } = await a.ownerClient.from("email_logs").insert({
      ...sentRow(a.tenantId, orderAId),
      status: "failed",
      provider_message_id: null,
      error: "Dostawca poczty odrzucił wysyłkę (HTTP 422).",
    });
    expect(error, `wpis o porażce z powodem musi się zapisać: ${error?.message}`).toBeNull();
  });

  // -------------------------------------------------------------------
  // (e) on delete set null (order_id) — rejestr przeżywa zamówienie
  // -------------------------------------------------------------------

  it("usunięcie zamówienia zeruje order_id, ale NIE kasuje wpisu ani tenant_id", async () => {
    const order = await createOrderFor(a.tenantId);
    const row = sentRow(a.tenantId, order.id);
    const { error: insertError } = await admin.from("email_logs").insert(row);
    expect(insertError, `zasiew logu nie powiódł się: ${insertError?.message}`).toBeNull();

    // Bez listy kolumn w `set null` ten DELETE wywróciłby się na 23502
    // (tenant_id jest not null) — to jest ten drugi, cichy tryb awarii.
    const { error: deleteError } = await admin.from("orders").delete().eq("id", order.id);
    expect(deleteError, `usunięcie zamówienia nie powinno się wywrócić: ${deleteError?.message}`)
      .toBeNull();

    const { data } = await admin
      .from("email_logs")
      .select("tenant_id, order_id, status")
      .eq("recipient", row.recipient as string);

    expect(data, "wpis historii musi przeżyć usunięcie zamówienia").toHaveLength(1);
    expect(data![0]!.order_id).toBeNull();
    expect(data![0]!.tenant_id).toBe(a.tenantId);
  });

  // -------------------------------------------------------------------
  // (d) APPEND-ONLY — brak grantów i polityk UPDATE/DELETE
  // -------------------------------------------------------------------

  it("członek tenanta NIE poprawi ani nie skasuje własnego wpisu", async () => {
    const row = sentRow(a.tenantId, orderAId);
    await admin.from("email_logs").insert(row);

    const { error: updateError } = await a.ownerClient
      .from("email_logs")
      .update({ subject: "podmienione" })
      .eq("recipient", row.recipient as string);
    expect(updateError, "UPDATE na append-only rejestrze powinien zostać odrzucony").not.toBeNull();

    const { error: deleteError } = await a.ownerClient
      .from("email_logs")
      .delete()
      .eq("recipient", row.recipient as string);
    expect(deleteError, "DELETE na append-only rejestrze powinien zostać odrzucony").not.toBeNull();

    // Stan TRWAŁY (odczyt service-role, omija RLS) — nie wnioskujemy z
    // odpowiedzi PostgREST, bo ta potrafi zamaskować udaną mutację.
    const { data } = await admin
      .from("email_logs")
      .select("subject")
      .eq("recipient", row.recipient as string);
    expect(data).toHaveLength(1);
    expect(data![0]!.subject).toBe(row.subject);
  });

  // -------------------------------------------------------------------
  // (f) app.log_public_checkout_email — jedyna anonowa ścieżka zapisu
  // -------------------------------------------------------------------

  it("anon NIE MA dostępu do tabeli — ani odczytu, ani zapisu", async () => {
    const { data, error: selectError } = await anon.from("email_logs").select("id").limit(1);
    // Brak grantu = pusty wynik albo błąd; czego NIE MA być, to cudzych wierszy.
    expect(selectError !== null || (data ?? []).length === 0).toBe(true);

    const { error: insertError } = await anon.from("email_logs").insert(sentRow(a.tenantId, orderAId));
    expect(insertError, "anon nie może pisać wprost do rejestru").not.toBeNull();
  });

  it("anon zapisuje log checkoutu przez funkcję (kontrola pozytywna)", async () => {
    const recipient = `checkout-${randomUUID().slice(0, 8)}@test.local`;
    const body = "<!doctype html>\n<html><body>Zażółć gęślą jaźń &amp; checkout</body></html>";
    const { error } = await anon.schema("app").rpc("log_public_checkout_email", {
      p_tenant_id: a.tenantId,
      p_order_number: orderANumber,
      p_log_token: orderAToken,
      p_kind: "checkout_confirmation",
      p_recipient: recipient,
      p_subject: "Rezerwacja potwierdzona",
      p_status: "sent",
      p_provider_message_id: "resend-checkout",
      p_error: null,
      p_body: body,
    });
    expect(error, `zapis przez funkcję nie powinien być odrzucony: ${error?.message}`).toBeNull();

    // Funkcja SAMA rozwiązuje numer zamówienia na order_id — wołający nigdy
    // nie widzi identyfikatora wewnętrznego (ADR-042/045).
    const { data } = await admin
      .from("email_logs")
      .select("order_id, tenant_id, kind, body, hasBody:email_log_has_body")
      .eq("recipient", recipient);
    expect(data).toHaveLength(1);
    expect(data![0]!.order_id).toBe(orderAId);
    expect(data![0]!.tenant_id).toBe(a.tenantId);
    expect(data![0]!.body, "baza musi zachować HTML byte-for-byte").toBe(body);
    expect(data![0]!.hasBody).toBe(true);
  });

  it("wywołanie bez p_body pozostaje kompatybilne i zapisuje body = NULL", async () => {
    const recipient = `checkout-compat-${randomUUID().slice(0, 8)}@test.local`;
    const { error } = await anon.schema("app").rpc("log_public_checkout_email", {
      p_tenant_id: a.tenantId,
      p_order_number: orderANumber,
      p_log_token: orderAToken,
      p_kind: "checkout_confirmation",
      p_recipient: recipient,
      p_subject: "Klient sprzed migracji aplikacji",
      p_status: "sent",
      p_provider_message_id: "resend-checkout-compat",
      p_error: null,
    });
    expect(error, `stary caller nie powinien zostać odrzucony: ${error?.message}`).toBeNull();

    const { data } = await admin
      .from("email_logs")
      .select("body, hasBody:email_log_has_body")
      .eq("recipient", recipient);
    expect(data).toHaveLength(1);
    expect(data![0]!.body).toBeNull();
    expect(data![0]!.hasBody).toBe(false);
  });

  it("funkcja odrzuca rodzaj spoza checkoutu (22023)", async () => {
    // Bez tej bramki anon wstrzykiwałby w historię wpisy udające cykl najmu
    // albo zaproszenie — czyli fałszował dowód, po który operator tu wchodzi.
    const { error } = await anon.schema("app").rpc("log_public_checkout_email", {
      p_tenant_id: a.tenantId,
      p_order_number: orderANumber,
      p_log_token: orderAToken,
      p_kind: "invitation",
      p_recipient: "x@test.local",
      p_subject: "X",
      p_status: "sent",
      p_provider_message_id: null,
      p_error: null,
    });
    expect(error?.code, `oczekiwano ${PG_INVALID_PARAMETER}`).toBe(PG_INVALID_PARAMETER);
  });

  it("funkcja odrzuca zamówienie spoza tenanta (22023)", async () => {
    const orderB = await createOrderFor(b.tenantId);
    const { error } = await anon.schema("app").rpc("log_public_checkout_email", {
      // Numer istnieje, ale u INNEGO tenanta — para (tenant, numer) nie ma
      // dopasowania, więc log nie powstaje pod cudzym zamówieniem.
      p_tenant_id: a.tenantId,
      p_order_number: orderB.number,
      p_log_token: orderB.token,
      p_kind: "checkout_confirmation",
      p_recipient: "x@test.local",
      p_subject: "X",
      p_status: "sent",
      p_provider_message_id: null,
      p_error: null,
    });
    expect(error?.code, `oczekiwano ${PG_INVALID_PARAMETER}`).toBe(PG_INVALID_PARAMETER);
  });

  it("funkcja odcina zalewanie rejestru po przekroczeniu limitu wpisów (22023)", async () => {
    const order = await createOrderFor(a.tenantId);
    const call = () =>
      anon.schema("app").rpc("log_public_checkout_email", {
        p_tenant_id: a.tenantId,
        p_order_number: order.number,
        p_log_token: order.token,
        p_kind: "checkout_confirmation",
        p_recipient: `flood-${randomUUID().slice(0, 8)}@test.local`,
        p_subject: "X",
        p_status: "sent",
        p_provider_message_id: null,
        p_error: null,
      });

    // Checkout wysyła najwyżej dwie wiadomości — dziesiąty wpis to nadużycie.
    for (let i = 0; i < 10; i += 1) {
      const { error } = await call();
      expect(error, `wpis ${i + 1} nie powinien być odrzucony: ${error?.message}`).toBeNull();
    }
    const { error } = await call();
    expect(error?.code, `oczekiwano ${PG_INVALID_PARAMETER} po przekroczeniu limitu`).toBe(
      PG_INVALID_PARAMETER,
    );
  });

  // -------------------------------------------------------------------
  // (g) LOG_TOKEN — dowód, że wołający naprawdę przeprowadził checkout
  //     (znalezisko recenzji adwersaryjnej 2.8)
  // -------------------------------------------------------------------
  //
  // Bez tej bramki funkcja przyjmowała wyłącznie dane PUBLICZNE: tenant_id
  // (jawny przez resolve_tenant_by_slug, 0017) i order_number (SEKWENCYJNY,
  // trigger 0007). Posiadacz publicznego klucza strony dopisywał więc do
  // historii REALNYCH zamówień zmyślone wpisy, a różnica odmów działała jak
  // wyrocznia do enumeracji numerów zamówień.

  /** Wywołanie funkcji z podmienialnym numerem i tokenem. */
  const logCall = (
    orderNumber: string,
    token: string | null,
    recipient = "x@test.local",
    body = "<html><body>treść, której odmowa nie może zapisać</body></html>",
  ) =>
    anon.schema("app").rpc("log_public_checkout_email", {
      p_tenant_id: a.tenantId,
      p_order_number: orderNumber,
      p_log_token: token,
      p_kind: "checkout_confirmation",
      p_recipient: recipient,
      p_subject: "X",
      p_status: "sent",
      p_provider_message_id: null,
      p_error: null,
      p_body: body,
    });

  it("anon BEZ tokenu nie dopisze wpisu do cudzego zamówienia (22023)", async () => {
    const order = await createOrderFor(a.tenantId);
    const { error } = await logCall(order.number, null);

    expect(error, "zapis bez tokenu powinien zostać odrzucony").not.toBeNull();
    expect(error?.code, `oczekiwano ${PG_INVALID_PARAMETER}`).toBe(PG_INVALID_PARAMETER);

    // Stan TRWAŁY (service-role, omija RLS): wpis NIE powstał. Sam błąd w
    // odpowiedzi nie wystarcza — to ta sama klasa fałszywej zieleni, którą
    // macierz izolacji tępi przy UPDATE/DELETE.
    const { data } = await admin.from("email_logs").select("id, body").eq("order_id", order.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("anon z CUDZYM tokenem nie dopisze wpisu do zamówienia (22023)", async () => {
    // Token istnieje i jest poprawnym uuid — ale należy do INNEGO zamówienia.
    // Bez tego wariantu test przechodziłby także wtedy, gdyby funkcja
    // sprawdzała jedynie „token jest niepusty".
    const target = await createOrderFor(a.tenantId);
    const other = await createOrderFor(a.tenantId);

    const { error } = await logCall(target.number, other.token);
    expect(error?.code, `oczekiwano ${PG_INVALID_PARAMETER}`).toBe(PG_INVALID_PARAMETER);

    const { data } = await admin.from("email_logs").select("id, body").eq("order_id", target.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("anon z WŁASNYM tokenem zapisuje wpis (kontrola pozytywna bramki)", async () => {
    const order = await createOrderFor(a.tenantId);
    const recipient = `token-ok-${randomUUID().slice(0, 8)}@test.local`;

    const { error } = await logCall(order.number, order.token, recipient);
    expect(error, `poprawny token nie powinien być odrzucony: ${error?.message}`).toBeNull();

    const { data } = await admin.from("email_logs").select("order_id").eq("recipient", recipient);
    expect(data).toHaveLength(1);
    expect(data![0]!.order_id).toBe(order.id);
  });

  /**
   * WYROCZNIA ENUMERACJI: gdyby odmowa „nie ma takiego zamówienia" różniła się
   * od „zły token", wołający odpytywałby kolejne (sekwencyjne) numery byle
   * jakim tokenem i czytał po treści odmowy, które numery ISTNIEJĄ — czyli
   * wolumen zamówień najemcy.
   */
  it("odmowy są NIEROZRÓŻNIALNE: nieistniejące zamówienie i zły token dają ten sam błąd", async () => {
    const existing = await createOrderFor(a.tenantId);

    const denialForWrongToken = await logCall(existing.number, randomUUID());
    // Numer spoza puli tenanta — zamówienie o takim numerze nie istnieje.
    const denialForMissingOrder = await logCall("AV-2000-999", randomUUID());

    for (const denial of [denialForWrongToken, denialForMissingOrder]) {
      expect(denial.error?.code).toBe(PG_INVALID_PARAMETER);
    }
    // Porównujemy KOMUNIKAT, nie tylko kod: wspólny errcode przy różnych
    // treściach nadal byłby wyrocznią, a asercja na samym kodzie by to
    // przeoczyła.
    expect(denialForWrongToken.error?.message).toBe(denialForMissingOrder.error?.message);
    expect(denialForWrongToken.error?.details ?? null).toBe(
      denialForMissingOrder.error?.details ?? null,
    );
  });

  it("token zamówienia jednego tenanta nie działa u drugiego (22023)", async () => {
    // Domknięcie osi tenanta: sam fakt posiadania WAŻNEGO tokenu nie może
    // otwierać dziennika cudzego najemcy.
    const orderB = await createOrderFor(b.tenantId);
    const recipient = `foreign-token-${randomUUID()}@test.local`;
    const { error } = await logCall(orderB.number, orderB.token, recipient);
    expect(error?.code, `oczekiwano ${PG_INVALID_PARAMETER}`).toBe(PG_INVALID_PARAMETER);

    const { data } = await admin
      .from("email_logs")
      .select("id, body")
      .eq("recipient", recipient);
    expect(data ?? [], "cudza para tenant/token nie może zostawić treści").toHaveLength(0);
  });

  it("zamówienia z PANELU nie mają tokenu — nie da się do nich dopisać wpisu checkoutu", async () => {
    // create_order (0010) nie ustawia checkout_log_token, więc kolumna jest
    // NULL. Gdyby porównanie użyło `is not distinct from`, wywołanie z
    // p_log_token = NULL dopasowałoby KAŻDE takie zamówienie — dlatego
    // funkcja porównuje zwykłym `=`, które przy NULL nie dopasowuje nic.
    const order = await createOrderFor(a.tenantId);
    const { error: clearError } = await admin
      .from("orders")
      .update({ checkout_log_token: null })
      .eq("id", order.id);
    expect(clearError).toBeNull();

    const { error } = await logCall(order.number, null);
    expect(error?.code, `oczekiwano ${PG_INVALID_PARAMETER}`).toBe(PG_INVALID_PARAMETER);

    const { data } = await admin.from("email_logs").select("id").eq("order_id", order.id);
    expect(data ?? []).toHaveLength(0);
  });
});
