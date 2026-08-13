"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { clientIpFromHeaders } from "@avably/security/client-ip";
import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";

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
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  // Docelowa ścieżka po zalogowaniu (np. /zaproszenie/<token> dla zaproszonego
  // bez konta). Sanityzowana przeciw open-redirect (patrz safeNextPath).
  const next = safeNextPath(formData.get("next"));

  // JEDYNA OBRONA TEJ ŚCIEŻKI PRZED ZGADYWANIEM HASEŁ (ADR-164). Odkąd
  // z logowania zszedł Turnstile, poniżej nie stoi już nic innego — i dlatego
  // ma własną, zachowaniową bramkę (test/login-rate-limit-obrona.test.ts),
  // która woła PRAWDZIWY licznik, a nie atrapę.
  //
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

  // TU NIE MA WERYFIKACJI CAPTCHY I NIE JEST TO PRZEOCZENIE (ADR-164).
  //
  // Do tej zmiany stało tu `verifyTurnstile` z gałęzią FAIL-OPEN na awarię
  // dostawcy (ADR-106): przy `providerError` żądanie szło dalej, żeby awaria
  // Cloudflare nie odcinała operatorów od ich firm. Bramka, która sama się
  // otwiera na żądanie atakującego (a zerwanie połączenia z dostawcą jest po
  // stronie klienta wykonalne), bramką nie jest — kosztowała za to każdego
  // logującego się człowieka wyzwanie i 72 px ekranu.
  //
  // Obroną tej ścieżki jest limit wyżej: 10/min na IP i 5/min na adres.
  // Register i reset zostają FAIL-CLOSED i widżet mają dalej — tam koszt
  // jednej próby jest po naszej stronie (mail, konto), a nie po stronie
  // pytającego.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    // JEDEN KOMUNIKAT NA WSZYSTKIE ODMOWY DOSTAWCY (ADR-153, N3) — bez
    // rozgałęzienia po `error.code`, celowo. `invalid_credentials` (zły adres
    // albo złe hasło) i `email_not_confirmed` MUSZĄ brzmieć identycznie:
    // osobny komunikat dla niepotwierdzonego adresu ujawniałby, że konto pod
    // tym adresem ISTNIEJE, a przy okazji — że podane hasło było POPRAWNE
    // (dostawca zwraca ten kod dopiero po sprawdzeniu hasła). To byłaby
    // wyrocznia enumeracji kont i weryfikacji haseł w jednym.
    //
    // Zmieniło się BRZMIENIE, nie klasyfikacja: „nieprawidłowy e-mail lub
    // hasło" było po prostu NIEPRAWDĄ dla człowieka z poprawnym hasłem
    // i niepotwierdzonym adresem. Nowy tekst nazywa oba przypadki, a drogę
    // wyjścia do obu dokłada formularz (ponowna wysyłka linku / reset hasła).
    const t = await getTranslations("login");
    return { error: t("signInFailed") };
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
