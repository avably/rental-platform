"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { clientIpFromHeaders } from "@avably/security/client-ip";
import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";
import { verifyTurnstile } from "@avably/security/turnstile";

import { authErrorKey, logAuthProviderError } from "@/app/[locale]/(auth)/auth-error";
import { localePath } from "@/lib/navigation";
import { setPostAuthNext } from "@/lib/post-auth-next";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { registerSchema, safeNextPath } from "@/lib/validation";

export interface RegisterState {
  error?: string;
}

export async function registerAction(
  _prevState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    turnstileToken: formData.get("turnstileToken") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  const next = safeNextPath(formData.get("next"));

  // IP z zaufanego źródła (nie goły x-forwarded-for) + progi: L2, ADR-106.
  // Rejestracja to najtańszy punkt masowego zakładania kont — okno godzinne.
  const ip = clientIpFromHeaders(await headers());
  const rateLimit = await checkRateLimit(`register:ip:${ip}`, {
    limit: 5,
    windowSeconds: 3600,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!rateLimit.success) {
    const t = await getTranslations("authError");
    return { error: t("tooManyRequests") };
  }

  // FAIL-CLOSED także przy awarii dostawcy (providerError) — rozstrzygnięcie
  // ADR-106: chwilowo zablokowana rejestracja jest tańsza niż okno, w którym
  // boty zakładają konta bez weryfikacji. Fail-open dostaje wyłącznie login.
  const turnstile = await verifyTurnstile(parsed.data.turnstileToken);
  if (!turnstile.ok) {
    const t = await getTranslations("register");
    return { error: t("captchaFailed") };
  }

  const supabase = await createSupabaseServerClient();
  // Język ekranu rejestracji ląduje w user_metadata, bo to JEDYNE źródło
  // języka, jakie ma Send Email Hook (ADR-048): potwierdzenie adresu leci
  // ZANIM użytkownik ma organizację, więc `tenants.locale` jeszcze nie
  // istnieje, a `redirect_to` nie niesie prefiksu locale. Wartość jest
  // walidowana po stronie hooka — user_metadata jest zapisywalne przez
  // użytkownika, więc nie ufamy jej w ciemno.
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { locale: await getLocale() } },
  });
  if (error) {
    // Treść dostawcy idzie WYŁĄCZNIE do logu (ADR-051) — na ekran ma trafić
    // nasz komunikat, w języku użytkownika.
    logAuthProviderError("register", error);
    const t = await getTranslations("authError");
    return { error: t(authErrorKey(error)) };
  }

  // `next` (np. /zaproszenie/<token>) musi przetrwać rundę e-mail — chowamy
  // go w krótkotrwałym cookie konsumowanym w /auth/confirm.
  if (next) {
    setPostAuthNext(await cookies(), next);
  }

  redirect(await localePath("/register/sprawdz-skrzynke"));
}
