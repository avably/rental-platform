"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { checkAuthRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { verifyTurnstile } from "@/lib/turnstile";
import { registerSchema } from "@/lib/validation";

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

  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";
  const rateLimit = await checkAuthRateLimit(`register:${ip}`, { limit: 5, windowSeconds: 60 });
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

  redirect("/register/sprawdz-skrzynke");
}
