/**
 * Rekoncyliacja stanu kont Connect (Faza B, siatka na zgubiony
 * `account.updated`) — na ŻYWYM lokalnym Supabase z wstrzykniętym odczytem
 * u dostawcy.
 *
 * DLACZEGO NA ŻYWEJ BAZIE. To, co ta pętla ma dowodzić, jest WŁASNOŚCIĄ ZAPISU
 * do `payment_accounts`: że migawka przepisuje się z odczytu, że porażka
 * odczytu zostawia gotowość NIETKNIĘTĄ, i że `provider_account_id` nie rusza
 * się nigdy (trigger niezmienności 0028 FIRE'uje też dla service_role). Atrapa
 * bazy odpowiadałaby to, co sami byśmy jej kazali.
 *
 * WSTRZYKNIĘTY JEST WYŁĄCZNIE PORT DOSTAWCY (`syncAccount`), bo tylko on jest
 * po drugiej stronie sieci. Baza bywa współdzielona z innymi suitami: atrapa
 * RZUCA dla kont spoza fixtures tego testu, a rdzeń traktuje rzut jak awarię
 * NASZĄ (zero zapisu) — cudze wiersze zostają nietknięte.
 *
 * OSIE DOWODU: odczyt→migawka; brak driftu = no-op; izolacja (konto A nie
 * rusza B); fail-safe (porażka GET → sam last_error, gotowość nietknięta);
 * NIGDY provider_account_id; limit partii respektowany.
 */
import { randomUUID } from "node:crypto";

import type { ConnectAccountState, ConnectAccountSync } from "@avably/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { reconcileConnectAccounts } from "@/src/jobs/reconcile-connect-accounts";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = ["SUPABASE_LOCAL_API_URL", "SUPABASE_LOCAL_SERVICE_ROLE_KEY"] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const adminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const createdTenantIds: string[] = [];

/** Stan gotowości „w toku" — świeże konto, którego dostawca jeszcze nie przyjął. */
function state(overrides: Partial<ConnectAccountState> & { providerAccountId: string }): ConnectAccountState {
  return {
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    requirementsDue: [],
    disabledReason: null,
    ...overrides,
  };
}

/**
 * Port dostawcy pod kontrolą testu. `calls` jest DOWODEM, o które konto
 * pytaliśmy — bez niego „job odświeżył" nie odróżnia się od „job odświeżył
 * cudze konto". Konto spoza `responses` RZUCA: cudzy wiersz w tej samej partii
 * ma zostać nietknięty, a nie dostać wymyśloną odpowiedź.
 */
const provider = {
  calls: [] as string[],
  responses: new Map<string, ConnectAccountSync>(),
};

function fakeSync(providerAccountId: string): Promise<ConnectAccountSync> {
  provider.calls.push(providerAccountId);
  const hit = provider.responses.get(providerAccountId);
  if (!hit) {
    return Promise.reject(new Error(`Odczyt spoza fixtures tego testu: ${providerAccountId}`));
  }
  return Promise.resolve(hit);
}

interface SeedSnapshot {
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  requirementsDue?: string[];
  lastError?: string | null;
  lastSyncedAt?: string | null;
}

describe.skipIf(!hasEnv)("rekoncyliacja kont Connect — Faza B", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);

  beforeEach(() => {
    provider.calls.length = 0;
    provider.responses.clear();
  });

  afterAll(async () => {
    if (!hasEnv) return;
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
  });

  /** Najemca z kontem u dostawcy o zadanej migawce startowej. */
  async function seedAccount(
    label: string,
    snapshot: SeedSnapshot = {},
  ): Promise<{ tenantId: string; accountId: string }> {
    const slug = `crec-${label}-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Connect recon ${label}` })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const tenantId = (data as { id: string }).id;
    createdTenantIds.push(tenantId);

    const accountId = `acct_${label}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const { error: accError } = await admin.from("payment_accounts").insert({
      tenant_id: tenantId,
      provider_account_id: accountId,
      charges_enabled: snapshot.chargesEnabled ?? false,
      payouts_enabled: snapshot.payoutsEnabled ?? false,
      details_submitted: snapshot.detailsSubmitted ?? false,
      requirements_due: snapshot.requirementsDue ?? [],
      last_error: snapshot.lastError ?? null,
      last_synced_at: snapshot.lastSyncedAt ?? null,
    });
    if (accError) throw new Error(accError.message);
    return { tenantId, accountId };
  }

  async function snapshotOf(tenantId: string) {
    const { data, error } = await admin
      .from("payment_accounts")
      .select(
        "provider_account_id, charges_enabled, payouts_enabled, details_submitted, requirements_due, last_error, last_synced_at",
      )
      .eq("tenant_id", tenantId)
      .single();
    if (error) throw new Error(error.message);
    return data as {
      provider_account_id: string;
      charges_enabled: boolean;
      payouts_enabled: boolean;
      details_submitted: boolean;
      requirements_due: string[];
      last_error: string | null;
      last_synced_at: string | null;
    };
  }

  const entryFor = (
    result: Awaited<ReturnType<typeof reconcileConnectAccounts>>,
    tenantId: string,
  ) => result.entries.find((e) => e.tenantId === tenantId) ?? null;

  // -------------------------------------------------------------------
  // 1. Odczyt → migawka (drift z zgubionego account.updated)
  // -------------------------------------------------------------------

  it("stan u dostawcy różny od migawki → drift-refreshed, migawka przepisana z odczytu", async () => {
    // Migawka mówi „niegotowe", a dostawca już PRZYJĄŁ konto (account.updated
    // się zgubił). Pull ma to wykryć i przepisać.
    const { tenantId, accountId } = await seedAccount("drift", {
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      requirementsDue: ["individual.id_number"],
      lastError: "stary powód",
    });
    provider.responses.set(accountId, {
      ok: true,
      state: state({
        providerAccountId: accountId,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirementsDue: [],
      }),
      error: null,
    });

    const result = await reconcileConnectAccounts({ db: admin, syncAccount: fakeSync, limit: 500 });

    expect(entryFor(result, tenantId)?.outcome).toBe("drift-refreshed");
    const snap = await snapshotOf(tenantId);
    expect(snap.charges_enabled).toBe(true);
    expect(snap.payouts_enabled).toBe(true);
    expect(snap.details_submitted).toBe(true);
    expect(snap.requirements_due).toEqual([]);
    // Sukces odczytu CZYŚCI zaległy powód i stempluje odczyt.
    expect(snap.last_error).toBeNull();
    expect(snap.last_synced_at).not.toBeNull();
    // Identyfikator konta NIETKNIĘTY.
    expect(snap.provider_account_id).toBe(accountId);
  });

  it("odczyt zgodny z migawką → unchanged (zdrowy no-op)", async () => {
    const { tenantId, accountId } = await seedAccount("nodrift", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirementsDue: [],
    });
    provider.responses.set(accountId, {
      ok: true,
      state: state({
        providerAccountId: accountId,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        requirementsDue: [],
      }),
      error: null,
    });

    const result = await reconcileConnectAccounts({ db: admin, syncAccount: fakeSync, limit: 500 });

    expect(entryFor(result, tenantId)?.outcome).toBe("unchanged");
    const snap = await snapshotOf(tenantId);
    expect(snap.charges_enabled).toBe(true);
    expect(snap.provider_account_id).toBe(accountId);
  });

  // -------------------------------------------------------------------
  // 2. Izolacja — konto A nie rusza B
  // -------------------------------------------------------------------

  it("każde konto odpytane i zapisane WŁASNYM identyfikatorem — bez przecieku między najemcami", async () => {
    const alfa = await seedAccount("alfa", { chargesEnabled: false });
    const beta = await seedAccount("beta", { chargesEnabled: false });

    provider.responses.set(alfa.accountId, {
      ok: true,
      state: state({ providerAccountId: alfa.accountId, chargesEnabled: true, detailsSubmitted: true }),
      error: null,
    });
    provider.responses.set(beta.accountId, {
      ok: true,
      state: state({ providerAccountId: beta.accountId, chargesEnabled: false, requirementsDue: ["x"] }),
      error: null,
    });

    await reconcileConnectAccounts({ db: admin, syncAccount: fakeSync, limit: 500 });

    // Każde konto odpytane SWOIM identyfikatorem, dokładnie raz.
    expect(provider.calls.filter((id) => id === alfa.accountId)).toHaveLength(1);
    expect(provider.calls.filter((id) => id === beta.accountId)).toHaveLength(1);

    // Stan A z odczytu A, stan B z odczytu B — bez zamiany.
    const snapA = await snapshotOf(alfa.tenantId);
    const snapB = await snapshotOf(beta.tenantId);
    expect(snapA.charges_enabled).toBe(true);
    expect(snapA.provider_account_id).toBe(alfa.accountId);
    expect(snapB.charges_enabled).toBe(false);
    expect(snapB.requirements_due).toEqual(["x"]);
    expect(snapB.provider_account_id).toBe(beta.accountId);
  });

  // -------------------------------------------------------------------
  // 3. Fail-safe — porażka GET nie zeruje gotowości
  // -------------------------------------------------------------------

  it("porażka odczytu → sam last_error, kolumny gotowości NIETKNIĘTE", async () => {
    // Konto DZIAŁA (charges_enabled=true); nasz odczyt pada timeoutem. Gdyby
    // job zerował gotowość, w Z3 ukryłby najemcy płatność online — awaria po
    // NASZEJ stronie zabierałaby mu pieniądze.
    const { tenantId, accountId } = await seedAccount("failsafe", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirementsDue: [],
      lastError: null,
    });
    provider.responses.set(accountId, {
      ok: false,
      state: null,
      error: "API płatności odpowiedziało 503",
    });

    const result = await reconcileConnectAccounts({ db: admin, syncAccount: fakeSync, limit: 500 });

    expect(entryFor(result, tenantId)?.outcome).toBe("sync-failed");
    const snap = await snapshotOf(tenantId);
    // Gotowość NIETKNIĘTA — nadal true.
    expect(snap.charges_enabled).toBe(true);
    expect(snap.payouts_enabled).toBe(true);
    expect(snap.details_submitted).toBe(true);
    // Zapisany SAM powód.
    expect(snap.last_error).toContain("503");
    expect(snap.provider_account_id).toBe(accountId);
  });

  // -------------------------------------------------------------------
  // 4. NIGDY provider_account_id — nawet gdy odczyt niesie inny identyfikator
  // -------------------------------------------------------------------

  it("odczyt niosący INNY providerAccountId nie podmienia kolumny tożsamości", async () => {
    const { tenantId, accountId } = await seedAccount("tozsamosc", { chargesEnabled: false });
    // Odczyt (hipotetycznie) niesie inny acct_ w polu stanu — job NIE MA prawa
    // go zapisać; pisze wyłącznie kolumny gotowości.
    provider.responses.set(accountId, {
      ok: true,
      state: state({ providerAccountId: "acct_PODMIENIONE_NIE_ZAPISUJ", chargesEnabled: true }),
      error: null,
    });

    await reconcileConnectAccounts({ db: admin, syncAccount: fakeSync, limit: 500 });

    const snap = await snapshotOf(tenantId);
    expect(snap.provider_account_id).toBe(accountId);
    expect(snap.provider_account_id).not.toBe("acct_PODMIENIONE_NIE_ZAPISUJ");
    // A gotowość i tak przepisana z odczytu.
    expect(snap.charges_enabled).toBe(true);
  });

  // -------------------------------------------------------------------
  // 5. Limit partii respektowany
  // -------------------------------------------------------------------

  it("limit partii ogranicza skan — reszta wraca w następnym przebiegu", async () => {
    // Nie zależy od cudzych wierszy w bazie: dowodem jest to, że skan NIE
    // przekracza limitu, a zaległość i tak jest wznawialna (kolejne przebiegi).
    await seedAccount("limit-a", { chargesEnabled: false });
    await seedAccount("limit-b", { chargesEnabled: false });

    const result = await reconcileConnectAccounts({ db: admin, syncAccount: fakeSync, limit: 1 });

    expect(result.scanned).toBe(1);
    expect(result.entries).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // 6. Ślad przebiegu — bez identyfikatora konta u dostawcy
  // -------------------------------------------------------------------

  it("ślad przebiegu nie niesie provider_account_id", async () => {
    const { tenantId, accountId } = await seedAccount("slad", { chargesEnabled: false });
    provider.responses.set(accountId, {
      ok: true,
      state: state({ providerAccountId: accountId, chargesEnabled: true }),
      error: null,
    });

    const result = await reconcileConnectAccounts({ db: admin, syncAccount: fakeSync, limit: 500 });
    const entry = entryFor(result, tenantId);

    expect(entry).not.toBeNull();
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(accountId);
    expect(serialized).not.toContain("acct_");
    expect(entry!.tenantId).toBe(tenantId);
  });
});
