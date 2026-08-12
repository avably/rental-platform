"use server";

/**
 * Zapis ustawień dostaw: upsert per klucz tenant_settings (PK tenant_id+key)
 * oraz — od ADR-052 — hasła dostawcy do public.tenant_secrets, zaszyfrowanego.
 * Zod u źródła (schematy produkują jsonb w kształcie bazy), autorytatywnie
 * odmawiają CHECK-i 0013/0024 kodem 23514 — komunikat mapowany dla operatora.
 *
 * BRAMKA WŁAŚCICIELA JEST W BAZIE, nie tutaj (migracja 0024): polityki RLS
 * tenant_settings i tenant_secrets dopuszczają zapis wyłącznie roli owner,
 * a te funkcje jedynie TŁUMACZĄ odmowę 42501 na zdanie dla operatora.
 * Świadomie NIE dokładamy tu wcześniejszego sprawdzenia roli: byłaby to druga
 * kopia reguły, która z czasem rozjeżdża się z pierwszą, a przede wszystkim
 * nie chroniłaby niczego — żądanie można wysłać wprost do PostgREST
 * z pominięciem tego pliku. Dokładnie tym był dług ADR-031: bramka istniała
 * wyłącznie w interfejsie.
 */
import {
  GLOBKURIER_PASSWORD_SECRET_KEY,
  SecretsConfigError,
  encryptTenantSecret,
  resolveSecretsKeyring,
} from "@avably/core";
import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { AuthError } from "@/lib/auth";
import { withFormEcho, zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

import {
  deliverySettingsCredentialsSchema,
  deliverySettingsParcelSchema,
  deliverySettingsPricingSchema,
  deliverySettingsSenderSchema,
} from "./delivery-settings-validation";

const PG_CHECK_VIOLATION = "23514";
/** 42501 = insufficient_privilege — odmowa z RLS (nie-owner próbuje zapisać). */
const PG_INSUFFICIENT_PRIVILEGE = "42501";

const OWNER_ONLY_MESSAGE = "Ustawienia dostaw może zmieniać wyłącznie właściciel konta.";

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

/**
 * Odmowa polityki RLS wraca z PostgREST jako 42501 przy naruszeniu WITH CHECK,
 * ale UPDATE odfiltrowany klauzulą USING nie narusza niczego — po prostu nie
 * trafia w żaden wiersz i kończy się pustym wynikiem. Oba przypadki znaczą dla
 * operatora to samo: zabrakło uprawnień właściciela.
 */
function refusalState(code: string | undefined, message: string): FormState {
  if (code === PG_INSUFFICIENT_PRIVILEGE) return { formError: OWNER_ONLY_MESSAGE };
  if (code === PG_CHECK_VIOLATION) {
    return {
      formError:
        "Wartości odrzucone przez walidację bazy — sprawdź kompletność pól i spróbuj ponownie.",
    };
  }
  return { formError: message };
}

async function upsertSetting(key: string, value: unknown): Promise<FormState> {
  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const { data, error } = await ctx.supabase
    .from("tenant_settings")
    .upsert(
      {
        tenant_id: ctx.tenantId,
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,key" },
    )
    .select("key");
  if (error) {
    return refusalState(error.code, error.message);
  }
  if (!data || data.length === 0) {
    // Pusty wynik bez błędu = polityka USING odfiltrowała wiersz. To jest
    // ODMOWA, nie awaria zapisu — komunikat musi mówić prawdę, inaczej owner
    // i pracownik dostają ten sam mglisty tekst przy zupełnie różnych
    // przyczynach.
    return { formError: OWNER_ONLY_MESSAGE };
  }

  revalidatePath("/", "layout");
  return { success: key };
}

/**
 * Zapis sekretu tenanta: szyfrowanie w @avably/core, do bazy idzie WYŁĄCZNIE
 * koperta. Wartość jawna nie jest logowana, nie wraca w FormState i nie
 * pojawia się w żadnym komunikacie błędu (ADR-052).
 */
async function upsertSecret(key: string, plaintext: string): Promise<FormState> {
  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  let envelope;
  try {
    envelope = encryptTenantSecret(
      plaintext,
      // requireMember() rzuca przy braku tenanta (lib/auth.ts), więc w tym
      // miejscu tenantId jest zawsze ustawiony — typ tego nie wie.
      { tenantId: ctx.tenantId!, key },
      resolveSecretsKeyring(process.env),
    );
  } catch (err) {
    if (err instanceof SecretsConfigError) {
      // Jawna niedostępność zamiast cichego zapisu plaintextu — wzorzec
      // ADR-033/036. Zapisanie hasła „na razie bez szyfrowania" byłoby
      // dokładnie tym długiem, który ta zmiana zamyka.
      return {
        formError:
          "Szyfrowanie sekretów nie jest skonfigurowane na tym środowisku — " +
          "hasło nie zostało zapisane. Skontaktuj się z obsługą.",
      };
    }
    throw err;
  }

  const { data, error } = await ctx.supabase
    .from("tenant_secrets")
    .upsert(
      {
        tenant_id: ctx.tenantId,
        key,
        ciphertext: envelope.ciphertext,
        key_version: envelope.keyVersion,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,key" },
    )
    .select("key");
  if (error) {
    return refusalState(error.code, error.message);
  }
  if (!data || data.length === 0) {
    return { formError: OWNER_ONLY_MESSAGE };
  }

  revalidatePath("/", "layout");
  return { success: key };
}

function parseWith<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: Record<string, string>,
): { value: z.infer<Schema> } | { state: FormState } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { state: zodErrorToState(parsed.error) };
  return { value: parsed.data };
}

/**
 * Credentiale dostawcy zapisują się do DWÓCH miejsc: część jawna
 * (e-mail, środowisko) do tenant_settings, hasło zaszyfrowane do
 * tenant_secrets.
 *
 * KOLEJNOŚĆ: najpierw sekret, potem część jawna. Gdyby zapis się rozjechał
 * (odmowa uprawnień, awaria sieci między jednym a drugim), chcemy zostać ze
 * starą, DZIAŁAJĄCĄ konfiguracją zamiast z nowym e-mailem i starym hasłem —
 * ta druga kombinacja logowałaby się u dostawcy jako nie ta firma. Transakcji
 * przez PostgREST nie mamy; wybór kolejności jest tu całą dostępną obroną
 * i dlatego jest świadomy, a nie przypadkowy.
 */
export async function saveCourierCredentialsAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const input = {
    email: str(formData.get("email")),
    password: str(formData.get("password")),
    environment: str(formData.get("environment")),
  };
  const result = parseWith(deliverySettingsCredentialsSchema, input);
  // Echo odsiewa `password` w `formEcho` — hasło jest write-only (ADR-052)
  // i nie wraca do formularza nawet wtedy, gdy operator właśnie je wpisał.
  if ("state" in result) return withFormEcho(result.state, input);

  const { password, ...publicPart } = result.value;

  const secretState = await upsertSecret(GLOBKURIER_PASSWORD_SECRET_KEY, password);
  if (!secretState.success) return withFormEcho(secretState, input);

  return withFormEcho(await upsertSetting("globkurier_credentials", publicPart), input);
}

export async function saveCourierSenderAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const input = {
    name: str(formData.get("name")),
    street: str(formData.get("street")),
    houseNumber: str(formData.get("houseNumber")),
    apartmentNumber: str(formData.get("apartmentNumber")),
    postCode: str(formData.get("postCode")),
    city: str(formData.get("city")),
    phone: str(formData.get("phone")),
    email: str(formData.get("email")),
  };
  const result = parseWith(deliverySettingsSenderSchema, input);
  if ("state" in result) return withFormEcho(result.state, input);
  return withFormEcho(await upsertSetting("courier_sender", result.value), input);
}

export async function saveCourierParcelAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const input = {
    lengthCm: str(formData.get("lengthCm")),
    widthCm: str(formData.get("widthCm")),
    heightCm: str(formData.get("heightCm")),
    weightKg: str(formData.get("weightKg")),
  };
  const result = parseWith(deliverySettingsParcelSchema, input);
  if ("state" in result) return withFormEcho(result.state, input);
  return withFormEcho(await upsertSetting("courier_parcel", result.value), input);
}

export async function saveDeliveryPricingAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const input = {
    courierPrice: str(formData.get("courierPrice")),
    courierFreeAbove: str(formData.get("courierFreeAbove")),
    parcelLockerPrice: str(formData.get("parcelLockerPrice")),
    parcelLockerFreeAbove: str(formData.get("parcelLockerFreeAbove")),
    ownDeliveryPrice: str(formData.get("ownDeliveryPrice")),
    ownDeliveryFreeAbove: str(formData.get("ownDeliveryFreeAbove")),
  };
  const result = parseWith(deliverySettingsPricingSchema, input);
  if ("state" in result) return withFormEcho(result.state, input);
  return withFormEcho(await upsertSetting("delivery_pricing", result.value), input);
}
