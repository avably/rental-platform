"use server";

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { clientIpFromHeaders } from "@avably/security/client-ip";
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

  // IP z zaufanego źródła + drugi wymiar po znormalizowanym adresie
  // (resetRequestSchema robi trim+lowercase): reset wysyła e-mail, więc bez
  // wymiaru adresowego atak rozproszony po IP mail-bombuje jedną skrzynkę.
  // Progi i jednolity komunikat (bez zdradzania wymiaru): L2, ADR-106.
  const ip = clientIpFromHeaders(await headers());
  const rateLimitIp = await checkRateLimit(`reset:ip:${ip}`, {
    limit: 3,
    windowSeconds: 3600,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  const rateLimitEmail = await checkRateLimit(`reset:email:${parsed.data.email}`, {
    limit: 3,
    windowSeconds: 3600,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!rateLimitIp.success || !rateLimitEmail.success) {
    const t = await getTranslations("authError");
    return { error: t("tooManyRequests") };
  }

  // FAIL-CLOSED także przy awarii dostawcy (providerError) — ADR-106: reset
  // wysyła pocztę, fail-open w oknie awarii = darmowy mail-bombing.
  const turnstile = await verifyTurnstile(parsed.data.turnstileToken);
  if (!turnstile.ok) {
    const t = await getTranslations("resetRequest");
    return { error: t("captchaFailed") };
  }

  const supabase = await createSupabaseServerClient();
  // Błąd celowo NIE jest ujawniany w treści komunikatu (nie zdradzamy, czy
  // konto istnieje) — Supabase i tak nie zwraca informacji o istnieniu usera.
  await supabase.auth.resetPasswordForEmail(parsed.data.email);

  const t = await getTranslations("resetRequest");
  return { success: t("successNeutral") };
}
