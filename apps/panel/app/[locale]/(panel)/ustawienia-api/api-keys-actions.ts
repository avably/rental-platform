"use server";

/**
 * Akcje ekranu kluczy publicznego API (M1, ADR-108).
 *
 * GENEROWANIE: surowy klucz (avbl_ + 32 bajty hex z randomBytes) powstaje
 * TUTAJ, żyje przez jedno wywołanie akcji i wraca do przeglądarki DOKŁADNIE
 * RAZ (stan formularza — nie ląduje w bazie, logu ani odpowiedzi listy).
 * Do bazy idzie wyłącznie sha256 + prefiks identyfikacyjny (wzorzec
 * invitations.token_hash; kolumna key_hash ma CHECK 64-hex, więc plaintext
 * jest w niej NIEREPREZENTOWALNY — dowód w packages/db/test/api-keys.test.ts).
 *
 * ODWOŁANIE: znacznik revoked_at, nie DELETE — lista zachowuje historię,
 * a weryfikacja (app.verify_api_key) filtruje po `revoked_at is null`.
 * Odwołanie jest NIEODWRACALNE z poziomu UI (żadna akcja nie zeruje
 * revoked_at) — wzorzec ConfirmSubmit pyta o zamiar przed wysłaniem.
 *
 * BRAMKĄ RÓL JEST RLS (0053: INSERT/UPDATE wyłącznie owner) — akcje
 * dokładają czytelny komunikat, ale odmowa nie zależy od UI (test:
 * packages/db/test/api-keys.test.ts, staff dostaje 42501 z bazy).
 */
import { randomBytes, createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AuthError } from "@/lib/auth";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

/** 42501 = insufficient_privilege — odmowa RLS (mutacje tylko dla ownera). */
const PG_INSUFFICIENT_PRIVILEGE = "42501";

/** Stan generowania: FormState + surowy klucz pokazywany JEDEN raz. */
export interface GeneratedKeyState extends FormState {
  /** Surowy klucz — obecny WYŁĄCZNIE w odpowiedzi akcji generującej. */
  generatedKey?: string;
}

const nameSchema = z.object({
  name: z
    .string({ message: "Podaj nazwę klucza." })
    .trim()
    .min(1, "Podaj nazwę klucza.")
    .max(80, "Nazwa może mieć najwyżej 80 znaków."),
});

type MemberContext = Awaited<ReturnType<typeof requireMember>>;

async function member(): Promise<MemberContext | FormState> {
  try {
    return await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }
}

function isFormState(value: MemberContext | FormState): value is FormState {
  return !("supabase" in value);
}

export async function generateApiKeyAction(
  _prevState: GeneratedKeyState,
  formData: FormData,
): Promise<GeneratedKeyState> {
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return zodErrorToState(parsed.error);

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  // 32 bajty entropii — format spisany w ADR-108 (avbl_ + 64 hex).
  const rawKey = `avbl_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const { error } = await ctx.supabase.from("api_keys").insert({
    tenant_id: ctx.tenantId,
    name: parsed.data.name,
    key_hash: keyHash,
    key_prefix: rawKey.slice(0, 13),
  });
  if (error) {
    if (error.code === PG_INSUFFICIENT_PRIVILEGE) {
      return { formError: "Klucze API może generować wyłącznie właściciel organizacji." };
    }
    return { formError: error.message };
  }

  revalidatePath("/", "layout");
  // Surowy klucz wraca RAZ — kolejny render listy zna już tylko prefiks.
  return { success: parsed.data.name, generatedKey: rawKey };
}

export async function revokeApiKeyAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const rawId = formData.get("keyId");
  const keyId = typeof rawId === "string" && rawId.length > 0 ? rawId : null;
  if (!keyId) return { formError: "Brak klucza do odwołania." };

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  const { data, error } = await ctx.supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    // Filtr po tenant_id NA WIERZCHU RLS (pas i szelki — wzorzec
    // checkDomainAction): regresja polityki nie zamieni tego w odwołanie
    // cudzego klucza.
    .eq("tenant_id", ctx.tenantId)
    .eq("id", keyId)
    // Odwołany drugi raz = no-op, nie „świeższa" data odwołania.
    .is("revoked_at", null)
    .select("id");
  if (error) {
    if (error.code === PG_INSUFFICIENT_PRIVILEGE) {
      return { formError: "Klucze API może odwołać wyłącznie właściciel organizacji." };
    }
    return { formError: error.message };
  }
  // RLS/rola przycina UPDATE do zera wierszy bez wyjątku — komunikat celowo
  // nie rozróżnia „nie istnieje", „nie twój" i „brak roli" (bez sondowania).
  if (!data || data.length === 0) return { formError: "Nie udało się odwołać klucza." };

  revalidatePath("/", "layout");
  return { success: keyId };
}
