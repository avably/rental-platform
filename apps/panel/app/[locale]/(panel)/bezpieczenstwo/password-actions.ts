"use server";

/**
 * Konto operatora: ZMIANA HASŁA ZE ZNAJOMOŚCI HASŁA oraz wylogowanie
 * pozostałych urządzeń (U11a, ADR-144).
 *
 * Do tej pory jedyną drogą do zmiany hasła było wylogowanie się i „Nie
 * pamiętam hasła" — czyli operator, który hasło ZNA, musiał mieć dostęp do
 * skrzynki, żeby je zmienić. Ta akcja domyka lukę zapowiedzianą wprost
 * w ADR-122 D5: „przyszły ekran MUSI wymagać aktualnego hasła
 * (reauth signInWithPassword po stronie serwera) albo świeżego MFA".
 *
 * CZEGO TU CELOWO NIE MA — `supabase.auth.reauthenticate()`. Nazwa myli: to
 * nie jest sprawdzenie hasła, tylko WYSYŁKA jednorazowego kodu na e-mail/SMS.
 * Bramka zbudowana na niej wymagałaby dostępu do skrzynki — dokładnie tego,
 * od czego ten ekran ucieka.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";

import { DEFAULT_LOCALE, emailAvailability, isLocale, resendTransport } from "@avably/core";
import { createServerClient } from "@avably/db";
import { clientIpFromHeaders } from "@avably/security/client-ip";
import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";

import { authErrorKey, logAuthProviderError } from "@/app/[locale]/(auth)/auth-error";
import { getAuthContext } from "@/lib/auth";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { localePath } from "@/lib/navigation";
import { sendPasswordChangedEmail } from "@/lib/password-changed-email";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { passwordSchema } from "@/lib/validation";

/**
 * OBECNE hasło sprawdza WYŁĄCZNIE dostawca — schemat pilnuje tylko tego, że
 * pole nie jest puste.
 *
 * `min(1)`, a nie `passwordSchema`, jest tu decyzją bezpieczeństwa, nie
 * niedbałością: gdyby zgadywane hasło odpadało lokalnie na długości, próba
 * krótka wracałaby NATYCHMIAST i z innym komunikatem niż próba długa, czyli
 * formularz stałby się wyrocznią o długości hasła konta (i mierzalną
 * różnicą czasu — lokalny odrzut vs runda do GoTrue). Każde niepuste
 * zgadnięcie ma kosztować tyle samo.
 */
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Podaj obecne hasło."),
    password: passwordSchema,
    passwordConfirm: z.string().min(1, "Powtórz nowe hasło."),
  })
  .refine((value) => value.password === value.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Hasła muszą być identyczne.",
  });

/** Klient BEZ zapisu cookies — służy wyłącznie do sprawdzenia hasła. */
function createReauthClient() {
  return createServerClient({ getAll: () => [], setAll: () => {} });
}

/**
 * Powiadomienie o zmianie hasła (ADR-122 D3) — jedyny sygnał przejęcia dla
 * właściciela konta, gdy hasło zmienił ktoś inny. NIE RZUCA: hasło jest już
 * zmienione, awaria poczty nie może tego cofnąć ani przerwać.
 */
async function notifyPasswordChanged(email: string | null): Promise<void> {
  if (!email) return;
  const requestLocale = await getLocale();
  const reason = await sendPasswordChangedEmail({
    to: email,
    locale: isLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE,
    availability: emailAvailability(),
    transport: resendTransport(),
  });
  if (reason) {
    console.warn(`[password-change] powiadomienie o zmianie hasła nie wyszło: ${reason}`);
  }
}

/**
 * Zmiana hasła operatora.
 *
 * KOLEJNOŚĆ NIE JEST PRZYPADKOWA:
 *
 *  1. Walidacja kształtu (nowe hasło + powtórzenie) — bez dotykania dostawcy.
 *  2. Limit per IP — PRZED odczytem sesji, bo to jedyny limit, który stoi
 *     przed jakąkolwiek rundą do dostawcy.
 *  3. Sesja (tożsamość konta niesie dopiero ona).
 *  4. Limit per UŻYTKOWNIK — zgadywanie rozproszone po wielu adresach IP
 *     dostawałoby inaczej świeży licznik na każde IP. Dwa wymiary, jeden
 *     komunikat: odpowiedź nie może zdradzać, który z nich strzelił.
 *  5. BRAMKA: znajomość obecnego hasła, sprawdzana przez `signInWithPassword`
 *     na kliencie BEZ cookies (patrz `createReauthClient`) — sesja
 *     przeglądarki nie może zostać podmieniona przez nieudaną próbę.
 *  6. Zmiana hasła NA ŚWIEŻO USTANOWIONEJ SESJI, nie na sesji z cookies.
 *     To wymóg dostawcy, nie ozdoba: przy `secure_password_change = true`
 *     (ADR-122 D4) GoTrue żąda nonce'u reauthentication dla sesji STARSZEJ
 *     NIŻ 24 h, więc zmiana wykonana na sesji panelu odmawiałaby operatorowi,
 *     który po prostu długo jest zalogowany — losowo, zależnie od tego, kiedy
 *     się logował. Sesja sprzed sekundy przechodzi zawsze.
 *  7. GoTrue przy zmianie hasła wylogowuje WSZYSTKIE sesje użytkownika poza
 *     tą, która zmianę wykonała — czyli poza świeżą. Sesja panelu operatora
 *     jest w tym momencie martwa, więc PRZEJMUJEMY świeżą do cookies
 *     (`setSession`). Bez tego kroku operator zostałby po cichu wylogowany
 *     w trakcie pracy, przy najbliższym odświeżeniu tokenu.
 *
 * Operacja żyje w całości w GoTrue — ŻADNEJ migracji ani zapisu w naszej bazie.
 */
export async function changePasswordAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });
  if (!parsed.success) return zodErrorToState(parsed.error);

  const ip = clientIpFromHeaders(await headers());
  const ipLimit = await checkRateLimit(`password-change:ip:${ip}`, {
    limit: 10,
    windowSeconds: 3600,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!ipLimit.success) {
    const tAuth = await getTranslations("authError");
    return { formError: tAuth("tooManyRequests") };
  }

  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));

  const userLimit = await checkRateLimit(`password-change:user:${ctx.user.id}`, {
    limit: 5,
    windowSeconds: 3600,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!userLimit.success) {
    const tAuth = await getTranslations("authError");
    return { formError: tAuth("tooManyRequests") };
  }

  const t = await getTranslations("security");

  // Konto bez adresu e-mail nie ma czym się uwierzytelnić hasłem — odmowa
  // JEDNOLITA, taka sama jak przy złym haśle (nie ma powodu, by formularz
  // rozróżniał dla napastnika te dwa przypadki).
  if (!ctx.user.email) return { formError: t("passwordDenied") };

  const reauth = createReauthClient();
  const { data: verified, error: verifyError } = await reauth.auth.signInWithPassword({
    email: ctx.user.email,
    password: parsed.data.currentPassword,
  });
  // ODMOWA JEDNOLITA (wzorzec ADR-122 D2): złe hasło, hasło o innej długości
  // i hasło różniące się jednym znakiem dostają IDENTYCZNY komunikat. Każde
  // rozróżnienie jest tu wyrocznią, a legalnemu operatorowi w każdym z tych
  // przypadków pomaga dokładnie to samo — wpisać hasło jeszcze raz.
  if (verifyError || !verified?.session) {
    if (verifyError) logAuthProviderError("password-change:reauth", verifyError);
    return { formError: t("passwordDenied") };
  }

  const { error: updateError } = await reauth.auth.updateUser({ password: parsed.data.password });
  if (updateError) {
    // Jak w rejestracji (ADR-051): surowa treść dostawcy do logu, na ekran
    // nasz tekst. Tu najczęściej `weak_password` (polityka dostawcy bywa
    // ostrzejsza niż nasz schemat) i `same_password` — oba dotyczą pola
    // NOWEGO hasła, więc siadają przy nim, a nie nad formularzem.
    logAuthProviderError("password-change", updateError);
    // Świeża sesja nie ma po co żyć dalej — hasło się nie zmieniło.
    await reauth.auth.signOut({ scope: "local" });
    const tAuth = await getTranslations("authError");
    const key = authErrorKey(updateError);
    const message = tAuth(key);
    return key === "weakPassword" || key === "samePassword"
      ? { fieldErrors: { password: message } }
      : { formError: message };
  }

  // JAWNE unieważnienie pozostałych sesji (ADR-122 D3). GoTrue robi to sam
  // przy zmianie hasła — wylogowuje wszystkie sesje użytkownika poza tą, która
  // zmianę wykonała — ale to zachowanie KONKRETNEJ WERSJI dostawcy, a nie
  // jego kontrakt. Jawne wywołanie zdejmuje gwarancję z nieudokumentowanego
  // zachowania i nic nie kosztuje, gdy dostawca zdążył pierwszy. Awaria NIE
  // cofa zmiany hasła: hasło jest już zmienione, więc powód idzie do logu.
  const { error: signOutError } = await reauth.auth.signOut({ scope: "others" });
  if (signOutError) {
    console.warn(
      `[password-change] nie udało się unieważnić pozostałych sesji: ${signOutError.message}. ` +
        "Refresh tokeny pozostałych sesji unieważnił już dostawca przy zmianie hasła.",
    );
  }

  const { error: adoptError } = await supabase.auth.setSession({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });

  await notifyPasswordChanged(ctx.user.email);

  if (adoptError) {
    // Hasło JEST zmienione, ale bieżącej sesji nie udało się odnowić —
    // stara została już unieważniona przez dostawcę. To ani sukces, ani
    // porażka operacji: komunikat neutralny mówi, co się stało i co zrobić.
    console.warn(`[password-change] nie udało się przejąć świeżej sesji: ${adoptError.message}`);
    return { notice: t("passwordChangedRelogin") };
  }

  return { success: t("passwordSuccess") };
}

/**
 * „Wyloguj mnie ze wszystkich urządzeń".
 *
 * `scope: "others"` — świadomie, nie `global`: operator klika to Z PANELU,
 * więc wyrzucenie go z bieżącej karty byłoby karą za skorzystanie z funkcji
 * bezpieczeństwa, a wylogowanie się TU umie i tak jednym kliknięciem w menu
 * konta. Ta sama decyzja i to samo uzasadnienie co po zmianie hasła
 * (ADR-122 D3).
 *
 * Operacja jest z konstrukcji ZAMKNIĘTA W KONCIE WOŁAJĄCEGO: idzie przez
 * klienta osadzonego w sesji z cookies żądania, więc dostawca unieważnia
 * wyłącznie sesje TEGO użytkownika. Żadnego klucza serwisowego ani admin API
 * — cudze sesje nie są tu w ogóle osiągalne.
 */
export async function signOutOtherDevicesAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login"));

  const limit = await checkRateLimit(`sign-out-others:user:${ctx.user.id}`, {
    limit: 10,
    windowSeconds: 3600,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!limit.success) {
    const tAuth = await getTranslations("authError");
    return { formError: tAuth("tooManyRequests") };
  }

  const t = await getTranslations("security");
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    logAuthProviderError("sign-out-others", error);
    return { formError: t("revokeError") };
  }

  return { success: t("revokeSuccess") };
}
