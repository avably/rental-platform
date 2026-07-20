/**
 * Send Email Hook Supabase Auth — e-maile KONT na naszych szablonach (ADR-048).
 *
 * PROBLEM, KTÓRY TO ZAMYKA. Bez hooka (albo custom SMTP) Supabase wysyła konta
 * WBUDOWANYM mailerem: wiadomość ze stopką dostawcy infrastruktury, limit
 * 2 wiadomości na godzinę i — co przesądza — odmowa dostarczania na adresy
 * spoza zespołu projektu. Czyli bez tego endpointu żaden realny klient nie
 * zakłada konta. To bloker onboardingu, nie kosmetyka.
 *
 * ŹRÓDŁO KONTRAKTU (sprawdzone w dokumentacji przed implementacją):
 * https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
 *  - ciało żądania: `{ user, email_data }`, gdzie `email_data` niesie `token`,
 *    `token_hash`, `redirect_to`, `email_action_type`, `site_url` oraz
 *    `token_new`/`token_hash_new` przy zmianie adresu,
 *  - `email_action_type` przyjmuje m.in. `signup`, `invite`, `magiclink`,
 *    `recovery`, `email_change`, `email`, `reauthentication` i rodzinę
 *    `*_notification`,
 *  - odpowiedź: puste ciało ze statusem 200 = sukces; błąd zwraca się jako
 *    `{ error: { http_code, message } }` z kodem 4xx/5xx.
 * Podpis: schemat Standard Webhooks — patrz lib/standard-webhook.ts.
 *
 * LINK BUDUJEMY NA NASZ CALLBACK, NIE NA GOTRUE. Dokumentacja pokazuje wariant
 * `.../auth/v1/verify?token=<token_hash>&type=...`, ale panel ma własny
 * callback `/auth/confirm` (route.ts) i to on ustanawia sesję cookies oraz
 * konsumuje `next` z rejestracji (np. `/zaproszenie/<token>`). Kształt linku
 * jest DOKŁADNIE taki, jaki od zawsze składały lokalne szablony GoTrue
 * (packages/db/supabase/templates/{confirmation,recovery}.html):
 * `<baza>/auth/confirm?token_hash=<hash>&type=<typ OTP>`. Wejście na
 * `/auth/v1/verify` przeszłoby OBOK tego przepływu i zgubiło `next`.
 * Samą BAZĘ bierzemy z naszej konfiguracji, nie z payloadu — dlaczego, mówi
 * komentarz nad `callbackBaseUrl` (ADR-050).
 *
 * ZERO ZAPISU DO email_logs I TO JEST DECYZJA (ADR-048). Tamta tabela jest
 * per-tenant (`tenant_id NOT NULL` + RLS), a potwierdzenie rejestracji
 * przychodzi ZANIM użytkownik ma jakąkolwiek organizację — wiersz musiałby
 * stanąć poza modelem izolacji. Poza tym historia wysyłek to widok NAJEMCY
 * („czy mój klient dostał wiadomość"), a to jest korespondencja PLATFORMY
 * z użytkownikiem. Brak platformowego dziennika jest odnotowany jako dług.
 */
import {
  DEFAULT_LOCALE,
  PANEL_URL,
  isLocale,
  platformFromAddress,
  PRODUCT_NAME,
  resendTransport,
  type EmailTransport,
  type Locale,
  type OutgoingEmail,
} from "@avably/core";
import { emailMessages, renderEmailConfirmation, renderPasswordReset } from "@avably/emails";
import { z } from "zod";

import { verifyStandardWebhook } from "@/lib/standard-webhook";

/** Nazwa zmiennej środowiskowej z sekretem hooka (sensitive, tylko server-side). */
export const HOOK_SECRET_ENV = "SUPABASE_EMAIL_HOOK_SECRET";

/**
 * Kształt ciała żądania. Celowo LUŹNY tam, gdzie nas nie dotyczy: Supabase
 * dokłada do payloadu pola (identities, factor_type, notyfikacje) i walidacja
 * „dokładnie te klucze" psułaby się przy każdej ich zmianie. Twarde są tylko
 * pola, na których stoi wysyłka.
 */
const hookPayloadSchema = z.object({
  user: z.object({
    email: z.string().min(3).max(320),
    user_metadata: z.record(z.unknown()).optional(),
  }),
  email_data: z.object({
    token_hash: z.string().min(1),
    email_action_type: z.string().min(1),
    redirect_to: z.string().optional(),
    // Czytane WYŁĄCZNIE do wykrycia złej konfiguracji dashboardu; baza linku
    // nie pochodzi z tego pola (ADR-050, `warnOnSiteUrlMismatch`).
    site_url: z.string().optional(),
  }),
});

export type HookPayload = z.infer<typeof hookPayloadSchema>;

/**
 * Rodzaje akcji, dla których MAMY szablon (8a). `otpType` to wartość parametru
 * `type` w linku — ta sama, którą `/auth/confirm` podaje do `verifyOtp`.
 *
 * Ta mapa jest JEDYNYM miejscem rozszerzania obsługi. Włączenie w Supabase
 * magic linku, zaproszeń GoTrue, zmiany adresu albo powiadomień wymaga
 * dopisania tu wpisu ORAZ szablonu — do tego czasu taki typ jest ODRZUCANY
 * (patrz niżej), a nie wysyłany „czymkolwiek".
 */
const SUPPORTED_ACTIONS = {
  signup: { template: "confirmation", otpType: "email" },
  recovery: { template: "reset", otpType: "recovery" },
} as const satisfies Record<string, { template: "confirmation" | "reset"; otpType: string }>;

export type SupportedAction = keyof typeof SUPPORTED_ACTIONS;

export function isSupportedAction(value: string): value is SupportedAction {
  return Object.hasOwn(SUPPORTED_ACTIONS, value);
}

/**
 * Język wiadomości.
 *
 * ŹRÓDŁEM NIE MOŻE BYĆ `tenants.locale`: potwierdzenie rejestracji leci ZANIM
 * użytkownik ma organizację, więc w chwili tej wysyłki tenant zwyczajnie nie
 * istnieje. Nie może nim być też ścieżka `redirect_to` — panel nie przekazuje
 * `emailRedirectTo`, więc GoTrue wstawia tam goły Site URL bez prefiksu locale.
 *
 * Zostaje `user_metadata.locale`, zapisywane przy rejestracji (registerAction
 * przekazuje język ekranu do `signUp`). Wartość pochodzi od użytkownika, więc
 * jest WALIDOWANA — obca wartość spada na domyślne locale PLATFORMY (EN, nie
 * PL: to korespondencja platformy z użytkownikiem, a nie storefront najemcy,
 * gdzie domyślną osią jest DEFAULT_TENANT_LOCALE).
 *
 * Konta założone przed tą zmianą nie mają metadanej i dostają domyślne locale
 * — świadomy, cichy fallback dotyczący wyłącznie języka, nie dostarczenia.
 */
export function accountEmailLocale(metadata: Record<string, unknown> | undefined): Locale {
  const raw = metadata?.["locale"];
  return typeof raw === "string" && isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/** Baza linku poza produkcją. Dev i testy muszą trafiać we własny serwer. */
const LOCAL_CALLBACK_BASE = "http://127.0.0.1:3000";

/**
 * Baza linku potwierdzającego pochodzi WYŁĄCZNIE z naszej konfiguracji:
 * `PANEL_URL` na produkcji, localhost poza nią. Payload jej nie dotyka.
 *
 * WCZEŚNIEJ BRALIŚMY TU `email_data.site_url` I TO ZABLOKOWAŁO ONBOARDING.
 * Poprzedni komentarz twierdził, że „payload nie może nam podstawić dowolnego
 * hosta" — nieprawda: walidacja sprawdzała sam protokół, więc każdy host
 * http(s) przechodził. Site URL w dashboardzie Supabase wskazywał na host
 * projektu Supabase, więc wiadomość dotarła, wyglądała poprawnie, a link
 * prowadził w API dostawcy („No API key found in request"). Objaw był NIEMY:
 * hook zwracał 200, transport potwierdzał wysyłkę, nic w panelu ani w logach
 * nie krzyczało — jedyną informacją była skarga użytkownika.
 *
 * Host linku to nasza tożsamość produktu (brand.ts), nie parametr żądania.
 * Wartość z payloadu nadal CZYTAMY, ale wyłącznie po to, by wykryć rozjazd
 * konfiguracji — patrz `warnOnSiteUrlMismatch`.
 */
export function callbackBaseUrl(): string {
  return process.env.NODE_ENV === "production" ? PANEL_URL : LOCAL_CALLBACK_BASE;
}

/** Czy ślad obserwacyjny poszedł już w tym procesie — patrz `logPayloadOriginsOnce`. */
let loggedPayloadOrigins = false;

/** Wyłącznie dla testów: zeruje licznik śladu jednorazowego. */
export function resetPayloadOriginsLog(): void {
  loggedPayloadOrigins = false;
}

/**
 * JEDNORAZOWY (per proces) ślad z faktyczną zawartością `site_url` i
 * `redirect_to`. Nie służy naprawie — ta stoi na `PANEL_URL` — tylko zamyka
 * pytanie, CZYM te pola naprawdę są.
 *
 * Pytanie było otwarte, bo poprzedni komentarz odpowiadał na nie błędnie
 * („dokładnie to, co GoTrue wstawiał pod `{{ .SiteURL }}`"), a produkcja go
 * zdementowała: Site URL w dashboardzie wskazywał `https://app.avably.io`,
 * a link wyszedł na host projektu Supabase. Skoro payload nie niesie tego,
 * co dashboard, następna osoba nie ma tego odkrywać po raz drugi — ma
 * przeczytać log i kartę modułu w dokumentacji.
 *
 * Raz na proces, nie na żądanie: to obserwacja, nie alarm (wzorzec
 * `warnedDevSkip` z packages/security/src/turnstile.ts). Na serverless każdy
 * zimny start daje świeży ślad, więc wartość nie ucieka.
 *
 * ŻADNYCH TOKENÓW ANI ADRESU UŻYTKOWNIKA — pytanie dotyczy hostów, a token
 * z logu pozwoliłby przejąć potwierdzaną sesję każdemu, kto ma wgląd w logi.
 */
export function logPayloadOriginsOnce(emailData: {
  site_url?: string | undefined;
  redirect_to?: string | undefined;
  email_action_type: string;
}): void {
  if (loggedPayloadOrigins) return;
  loggedPayloadOrigins = true;

  console.info(
    "[account-email-hook] obserwacja payloadu (bez tokenów): " +
      `email_action_type=${JSON.stringify(emailData.email_action_type)} ` +
      `email_data.site_url=${JSON.stringify(emailData.site_url ?? null)} ` +
      `email_data.redirect_to=${JSON.stringify(emailData.redirect_to ?? null)}`,
  );
}

/** Znormalizowany origin albo `undefined`, gdy wartość nie jest adresem http(s). */
function httpOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Rozjazd `site_url` z bazą, której faktycznie używamy = ZŁA KONFIGURACJA
 * Supabase Auth. Zostawiamy ślad server-side, ale NIE przerywamy wysyłki:
 * literówka w dashboardzie nie może wywracać rejestracji, skoro link i tak
 * składamy z poprawnego hosta. Cisza była tu gorsza od wszystkiego — to
 * właśnie brak jakiegokolwiek sygnału przedłużył blokadę onboardingu.
 *
 * ŚWIADOMIE NIE LOGUJEMY `token` ANI `token_hash`. Log wystarczy do naprawy
 * konfiguracji (nazwa pola + host oczekiwany i otrzymany), a token z takiego
 * wpisu pozwoliłby przejąć potwierdzaną sesję każdemu, kto ma dostęp do logów.
 *
 * Porównujemy ORIGINY, nie stringi: końcowy `/` w dashboardzie to nie rozjazd.
 * Wartość nieparsowalna idzie do logu przez `JSON.stringify` — inaczej znak
 * nowej linii w konfiguracji podrobiłby kolejny wpis w logu.
 */
export function warnOnSiteUrlMismatch(siteUrl: string | undefined, baseUrl: string): void {
  // Brak pola nic nie mówi o dashboardzie — nie ma czego porównywać.
  if (!siteUrl) return;

  const received = httpOrigin(siteUrl);
  if (received === baseUrl) return;

  console.warn(
    `[account-email-hook] email_data.site_url z payloadu (${received ?? JSON.stringify(siteUrl)}) ` +
      `nie zgadza się z bazą linku, której używamy (${baseUrl}). ` +
      "Popraw Site URL w konfiguracji Supabase Auth — wiadomość poszła z poprawnym hostem.",
  );
}

export function buildActionUrl(input: {
  action: SupportedAction;
  tokenHash: string;
  baseUrl: string;
}): string {
  const url = new URL("/auth/confirm", input.baseUrl);
  url.searchParams.set("token_hash", input.tokenHash);
  url.searchParams.set("type", SUPPORTED_ACTIONS[input.action].otpType);
  return url.toString();
}

/**
 * Złożenie wiadomości. Nadawca = nazwa PLATFORMY + adres platformy: to
 * korespondencja Avably z użytkownikiem, żaden tenant tu nie występuje
 * (inaczej niż w zaproszeniach, gdzie From niesie `tenants.name` — ADR-036 D2).
 */
export async function buildAccountEmail(payload: HookPayload): Promise<OutgoingEmail> {
  const action = payload.email_data.email_action_type;
  if (!isSupportedAction(action)) {
    throw new Error(`Nieobsługiwany typ akcji: ${action}`);
  }

  const locale = accountEmailLocale(payload.user.user_metadata);
  // Jedna baza policzona RAZ: ta sama wartość idzie do porównania i do linku,
  // więc log nie może twierdzić czegoś innego, niż dostał użytkownik.
  const baseUrl = callbackBaseUrl();
  warnOnSiteUrlMismatch(payload.email_data.site_url, baseUrl);
  const actionUrl = buildActionUrl({
    action,
    tokenHash: payload.email_data.token_hash,
    baseUrl,
  });
  const messages = emailMessages(locale);

  const { html, text, subject } =
    SUPPORTED_ACTIONS[action].template === "confirmation"
      ? {
          ...(await renderEmailConfirmation({ confirmationUrl: actionUrl, locale })),
          subject: messages.emailConfirmation.heading,
        }
      : {
          ...(await renderPasswordReset({ resetUrl: actionUrl, locale })),
          subject: messages.passwordReset.heading,
        };

  return {
    from: platformFromAddress(PRODUCT_NAME),
    to: payload.user.email,
    subject,
    html,
    text,
  };
}

export interface HookDependencies {
  /** Sekret hooka; domyślnie z env. Jawne `undefined` = brak konfiguracji. */
  secret?: string | undefined;
  /** Transport; domyślnie Resend z @avably/core. */
  transport?: EmailTransport;
  /** Czas do kontroli znacznika (test). */
  now?: Date;
}

function errorResponse(status: number, message: string): Response {
  // Kształt ciała z dokumentacji hooka — GoTrue pokazuje `message` w logach
  // Auth, więc powód odmowy jest do odczytania bez zgadywania.
  return Response.json({ error: { http_code: status, message } }, { status });
}

/**
 * Rdzeń hooka wydzielony z `route.ts`, żeby test wołał go z WSTRZYKNIĘTYM
 * transportem i sekretem — bez sieci, bez żywego Supabase (wzorzec `runProxy`).
 */
export async function handleSendEmailHook(
  request: Request,
  deps: HookDependencies = {},
): Promise<Response> {
  // Surowe ciało: podpis liczony jest z BAJTÓW, więc parsowanie JSON-a musi
  // nastąpić dopiero po weryfikacji, na tym samym stringu.
  const raw = await request.text();

  const secret = "secret" in deps ? deps.secret : process.env[HOOK_SECRET_ENV];
  const verification = verifyStandardWebhook({
    secret,
    headers: request.headers,
    payload: raw,
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (!verification.ok) {
    // Brak konfiguracji to błąd PO NASZEJ stronie (500), zły podpis to odmowa
    // (401). W obu przypadkach NIE DOCHODZI DO WYSYŁKI — to jest tu istotą.
    const status = verification.reason === "secret_not_configured" ? 500 : 401;
    return errorResponse(status, verification.message);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return errorResponse(400, "Ciało żądania nie jest poprawnym JSON-em.");
  }

  const parsed = hookPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return errorResponse(400, "Ciało żądania nie pasuje do kontraktu Send Email Hook.");
  }

  // Przed bramką typu akcji: pytanie „co naprawdę jest w tych polach" dotyczy
  // KAŻDEGO payloadu, także takiego, którego nie obsłużymy.
  logPayloadOriginsOnce(parsed.data.email_data);

  const action = parsed.data.email_data.email_action_type;
  if (!isSupportedAction(action)) {
    // ODMOWA, NIE CICHY SUKCES ANI WYSYŁKA GENERYCZNA. Wysłanie „potwierdź
    // adres" w odpowiedzi na prośbę o magic link dałoby użytkownikowi link,
    // który nie robi tego, po co przyszedł, a przy zmianie adresu — link
    // zbudowany ze złego tokenu z pary (dokumentacja hooka opisuje tam
    // ODWRÓCONE parowanie token/token_hash). Lepszy jest głośny błąd w logach
    // Auth niż wiadomość, która wygląda dobrze i nie działa.
    return errorResponse(
      422,
      `Typ akcji „${action}" nie ma szablonu w tej instalacji — wiadomość nie została wysłana.`,
    );
  }

  let email: OutgoingEmail;
  try {
    email = await buildAccountEmail(parsed.data);
  } catch (err) {
    return errorResponse(
      500,
      `Nie udało się złożyć wiadomości: ${err instanceof Error ? err.message : "nieznany błąd"}`,
    );
  }

  const transport = deps.transport ?? resendTransport();
  try {
    await transport.send(email);
  } catch (err) {
    // BRAK RESEND_API_KEY ALBO ODMOWA DOSTAWCY = BŁĄD, NIGDY 200 (ADR-033).
    // Gdyby tu poszła dwusetka, Supabase uznałby wiadomość za dostarczoną,
    // użytkownik nie dostałby nic i nikt by się o tym nie dowiedział.
    return errorResponse(
      500,
      `Wysyłka nie powiodła się: ${err instanceof Error ? err.message : "nieznany błąd"}`,
    );
  }

  // Dokumentacja: puste ciało + 200 = sukces.
  return Response.json({}, { status: 200 });
}
