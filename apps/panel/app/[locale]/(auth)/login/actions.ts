"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { SUPERADMIN_HOME } from "@/lib/superadmin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { verifyTurnstile } from "@/lib/turnstile";
import { loginSchema, safeNextPath } from "@/lib/validation";

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

  // Docelowa ścieżka po zalogowaniu (np. /zaproszenie/<token> dla zaproszonego
  // bez konta). Sanityzowana przeciw open-redirect (patrz safeNextPath).
  const next = safeNextPath(formData.get("next"));

  const ip = (await headers()).get("x-forwarded-for") ?? "unknown";
  const rateLimitIp = await checkRateLimit(`login:ip:${ip}`, {
    limit: 20,
    windowSeconds: 60,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  const rateLimitEmail = await checkRateLimit(`login:email:${parsed.data.email}`, {
    limit: 10,
    windowSeconds: 60,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
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

  if (next) {
    redirect(await localePath(next));
  }

  const ctx = await getAuthContext(supabase);

  // Kolejność NIE jest przypadkowa.
  //
  // 1. Członek organizacji ląduje w panelu — także wtedy, gdy jest
  //    superadminem: pracuje wtedy jako członek, a do /admin ma link na
  //    stronie głównej.
  // 2. Superadmin BEZ organizacji idzie prosto do /admin/tenants. Bez tego
  //    trafiał na „Załóż organizację" (bo warunek patrzył wyłącznie na
  //    tenant_id) — czyli founder po zalogowaniu dostawał ekran zakładania
  //    firmy zamiast panelu, który jest jedynym powodem, dla którego się
  //    loguje. Na aal1 guard /admin przechwyci go i przeprowadzi przez
  //    wyzwanie MFA: logowanie → MFA → /admin/tenants.
  // 3. Reszta (user bez organizacji) — zakładanie organizacji, jak dotąd.
  //
  // Przekierowanie widzi WYŁĄCZNIE sesja z claimem superadmin, więc
  // maskowanie /admin (404 dla reszty, lib/superadmin.ts) zostaje nietknięte.
  if (ctx?.tenantId) redirect(await localePath("/"));
  if (ctx?.superadmin) redirect(await localePath(SUPERADMIN_HOME));
  redirect(await localePath("/organizacja/nowa"));
}
