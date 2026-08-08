"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { clientIpFromHeaders } from "@avably/security/client-ip";
import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";
import { verifyTurnstile } from "@avably/security/turnstile";

import { getAuthContext } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { SUPERADMIN_HOME } from "@/lib/superadmin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
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

  // IP z zaufanego źródła (x-real-ip platformy / ostatni hop XFF) — goły
  // x-forwarded-for był podrabialny nagłówkiem klienta (L2, ADR-106).
  // Drugi wymiar: znormalizowany e-mail (loginSchema robi trim+lowercase),
  // żeby atak rozproszony po wielu IP nie dostawał świeżego licznika na konto.
  // Progi: ADR-106. Komunikat JEDNOLITY dla obu wymiarów — odpowiedź nie może
  // zdradzać, który limit strzelił (enumeracja kont).
  const ip = clientIpFromHeaders(await headers());
  const rateLimitIp = await checkRateLimit(`login:ip:${ip}`, {
    limit: 10,
    windowSeconds: 60,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  const rateLimitEmail = await checkRateLimit(`login:email:${parsed.data.email}`, {
    limit: 5,
    windowSeconds: 60,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!rateLimitIp.success || !rateLimitEmail.success) {
    const t = await getTranslations("authError");
    return { error: t("tooManyRequests") };
  }

  // FAIL-OPEN przy AWARII dostawcy CAPTCHA (providerError) — świadoma
  // decyzja ADR-106 tylko dla logowania: awaria Cloudflare nie może odcinać
  // operatorów od ich firm, a rate-limit powyżej dalej stoi. Odmowa
  // weryfikacji (zły/zużyty token przy sprawnym dostawcy) blokuje normalnie.
  // Register/reset zostają fail-closed.
  const turnstile = await verifyTurnstile(parsed.data.turnstileToken);
  if (!turnstile.ok && !turnstile.providerError) {
    const t = await getTranslations("login");
    return { error: t("captchaFailed") };
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
