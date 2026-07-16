"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";

import { localePath } from "@/lib/navigation";
import { setPostAuthNext } from "@/lib/post-auth-next";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { verifyTurnstile } from "@/lib/turnstile";
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
    return { error: "Weryfikacja CAPTCHA nie powiodła się." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
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
