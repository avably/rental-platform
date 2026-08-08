"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { clientIpFromHeaders } from "@avably/security/client-ip";
import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";

import { authErrorKey, logAuthProviderError } from "@/app/[locale]/(auth)/auth-error";
import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resetConfirmSchema } from "@/lib/validation";

export interface ResetConfirmState {
  error?: string;
}

export async function resetConfirmAction(
  _prevState: ResetConfirmState,
  formData: FormData,
): Promise<ResetConfirmState> {
  const parsed = resetConfirmSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  // Ostatnia trasa auth bez dławienia — L2 (ADR-106) objął login/register/reset
  // request, ale nie ustawienie nowego hasła. Limit stoi PRZED dostawcą, także
  // przed odczytem sesji: to właśnie ta runda jest kosztem, który trzeba dławić.
  //
  // Sesja recovery bramkuje, KTO tu wejdzie — nie ILE razy. Z ważnym linkiem
  // odpowiedzi dostawcy są wyrocznią: `same_password` potwierdza trafienie w
  // AKTUALNE hasło konta, `weak_password` obrysowuje politykę. Limit sprowadza
  // to do kilku prób na godzinę. Bez sesji trasa i tak kosztuje rundę do
  // dostawcy na każde żądanie, a nieodciętą można powtarzać w nieskończoność.
  //
  // JEDEN wymiar (IP), bez kontowego: tożsamość konta niesie dopiero sesja,
  // czyli wywołanie, które limit ma osłaniać — wymiar per konto wymagałby
  // odwrócenia tej kolejności. Klucz z zaufanego źródła (`x-real-ip` platformy
  // / ostatni hop XFF), próg godzinny jak w reset request. Komunikat JEDNOLITY
  // z pozostałymi trasami — nie zdradza, czy link/sesja w ogóle były ważne.
  //
  // CAPTCHA świadomie NIE — uzasadnienie w aneksie ADR-106.
  const ip = clientIpFromHeaders(await headers());
  const rateLimit = await checkRateLimit(`reset-confirm:ip:${ip}`, {
    limit: 5,
    windowSeconds: 3600,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!rateLimit.success) {
    const t = await getTranslations("authError");
    return { error: t("tooManyRequests") };
  }

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) {
    return { error: "Sesja resetu wygasła lub link jest nieprawidłowy. Poproś o nowy link." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    // Jak w rejestracji (ADR-051): surowa treść do logu, na ekran nasz tekst.
    // Tu najczęściej `weak_password` (polityka hasła po stronie dostawcy jest
    // ostrzejsza niż nasz schemat) i `same_password`.
    logAuthProviderError("reset-confirm", error);
    const t = await getTranslations("authError");
    return { error: t(authErrorKey(error)) };
  }

  redirect(await localePath("/login", { reset: "ok" }));
}
