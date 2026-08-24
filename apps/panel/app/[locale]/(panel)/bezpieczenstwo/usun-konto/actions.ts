"use server";

/**
 * ŻĄDANIE usunięcia konta — NIE usunięcie.
 *
 * Świadomie NIE kasujemy tu niczego. Usunięcie konta/organizacji to poważna,
 * nieodwracalna kaskada (auth user + dane tenanta + Stripe + RLS), a
 * BEZPIECZNEGO backendu erasure dla WŁASNEGO konta operatora dziś NIE MA
 * (`app.erase_customer` z ADR-116 kasuje KLIENTA najemcy, nie konto operatora;
 * `admin.deleteUser` nie jest nigdzie wołane dla siebie). Budowanie takiej
 * kaskady ad-hoc z tego ekranu byłoby dokładnie tym, przed czym ostrzega brief.
 *
 * Dlatego akcja REJESTRUJE żądanie w metadanych KONTA wołającego
 * (`user_metadata.account_deletion_request`) — zapis idzie przez GoTrue
 * klientem z sesji żądania, więc dotyczy WYŁĄCZNIE konta wołającego (self-scope
 * z konstrukcji, jak `signOutOtherDevicesAction`), jest nieniszczący i
 * odwracalny. Właściwą kaskadę erasure + migrację zaprojektuje właściciel/PM
 * jako osobne, bramkowane zadanie (patrz raport wykonawcy).
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { clientIpFromHeaders } from "@avably/security/client-ip";
import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";

import { logAuthProviderError } from "@/app/[locale]/(auth)/auth-error";
import { getAuthContext } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { readAccountDeletionContext } from "./account-deletion";

/**
 * Klucz metadanych żądania. NIE eksportowany: plik z "use server" wystawia
 * każdy eksport jako punkt wejścia akcji serwerowej i musi eksportować WYŁĄCZNIE
 * async funkcje — stała `export const` wywala cały moduł przy `next build`.
 */
const ACCOUNT_DELETION_REQUEST_KEY = "account_deletion_request";

/**
 * Rejestruje żądanie usunięcia konta wołającego.
 *
 * KOLEJNOŚĆ jak przy zmianie hasła: (1) limit per IP przed jakąkolwiek pracą,
 * (2) sesja (tożsamość), (3) limit per użytkownik, (4) bramka jedynego
 * właściciela WYEGZEKWOWANA po stronie serwera (nie tylko ukryta w UI),
 * (5) potwierdzenie przez PRZEPISANIE adresu konta (wzorzec `customer-erasure`),
 * (6) zapis żądania do metadanych konta.
 */
export async function requestAccountDeletionAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const ip = clientIpFromHeaders(await headers());
  const ipLimit = await checkRateLimit(`account-deletion:ip:${ip}`, {
    limit: 10,
    windowSeconds: 3600,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!ipLimit.success) {
    const tAuth = await getTranslations("authError");
    return { formError: tAuth("tooManyRequests") };
  }

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));

  const userLimit = await checkRateLimit(`account-deletion:user:${ctx.user.id}`, {
    limit: 5,
    windowSeconds: 3600,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!userLimit.success) {
    const tAuth = await getTranslations("authError");
    return { formError: tAuth("tooManyRequests") };
  }

  const t = await getTranslations("security");
  const deletion = await readAccountDeletionContext(supabase, ctx);

  // BRAMKA jedynego właściciela — egzekwowana TU, nie tylko przez render strony.
  if (deletion.isSoleOwner) return { formError: t("deleteSoleOwnerBlock") };

  // Konto bez adresu nie ma czym potwierdzić żądania — odmowa jak przy złym
  // potwierdzeniu (żadnego powodu, by formularz je rozróżniał).
  if (!deletion.email) return { fieldErrors: { confirmation: t("deleteConfirmMismatch") } };

  const confirmation = (formData.get("confirmation") ?? "").toString().trim().toLowerCase();
  if (confirmation !== deletion.email.trim().toLowerCase()) {
    return { fieldErrors: { confirmation: t("deleteConfirmMismatch") } };
  }

  // OZNACZENIE ŻĄDANIA w metadanych KONTA wołającego. `updateUser({ data })`
  // MERGE'uje klucze do `raw_user_meta_data`, więc `locale` (zapisywane przy
  // rejestracji, czytane przez hook maili kont) zostaje nietknięte.
  const { error } = await supabase.auth.updateUser({
    data: {
      [ACCOUNT_DELETION_REQUEST_KEY]: {
        requested_at: new Date().toISOString(),
        tenant_id: deletion.tenantId,
      },
    },
  });
  if (error) {
    logAuthProviderError("account-deletion:request", error);
    return { formError: t("deleteRequestError") };
  }

  return { success: t("deleteRequestSuccess") };
}
