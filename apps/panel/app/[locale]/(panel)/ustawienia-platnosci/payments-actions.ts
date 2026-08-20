"use server";

/**
 * Akcje ekranu płatności (Z2, ADR-065).
 *
 * PODZIAŁ ODPOWIEDZIALNOŚCI. O gotowości konta orzeka DOSTAWCA i wyłącznie
 * on; my odzwierciedlamy jego werdykt w kolumnach `payment_accounts`. Nigdzie
 * w tym pliku nie ustawiamy `charges_enabled`/`payouts_enabled` z własnej
 * decyzji ani z odpowiedzi na zapis — jedyne źródło tych wartości to
 * `syncConnectAccountSafely`, czyli `GET /v1/accounts/{id}` (ADR-049).
 *
 * To jest dokładnie ta awaria, która nas kosztowała dzień w 2.6b: kolumna
 * `verified` ustawiana w tej samej transakcji co byt, UI mówiący „Działa"
 * i adres, który nie działał. Tam kosztowało to czas. Tu kosztowałoby
 * pieniądze klienta najemcy.
 *
 * BRAMKA ROLI JEST W BAZIE (0028), nie tutaj: założenie i odłączenie konta
 * to `owner_insert`/`owner_delete`, a odświeżenie kopii prezentacyjnej —
 * każdy członek. Interfejs tylko WYŚWIETLA tę granicę (wyszarzony przycisk
 * z powodem); żądanie wysłane poza UI i tak odbija się o politykę.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  StripeConfigError,
  createConnectAccount,
  createOnboardingLink,
  stripeAvailability,
  syncConnectAccountSafely,
} from "@avably/core";

import { AuthError } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { requireMember } from "@/lib/supabase-server";

import {
  CONNECT_ACCOUNT_COUNTRY,
  PAYMENT_RETURN_PATH,
  PAYMENT_SETTINGS_PATH,
  panelBaseUrl,
} from "./payments-config";

const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_UNIQUE_VIOLATION = "23505";

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

/** Odmowa polityki 0028 przetłumaczona na zdanie, nie na kod SQLSTATE. */
function writeError(error: { code?: string; message: string }): string {
  if (error.code === PG_INSUFFICIENT_PRIVILEGE) {
    return "Konto płatności może podpiąć i odłączyć wyłącznie właściciel organizacji.";
  }
  if (error.code === PG_UNIQUE_VIOLATION) {
    return "To konto u dostawcy płatności jest już podpięte do innej organizacji.";
  }
  return error.message;
}

/** Kolumny stanu wyliczone WYŁĄCZNIE z odczytu (patrz docblock pliku). */
function cacheFromSync(sync: Awaited<ReturnType<typeof syncConnectAccountSafely>>) {
  if (!sync.state) {
    // Porażka odczytu zapisuje SAM POWÓD. Wyzerowanie kolumn pokazałoby
    // najemcy „konto przestało działać" przy naszym timeoucie, a w Z3 ukryło
    // płatność online — awaria po naszej stronie zabierałaby mu pieniądze.
    return { last_error: sync.error };
  }
  return {
    charges_enabled: sync.state.chargesEnabled,
    payouts_enabled: sync.state.payoutsEnabled,
    details_submitted: sync.state.detailsSubmitted,
    requirements_due: sync.state.requirementsDue,
    last_error: null,
    last_synced_at: new Date().toISOString(),
  };
}

/**
 * Rozpoczyna albo WZNAWIA onboarding KYC.
 *
 * Jedna akcja na obie sytuacje, bo z punktu widzenia najemcy to jedno
 * pytanie „chcę dokończyć konfigurację": link onboardingowy dostawcy jest
 * jednorazowy i krótkożyjący, więc wznowienie i tak wymaga nowego linku.
 *
 * KOLEJNOŚĆ: konto u dostawcy → wiersz w bazie → link. Odwrotna zostawiałaby
 * wiersz wskazujący konto, którego nie ma. Dwuklik przed pierwszym zapisem
 * łapie klucz idempotencji dostawcy (ten sam najemca = ta sama odpowiedź),
 * więc sierota u dostawcy nie powstaje.
 */
export async function startPaymentOnboardingAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const availability = stripeAvailability();
  if (!availability.available) {
    // Neutralnie i bez powodu z serwera (U1, audyt W3): nazwy brakujących
    // zmiennych to sprawa platformy, nie ekran najemcy.
    return {
      formError:
        "Płatności online są chwilowo niedostępne po stronie platformy - spróbuj ponownie później.",
    };
  }

  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  const { data: existing, error: readError } = await ctx.supabase
    .from("payment_accounts")
    .select("provider_account_id")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (readError) return { formError: readError.message };

  let providerAccountId = (existing?.provider_account_id as string | undefined) ?? null;

  if (!providerAccountId) {
    try {
      providerAccountId = await createConnectAccount({
        country: CONNECT_ACCOUNT_COUNTRY,
        ...(ctx.user.email ? { email: ctx.user.email } : {}),
        // Klucz stały per najemca: dwa kliknięcia „załóż konto" mają dać
        // JEDNO konto u dostawcy, a nie dwa (drugie byłoby sierotą — wiersz
        // jest jeden, bo PK to tenant_id).
        idempotencyKey: `avably-connect-account:${ctx.tenantId}`,
      });
    } catch (error) {
      if (error instanceof StripeConfigError) return { formError: error.message };
      return {
        formError:
          error instanceof Error
            ? `Nie udało się założyć konta płatności: ${error.message}`
            : "Nie udało się założyć konta płatności.",
      };
    }

    const { error: insertError } = await ctx.supabase.from("payment_accounts").insert({
      tenant_id: ctx.tenantId,
      provider: "stripe",
      provider_account_id: providerAccountId,
      // ŻADNEJ kolumny gotowości: świeże konto jest niegotowe z definicji,
      // a jedyną drogą do `true` jest odczyt (defaulty w 0028 są `false`).
    });
    if (insertError) return { formError: writeError(insertError) };
  }

  const base = await panelBaseUrl();
  let url: string;
  try {
    const link = await createOnboardingLink(providerAccountId, {
      returnUrl: `${base}${PAYMENT_RETURN_PATH}`,
      refreshUrl: `${base}${PAYMENT_SETTINGS_PATH}`,
    });
    url = link.url;
  } catch (error) {
    return {
      formError:
        error instanceof Error
          ? `Nie udało się otworzyć formularza weryfikacji: ${error.message}`
          : "Nie udało się otworzyć formularza weryfikacji.",
    };
  }

  revalidatePath("/", "layout");
  // POZA try/catch: `redirect` działa przez wyjątek sterujący, a złapanie go
  // zamieniłoby przekierowanie w komunikat o błędzie.
  redirect(url);
}

/**
 * Odświeżenie stanu konta na żądanie — jedyny sposób, w jaki kolumny
 * gotowości w ogóle się zmieniają poza powrotem z onboardingu.
 */
export async function refreshPaymentAccountAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  const { data: account, error: readError } = await ctx.supabase
    .from("payment_accounts")
    .select("provider_account_id")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (readError) return { formError: readError.message };
  if (!account) return { formError: "Nie masz jeszcze konta płatności." };

  const sync = await syncConnectAccountSafely(account.provider_account_id as string);

  const { error: updateError } = await ctx.supabase
    .from("payment_accounts")
    .update(cacheFromSync(sync))
    // Filtr po tenant_id NA WIERZCHU RLS (pas i szelki), jak w akcjach domen.
    .eq("tenant_id", ctx.tenantId);
  if (updateError) return { formError: updateError.message };

  revalidatePath("/", "layout");
  return sync.ok
    ? { success: account.provider_account_id as string }
    : { formError: sync.error ?? "Nie udało się odczytać stanu konta." };
}

/**
 * Odłączenie konta — jedyna droga do podpięcia INNEGO konta, bo
 * `provider_account_id` jest niezmienny (bramka 0028).
 *
 * Konta u dostawcy NIE kasujemy: nie jest nasze, mogą na nim wisieć rozliczenia
 * najemcy, a usunięcie cudzego konta na podstawie kliknięcia w naszym panelu
 * byłoby operacją nieodwracalną wykonaną nie tam, gdzie zapadła decyzja.
 * Odłączamy WIĄZANIE, a najemca zachowuje dostęp do konta u dostawcy.
 */
export async function disconnectPaymentAccountAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const ctx = await member();
  if (isFormState(ctx)) return ctx;

  const { data, error } = await ctx.supabase
    .from("payment_accounts")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .select("provider_account_id");
  if (error) return { formError: writeError(error) };
  // RLS przycina DELETE bez błędu, więc brak skasowanego wiersza to jedyny
  // sygnał, że polityka odmówiła (pracownik zamiast właściciela).
  if (!data || data.length === 0) {
    return { formError: "Konto płatności może odłączyć wyłącznie właściciel organizacji." };
  }

  revalidatePath("/", "layout");
  return { success: data[0]!.provider_account_id as string };
}
