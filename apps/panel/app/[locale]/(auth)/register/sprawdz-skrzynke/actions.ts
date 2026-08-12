"use server";

/**
 * Ponowienie e-maila potwierdzającego adres (L4, ADR-105).
 *
 * Do L4 `register/sprawdz-skrzynke` była statycznym akapitem: rejestracja
 * wysyłała wiadomość dokładnie raz i kto jej nie dostał (literówka w filtrze,
 * wiadomość w spamie, kliknięcie po wygaśnięciu linku), ten kończył
 * w ślepym zaułku — konto istniało, potwierdzić go nie było jak.
 *
 * DWIE RZECZY, KTÓRE MUSZĄ TU BYĆ SPEŁNIONE JEDNOCZEŚNIE:
 *
 *  1. ZERO ENUMERACJI KONT. To trasa publiczna, bez sesji. Odpowiedź jest
 *     IDENTYCZNA dla adresu nieistniejącego, istniejącego niepotwierdzonego
 *     i już potwierdzonego — inaczej formularz zamienia się w wyrocznię
 *     „czy X ma u was konto". Dlatego wynik dostawcy nie steruje treścią
 *     odpowiedzi w ŻADNYM wariancie: błąd idzie do logu (ADR-051), a na ekran
 *     zawsze wraca to samo zdanie. Dotyczy to również limitu po stronie
 *     dostawcy, który GoTrue liczy PER ADRES — komunikat „poczekaj 60 s"
 *     zdradzałby, że pod tym adresem coś jest.
 *
 *  2. LIMIT WYSYŁKI. Bez niego jest to darmowa wyrzutnia wiadomości na dowolny
 *     adres. Limit jest po IP, bo żądanie jest nieuwierzytelnione i nie ma
 *     tenanta, którym można by je zważyć. Klucz po IP nie zdradza niczego
 *     o adresacie: odmowa zależy od tego, ile razy pytał TEN klient, a nie
 *     od tego, o kogo pytał.
 *
 * Turnstile celowo nie jest tu wpinany — konfiguracja anti-abuse na trasach
 * auth jest przedmiotem osobnego zadania (L2), a włączenie sekretu bez
 * wpiętego widżetu wywraca logowanie do panelu.
 */
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { clientIpFromHeaders } from "@avably/security/client-ip";
import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";

import { logAuthProviderError } from "@/app/[locale]/(auth)/auth-error";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resendConfirmationSchema } from "@/lib/validation";

export interface ResendConfirmationState {
  error?: string;
  success?: string;
}

export async function resendConfirmationAction(
  _prevState: ResendConfirmationState,
  formData: FormData,
): Promise<ResendConfirmationState> {
  const t = await getTranslations("checkInbox");

  const parsed = resendConfirmationSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    // Błąd FORMATU adresu jest bezpieczny do pokazania: mówi o tym, co
    // użytkownik wpisał, a nie o tym, co jest w bazie.
    return { error: parsed.error.issues[0]?.message ?? "Podaj poprawny adres e-mail." };
  }

  // IP z ZAUFANEGO źródła (`x-real-ip` platformy / OSTATNI hop XFF), nie
  // z gołego nagłówka. Goły `x-forwarded-for` jest deklaracją KLIENTA:
  // dopisanie sobie dowolnego prefiksu dawało świeży kubełek przy każdym
  // żądaniu, czyli limit istniał wyłącznie dla tych, którzy nie próbowali go
  // obejść. Ta akcja WYSYŁA POCZTĘ na dowolny adres, więc obejście limitu to
  // darmowa wyrzutnia wiadomości — jedyny taki endpoint w panelu (ADR-153).
  // Reszta tras auth (login/register/reset/reset-confirm) przeszła na
  // `clientIpFromHeaders` już w L2 (ADR-106); ta została pominięta.
  const ip = clientIpFromHeaders(await headers());
  const rateLimit = await checkRateLimit(`resend-confirmation:ip:${ip}`, {
    limit: 3,
    windowSeconds: 60,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!rateLimit.success) {
    return { error: t("resendThrottled") };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
  });
  if (error) {
    logAuthProviderError("resend-confirmation", error);
  }

  // Ta sama odpowiedź w każdym przypadku — patrz punkt 1 w nagłówku.
  return { success: t("resendDone") };
}
