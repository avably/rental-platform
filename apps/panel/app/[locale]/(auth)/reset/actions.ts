"use server";

import { headers } from "next/headers";

import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";
import { verifyTurnstile } from "@avably/security/turnstile";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resetRequestSchema } from "@/lib/validation";

export interface ResetRequestState {
  error?: string;
  success?: string;
}

export async function resetRequestAction(
  _prevState: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const parsed = resetRequestSchema.safeParse({
    email: formData.get("email"),
    turnstileToken: formData.get("turnstileToken") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";
  const rateLimit = await checkRateLimit(`reset:${ip}`, {
    limit: 5,
    windowSeconds: 60,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!rateLimit.success) {
    return { error: "Zbyt wiele prób. Spróbuj ponownie za chwilę." };
  }

  const turnstile = await verifyTurnstile(parsed.data.turnstileToken);
  if (!turnstile.ok) {
    return { error: "Weryfikacja CAPTCHA nie powiodła się." };
  }

  const supabase = await createSupabaseServerClient();
  // Błąd celowo NIE jest ujawniany w treści komunikatu (nie zdradzamy, czy
  // konto istnieje) — Supabase i tak nie zwraca informacji o istnieniu usera.
  await supabase.auth.resetPasswordForEmail(parsed.data.email);

  return {
    success: "Jeśli konto z tym adresem istnieje, wysłaliśmy e-mail z linkiem do resetu hasła.",
  };
}
