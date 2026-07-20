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
 * `{SiteURL}/auth/confirm?token_hash=<hash>&type=<typ OTP>`. Wejście na
 * `/auth/v1/verify` przeszłoby OBOK tego przepływu i zgubiło `next`.
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

/**
 * Baza linku = `site_url` z payloadu, czyli dokładnie to, co GoTrue wstawiał
 * w szablonach pod `{{ .SiteURL }}`. Wartość spoza http(s) jest ignorowana
 * (payload nie może nam podstawić dowolnego hosta w linku), a fallback
 * rozstrzyga się jawnie: adres panelu na produkcji, localhost poza nią.
 */
export function callbackBaseUrl(siteUrl: string | undefined): string {
  if (siteUrl) {
    try {
      const parsed = new URL(siteUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      // Nieparsowalna wartość → fallback niżej.
    }
  }
  return process.env.NODE_ENV === "production" ? PANEL_URL : "http://127.0.0.1:3000";
}

export function buildActionUrl(input: {
  action: SupportedAction;
  tokenHash: string;
  siteUrl: string | undefined;
}): string {
  const url = new URL("/auth/confirm", callbackBaseUrl(input.siteUrl));
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
  const actionUrl = buildActionUrl({
    action,
    tokenHash: payload.email_data.token_hash,
    siteUrl: payload.email_data.site_url,
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
