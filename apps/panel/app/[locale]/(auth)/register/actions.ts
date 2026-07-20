"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";
import { verifyTurnstile } from "@avably/security/turnstile";

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

  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";
  const rateLimit = await checkRateLimit(`register:${ip}`, {
    limit: 5,
    windowSeconds: 60,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!rateLimit.success) {
    return { error: "Zbyt wiele prób rejestracji. Spróbuj ponownie za chwilę." };
  }

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
    return { error: error.message };
  }

  // `next` (np. /zaproszenie/<token>) musi przetrwać rundę e-mail — chowamy
  // go w krótkotrwałym cookie konsumowanym w /auth/confirm.
  if (next) {
    setPostAuthNext(await cookies(), next);
  }

  redirect(await localePath("/register/sprawdz-skrzynke"));
}
