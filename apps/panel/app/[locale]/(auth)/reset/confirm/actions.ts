"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { DEFAULT_LOCALE, emailAvailability, isLocale, resendTransport } from "@avably/core";
import { clientIpFromHeaders } from "@avably/security/client-ip";
import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";

import { authErrorKey, logAuthProviderError } from "@/app/[locale]/(auth)/auth-error";
import { getAuthContext, hasRecentRecoveryProof } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { sendPasswordChangedEmail } from "@/lib/password-changed-email";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resetConfirmSchema } from "@/lib/validation";

export interface ResetConfirmState {
  error?: string;
}

/**
 * Odmowa JEDNOLITA dla „brak sesji" i „sesja bez dowodu recovery" (R14/M-01).
 * Rozróżnienie zdradzałoby napastnikowi z przejętą sesją, że jego sesja jest
 * ważna, tylko bramka inna — a legalnemu użytkownikowi w OBU przypadkach
 * pomaga dokładnie to samo: świeży link z e-maila. Wzorzec komunikatu
 * jednolitego jak przy limitach tras auth (aneks ADR-106).
 */
const RECOVERY_REQUIRED_ERROR =
  "Sesja resetu wygasła lub link jest nieprawidłowy. Poproś o nowy link.";

export async function resetConfirmAction(
  _prevState: ResetConfirmState,
  formData: FormData,
): Promise<ResetConfirmState> {
  const parsed = resetConfirmSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  // Ostatnia trasa auth bez dławienia — L2 (ADR-106) objął login/register/reset
  // request, ale nie ustawienie nowego hasła. Limit stoi PRZED dostawcą, także
  // przed odczytem sesji: to właśnie ta runda jest kosztem, który trzeba dławić.
  //
  // Sesja recovery bramkuje, KTO tu wejdzie — nie ILE razy. Z ważnym linkiem
  // odpowiedzi dostawcy są wyrocznią: `same_password` potwierdza trafienie w
  // AKTUALNE hasło konta, `weak_password` obrysowuje politykę. Limit sprowadza
  // to do kilku prób na godzinę. Bez sesji trasa i tak kosztuje rundę do
  // dostawcy na każde żądanie, a nieodciętą można powtarzać w nieskończoność.
  //
  // JEDEN wymiar (IP), bez kontowego: tożsamość konta niesie dopiero sesja,
  // czyli wywołanie, które limit ma osłaniać — wymiar per konto wymagałby
  // odwrócenia tej kolejności. Klucz z zaufanego źródła (`x-real-ip` platformy
  // / ostatni hop XFF), próg godzinny jak w reset request. Komunikat JEDNOLITY
  // z pozostałymi trasami — nie zdradza, czy link/sesja w ogóle były ważne.
  //
  // CAPTCHA świadomie NIE — uzasadnienie w aneksie ADR-106.
  const ip = clientIpFromHeaders(await headers());
  const rateLimit = await checkRateLimit(`reset-confirm:ip:${ip}`, {
    limit: 5,
    windowSeconds: 3600,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!rateLimit.success) {
    const t = await getTranslations("authError");
    return { error: t("tooManyRequests") };
  }

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) {
    return { error: RECOVERY_REQUIRED_ERROR };
  }

  // BRAMKA RECOVERY (R14/M-01, ADR-122): samo „jest ważna sesja" nie
  // wystarcza — napastnik z przejętą sesją zmieniłby hasło i utrwalił
  // przejęcie. Dowodem jest claim `amr` ze ZWERYFIKOWANEGO JWT (getClaims):
  // sesję musiał ustanowić świeży, jednorazowy token z e-maila (verifyOtp
  // w /auth/confirm), czego nie da się podrobić nagłówkiem, parametrem ani
  // spreparowanym stanem aplikacyjnym — claim wystawia i podpisuje dostawca.
  if (!hasRecentRecoveryProof(ctx.amr)) {
    return { error: RECOVERY_REQUIRED_ERROR };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    // Jak w rejestracji (ADR-051): surowa treść do logu, na ekran nasz tekst.
    // Tu najczęściej `weak_password` (polityka hasła po stronie dostawcy jest
    // ostrzejsza niż nasz schemat) i `same_password`.
    logAuthProviderError("reset-confirm", error);
    const t = await getTranslations("authError");
    return { error: t(authErrorKey(error)) };
  }

  // PO UDANEJ ZMIANIE (R14/M-01): pozostałe sesje tracą ważność. GoTrue
  // v2.192.0 unieważnia ich refresh tokeny już przy updateUser (zmierzone,
  // ADR-122) — jawny signOut(others) usuwa też same sesje i nie wisi na
  // nieudokumentowanym zachowaniu wersji dostawcy. Bieżąca sesja zostaje
  // (scope "others"): użytkownik idzie na /login i loguje się nowym hasłem.
  // Awaria tego wywołania nie cofa zmiany hasła — logujemy i idziemy dalej,
  // refresh tokeny pozostałych sesji są już martwe po stronie dostawcy.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
  if (signOutError) {
    console.warn(
      `[reset-confirm] nie udało się unieważnić pozostałych sesji: ${signOutError.message}. ` +
        "Refresh tokeny pozostałych sesji unieważnił już dostawca przy zmianie hasła.",
    );
  }

  // Powiadomienie o zmianie hasła — jedyny sygnał przejęcia dla właściciela
  // konta, gdy hasło zmienił ktoś inny. Awaria poczty nie przerywa przepływu
  // (hasło JUŻ zmienione), ale powód zostaje w logu — nigdy cichy sukces.
  if (ctx.user.email) {
    const requestLocale = await getLocale();
    const reason = await sendPasswordChangedEmail({
      to: ctx.user.email,
      locale: isLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE,
      availability: emailAvailability(),
      transport: resendTransport(),
    });
    if (reason) {
      console.warn(`[reset-confirm] powiadomienie o zmianie hasła nie wyszło: ${reason}`);
    }
  }

  redirect(await localePath("/login", { reset: "ok" }));
}
