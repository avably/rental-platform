/**
 * Pełna droga sekretu dostawcy TAM I Z POWROTEM (ADR-052) na żywym, lokalnym
 * Supabase — wzorzec orders.test.ts: realni użytkownicy, realne sesje, realne
 * RLS, zero mocków bazy.
 *
 * KONTROLA POZYTYWNA dowodów mutacyjnych: sam odczyt wiersza niczego by nie
 * dowodził — mutant, który zapisuje bez szyfrowania, też pozwala „odczytać".
 * Dlatego test idzie do końca: właściciel zapisuje zaszyfrowany sekret →
 * loadCourierApi czyta go z bazy i odszyfrowuje → skonstruowany port
 * kurierski LOGUJE SIĘ u dostawcy, a my sprawdzamy, że w żądaniu do dostawcy
 * wylądowało DOKŁADNIE to hasło, które zapisał właściciel. Fetch jest
 * wstrzykiwany (wzorzec ADR-031), więc CI nie dotyka sieci.
 */
import { randomUUID } from "node:crypto";

import {
  GLOBKURIER_PASSWORD_SECRET_KEY,
  encryptTenantSecret,
  resolveSecretsKeyring,
} from "@avably/core";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { loadCourierApi } from "../app/[locale]/zamowienia/[id]/delivery";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "SecretsPanel!12345678";
/** Sekret najemcy — unikalny, żeby dało się go rozpoznać w żądaniu do dostawcy. */
const COURIER_SECRET = `haslo-dostawcy-${randomUUID()}`;

const SECRETS_ENV = {
  AVABLY_SECRETS_KEY_CURRENT: "1",
  AVABLY_SECRETS_KEY_V1: Buffer.alloc(32, 77).toString("base64"),
};

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const createAdminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

/**
 * Nagrywa żądania wychodzące DO DOSTAWCY i odpowiada nagranym tokenem;
 * wszystko inne (Supabase) przepuszcza do prawdziwego fetcha.
 *
 * Przepuszczanie jest konieczne, a nie wygodne: GlobKurierAPI zapamiętuje
 * `globalThis.fetch` w chwili KONSTRUKCJI, więc podmiana musi obowiązywać już
 * podczas loadCourierApi — a ta w tym samym czasie czyta bazę przez HTTP.
 */
function recordingFetch(realFetch: typeof fetch): {
  calls: { url: string; body: string }[];
  impl: typeof fetch;
} {
  const calls: { url: string; body: string }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    // Dopasowanie po HOŚCIE dostawcy, nie po dowolnym wystąpieniu jego nazwy
    // w URL-u: zapytanie Supabase o sekret niesie w query `key=eq.globkurier_
    // password`, więc szersze dopasowanie przechwytywało odczyt z bazy
    // i podawało atrapę tokenu jako wiersz sekretu (złapane w trakcie prac).
    if (!/^https:\/\/(test\.)?api\.globkurier\.pl\//.test(url)) {
      return realFetch(input as RequestInfo, init);
    }

    calls.push({ url, body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ token: "token-testowy", expiresIn: 3600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe.skipIf(!hasEnv)("sekret dostawcy: zapis → odczyt → port kurierski (ADR-052)", () => {
  let admin: SupabaseClient;
  let ownerClient: SupabaseClient;
  let tenantId: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // Klucz szyfrujący wstrzykiwany przez process.env — loadCourierApi czyta
    // go tam, tak jak w runtime panelu.
    for (const [name, value] of Object.entries(SECRETS_ENV)) {
      savedEnv[name] = process.env[name];
      process.env[name] = value;
    }

    admin = createAdminClient();
    const email = `dsec-${randomUUID()}@test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    createdUserIds.push(data.user.id);

    const bootstrap = await signIn(email);
    const { data: newTenantId, error: tenantError } = await bootstrap
      .schema("app")
      .rpc("create_tenant", {
        p_slug: `dsec-${randomUUID()}`.slice(0, 39),
        p_name: "Organizacja dostaw",
      });
    if (tenantError) throw new Error(`create_tenant: ${tenantError.message}`);
    tenantId = newTenantId as string;
    createdTenantIds.push(tenantId);
    ownerClient = await signIn(email);

    // Komplet konfiguracji zapisany JAK W PANELU — sesją właściciela, przez RLS.
    const settings = [
      ["globkurier_credentials", { email: "kurier@example.com", environment: "test" }],
      [
        "courier_sender",
        {
          name: "Wypożyczalnia Testowa",
          street: "Przykładowa",
          house_number: "1",
          post_code: "00-001",
          city: "Miastko",
          phone: "+48600000000",
          email: "nadawca@example.com",
        },
      ],
      ["courier_parcel", { length_cm: 60, width_cm: 40, height_cm: 30, weight_kg: 10.5 }],
    ] as const;
    for (const [key, value] of settings) {
      const { error: settingError } = await ownerClient
        .from("tenant_settings")
        .upsert({ tenant_id: tenantId, key, value }, { onConflict: "tenant_id,key" });
      if (settingError) throw new Error(`upsert ${key}: ${settingError.message}`);
    }

    const envelope = encryptTenantSecret(
      COURIER_SECRET,
      { tenantId, key: GLOBKURIER_PASSWORD_SECRET_KEY },
      resolveSecretsKeyring(SECRETS_ENV),
    );
    const { error: secretError } = await ownerClient.from("tenant_secrets").upsert(
      {
        tenant_id: tenantId,
        key: GLOBKURIER_PASSWORD_SECRET_KEY,
        ciphertext: envelope.ciphertext,
        key_version: envelope.keyVersion,
      },
      { onConflict: "tenant_id,key" },
    );
    if (secretError) throw new Error(`upsert sekretu: ${secretError.message}`);
  }, 60_000);

  afterAll(async () => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("port kurierski dostaje hasło zapisane przez właściciela (pełna droga)", async () => {
    // Badamy DOKŁADNIE ten obiekt, który zwrócił loadCourierApi (a nie własną
    // kopię zbudowaną z tych samych credentiali) — inaczej test dowodziłby
    // tylko tego, że konstruktor działa.
    const realFetch = globalThis.fetch;
    const { calls, impl } = recordingFetch(realFetch);
    globalThis.fetch = impl;

    let loaded: Awaited<ReturnType<typeof loadCourierApi>>;
    try {
      loaded = await loadCourierApi(ownerClient, tenantId);
      expect(loaded.configError, `konfiguracja odrzucona: ${loaded.configError}`).toBeUndefined();
      expect(loaded.config!.credentials.password).toBe(COURIER_SECRET);

      // I do końca: port faktycznie NADAJE tym hasłem. Asercja na samym
      // `config.credentials` zatrzymałaby się o krok za wcześnie — dowodziłaby
      // odszyfrowania, ale nie tego, że wartość dociera do dostawcy.
      await loaded.api!.testConnection();
    } finally {
      globalThis.fetch = realFetch;
    }

    const loginCall = calls.find((call) => call.url.includes("/auth/login"));
    expect(loginCall, "port nie wykonał logowania u dostawcy").toBeDefined();
    expect(
      JSON.parse(loginCall!.body).password,
      "do dostawcy poszło inne hasło niż zapisał właściciel",
    ).toBe(COURIER_SECRET);
    expect(JSON.parse(loginCall!.body).email).toBe("kurier@example.com");
  });

  it("brak sekretu = czytelny brak konfiguracji, nie próba nadania pustym hasłem", async () => {
    const { error } = await ownerClient
      .from("tenant_secrets")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("key", GLOBKURIER_PASSWORD_SECRET_KEY);
    expect(error, `usunięcie sekretu: ${error?.message}`).toBeNull();

    const loaded = await loadCourierApi(ownerClient, tenantId);
    expect(loaded.api).toBeUndefined();
    expect(loaded.configError).toContain("hasła");
  });
});
