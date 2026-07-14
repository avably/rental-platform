"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth";
import { checkAuthRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { verifyTurnstile } from "@/lib/turnstile";
import { loginSchema } from "@/lib/validation";

export interface LoginState {
  error?: string;
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    turnstileToken: formData.get("turnstileToken") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";
  const rateLimitIp = await checkAuthRateLimit(`login:ip:${ip}`, { limit: 20, windowSeconds: 60 });
  const rateLimitEmail = await checkAuthRateLimit(`login:email:${parsed.data.email}`, {
    limit: 10,
    windowSeconds: 60,
  });
  if (!rateLimitIp.success || !rateLimitEmail.success) {
    return { error: "Zbyt wiele prób logowania. Spróbuj ponownie za chwilę." };
  }

  const turnstile = await verifyTurnstile(parsed.data.turnstileToken);
  if (!turnstile.ok) {
    return { error: "Weryfikacja CAPTCHA nie powiodła się." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    return { error: "Nieprawidłowy e-mail lub hasło." };
  }

  const ctx = await getAuthContext(supabase);
  redirect(ctx?.tenantId ? "/" : "/organizacja/nowa");
}
