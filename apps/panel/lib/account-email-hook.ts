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
 * NAZWY DWÓCH PÓL PAYLOADU MYLĄ — ZAOBSERWOWANE NA PRODUKCJI (ADR-050):
 *   email_data.site_url    = "https://<ref>.supabase.co/auth/v1"  ← API GoTrue
 *   email_data.redirect_to = "https://app.avably.io"              ← Site URL
 * Czyli ODWROTNIE, niż sugerują nazwy: Site URL z dashboardu Supabase Auth
 * siedzi w `redirect_to` (GoTrue wstawia go tam, gdy `signUp` nie przekazuje
 * `emailRedirectTo` — a nasz nie przekazuje), a `site_url` to adres API
 * dostawcy i o naszej konfiguracji nie mówi NIC. Nie zgaduj z nazwy.
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
 * z użytkownikiem.
 *
 * ZAMIAST TEGO — OSOBNY, PLATFORMOWY DZIENNIK (ADR-054, migracja 0025). Każda
 * próba wysyłki na granicy transportu zostawia wiersz w public.account_email_logs:
 * typ akcji (signup/recovery), status (sent/failed), powód przy porażce, czas.
 * BEZ pełnego adresu (recipient_hash: HMAC kluczowany sekretem hooka) i BEZ
 * tokenów. Zapis idzie service_rolem z route.ts (sankcjonowane miejsce klienta
 * service-role — apps/<app>/app/api/webhooks/**) i NIGDY nie wywraca wysyłki
 * (ADR-033): sink jest wstrzykiwany jak transport, a błąd zapisu jest
 * pochłaniany. Rdzeń pozostaje testowalny bez żywego Supabase.
 */
import { createHmac } from "node:crypto";

import {
  DEFAULT_LOCALE,
  isLocale,
  platformFromAddress,
  PRODUCT_NAME,
  resendTransport,
  type EmailTransport,
  type Locale,
  type OutgoingEmail,
} from "@avably/core";
import { emailMessages, renderEmailConfirmation, renderPasswordReset } from "@avably/emails";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { panelBaseUrl } from "@/lib/panel-url";
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
    user_metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  email_data: z.object({
    token_hash: z.string().min(1),
    email_action_type: z.string().min(1),
    // TO POLE, nie `site_url`, niesie Site URL z dashboardu Supabase Auth.
    // Czytane WYŁĄCZNIE do wykrycia złej konfiguracji; baza linku nie pochodzi
    // z payloadu (ADR-050, `warnOnRedirectToMismatch`).
    redirect_to: z.string().optional(),
    // Nazwa MYLI: to adres API GoTrue (`https://<ref>.supabase.co/auth/v1`),
    // nie nasz Site URL. Nic go dziś nie czyta — zostaje w schemacie, żeby
    // docierał do warstwy porównania: bez tego test kształtu produkcyjnego
    // przechodziłby także dla bramki błędnie wycelowanej w `site_url`.
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
 * konfiguracji — patrz `warnOnRedirectToMismatch`.
 *
 * SAMA FUNKCJA MIESZKA DZIŚ W lib/panel-url.ts JAKO `panelBaseUrl` (ADR-190):
 * tę samą bazę składa też link akceptacji zaproszenia, a nazwa „callback"
 * opisywała tylko jeden z dwóch przypadków. Stary eksport zostaje aliasem —
 * wołający (password-changed-email.ts, testy) nie zmieniają zachowania.
 */
export { panelBaseUrl as callbackBaseUrl } from "@/lib/panel-url";

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
 * Rozjazd `redirect_to` z bazą, której faktycznie używamy = ZŁA KONFIGURACJA
 * Supabase Auth. Zostawiamy ślad server-side, ale NIE przerywamy wysyłki:
 * literówka w dashboardzie nie może wywracać rejestracji, skoro link i tak
 * składamy z poprawnego hosta. Cisza była tu gorsza od wszystkiego — to
 * właśnie brak jakiegokolwiek sygnału przedłużył blokadę onboardingu.
 *
 * DLACZEGO `redirect_to`, A NIE `site_url` — NAZWY POLA MYLĄ. Produkcja
 * pokazała, że `email_data.site_url` to adres API GoTrue
 * (`https://<ref>.supabase.co/auth/v1`), a Site URL z dashboardu siedzi
 * w `email_data.redirect_to` (GoTrue wstawia go tam, gdy `signUp` nie podaje
 * `emailRedirectTo` — a nasz nie podaje). Bramka celowała więc w pole, które
 * NIGDY nie będzie równe `PANEL_URL`: ostrzeżenie zapalało się przy każdym
 * zimnym starcie i kazało poprawiać ustawienie, które było poprawne.
 * OSTRZEŻENIE, KTÓRE ZAWSZE KŁAMIE, UCZY IGNOROWAĆ OSTRZEŻENIA — jest gorsze
 * niż jego brak, bo psuje wiarygodność także tych prawdziwych.
 *
 * ŚWIADOMIE NIE LOGUJEMY `token` ANI `token_hash`. Log wystarczy do naprawy
 * konfiguracji (nazwa pola + host oczekiwany i otrzymany), a token z takiego
 * wpisu pozwoliłby przejąć potwierdzaną sesję każdemu, kto ma dostęp do logów.
 *
 * Porównujemy ORIGINY, nie stringi: `redirect_to` bywa z końcowym ukośnikiem
 * albo ze ścieżką i to nie jest rozjazd. Wartość nieparsowalna idzie do logu
 * przez `JSON.stringify` — inaczej znak nowej linii w konfiguracji podrobiłby
 * kolejny wpis w logu.
 */
export function warnOnRedirectToMismatch(redirectTo: string | undefined, baseUrl: string): void {
  // Brak pola nic nie mówi o dashboardzie — nie ma czego porównywać.
  if (!redirectTo) return;

  const received = httpOrigin(redirectTo);
  if (received === baseUrl) return;

  console.warn(
    `[account-email-hook] email_data.redirect_to z payloadu ` +
      `(${received ?? JSON.stringify(redirectTo)}) nie zgadza się z bazą linku, ` +
      `której używamy (${baseUrl}). To pole niesie Site URL z konfiguracji ` +
      "Supabase Auth (panel nie przekazuje emailRedirectTo), więc popraw Site URL " +
      "tam — wiadomość poszła z poprawnym hostem.",
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
  const baseUrl = panelBaseUrl();
  warnOnRedirectToMismatch(payload.email_data.redirect_to, baseUrl);
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

// ---------------------------------------------------------------------
// Platformowy dziennik wysyłek kont (ADR-054, migracja 0025)
// ---------------------------------------------------------------------

/** Wpis dziennika — kształt lustrzany wobec kolumn public.account_email_logs. */
export interface AccountEmailLogEntry {
  action: SupportedAction;
  status: "sent" | "failed";
  /** Pseudonim adresata (hashRecipient) — NIGDY pełny adres. */
  recipientHash: string;
  /** Sanityzowany powód porażki; NULL przy 'sent' (CHECK pary w 0025). */
  reason: string | null;
}

/**
 * Port zapisu platformowego dziennika. Implementacja produkcyjna
 * (serviceRoleLogSink) pisze service_rolem z webhooka; testy wstrzykują atrapę.
 *
 * MOŻE RZUCAĆ: jedynym miejscem, które ten błąd pochłania, jest
 * `recordAccountEmail` — i robi to zawsze (ADR-033/ADR-054 D4).
 */
export interface AccountEmailLogSink {
  record(entry: AccountEmailLogEntry): Promise<void>;
}

/**
 * Pseudonim adresata do dziennika (ADR-054 D2): HMAC-SHA256 z adresu
 * znormalizowanego (lower+trim), kluczowany SEKRETEM HOOKA, w hex.
 *
 * DLACZEGO HMAC, A NIE GOŁY SHA-256: przestrzeń adresów e-mail jest
 * przeliczalna, więc goły skrót dałoby się cofnąć słownikiem. Klucz zamyka to
 * bez wprowadzania NOWEGO sekretu — hook i tak wymaga tego klucza i loguje
 * dopiero PO jego weryfikacji, więc w chwili zapisu klucz zawsze jest.
 *
 * DLACZEGO W APLIKACJI, A NIE W BAZIE: plaintext adresu nie musi w ogóle
 * docierać do Postgresa (żadnego ryzyka w logu zapytań) — do kolumny idzie
 * już sam hash, a CHECK 64-hex w 0025 odrzuca wszystko inne.
 */
export function hashRecipient(email: string, secret: string): string {
  const normalized = email.trim().toLowerCase();
  return createHmac("sha256", secret).update(`account-email-log:v1:${normalized}`).digest("hex");
}

/**
 * Sanityzacja powodu porażki przed zapisem (ADR-054 D2). Komunikaty transportu
 * potrafią nieść adres odbiorcy, a payload — token/token_hash; usuwamy jedno
 * i drugie, potem tniemy do limitu kolumny (2000, CHECK w 0025). Redakcja jest
 * dosłownym podstawieniem znanych sekretów — nie zgadujemy „co wygląda na
 * adres", tylko wycinamy DOKŁADNIE te wartości, które trzymamy w ręku.
 */
export function redactReason(message: string, secrets: readonly string[]): string {
  let out = message.length > 0 ? message : "nieznany błąd";
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[usunięte]");
  }
  return out.length > 2000 ? `${out.slice(0, 1997)}...` : out;
}

/**
 * Sink produkcyjny: INSERT do public.account_email_logs. Przyjmuje gotowego
 * klienta (service-role budowany w route.ts — jedyne sankcjonowane miejsce),
 * więc ten plik NIE importuje @avably/db/service i nie łamie kwarantanny
 * ESLint. RZUCA przy błędzie zapisu — pochłania go recordAccountEmail.
 */
export function serviceRoleLogSink(client: SupabaseClient): AccountEmailLogSink {
  return {
    async record(entry: AccountEmailLogEntry): Promise<void> {
      const { error } = await client.from("account_email_logs").insert({
        action: entry.action,
        status: entry.status,
        recipient_hash: entry.recipientHash,
        reason: entry.reason,
      });
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * Jedyne miejsce pochłaniające błąd dziennika (ADR-033/ADR-054 D4): jeśli sink
 * padnie, mail już poszedł (albo już nie poszedł) — awaria rejestru nie cofnie
 * żadnego z tych faktów. Brak sinka = wysyłka bez logu (ścieżki dev/testy).
 */
async function recordAccountEmail(
  sink: AccountEmailLogSink | undefined,
  entry: AccountEmailLogEntry,
): Promise<void> {
  if (!sink) return;
  try {
    await sink.record(entry);
  } catch (err) {
    console.warn(
      `[account-email-hook] nie udało się zapisać wpisu dziennika kont ` +
        `(${entry.action}/${entry.status}): ${err instanceof Error ? err.message : "nieznany błąd"}. ` +
        "Wysyłka nie jest tym unieważniona.",
    );
  }
}

export interface HookDependencies {
  /** Sekret hooka; domyślnie z env. Jawne `undefined` = brak konfiguracji. */
  secret?: string | undefined;
  /** Transport; domyślnie Resend z @avably/core. */
  transport?: EmailTransport;
  /** Czas do kontroli znacznika (test). */
  now?: Date;
  /**
   * Sink platformowego dziennika kont (ADR-054). Brak = wysyłka bez logu
   * (route.ts wstrzykuje service-role sink; testy jednostkowe zwykle atrapę).
   */
  logSink?: AccountEmailLogSink | undefined;
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

  // secret jest tu na pewno stringiem: verifyStandardWebhook zwróciło ok tylko
  // dlatego, że sekret był skonfigurowany, a podpis się zgadza. Guard zawęża typ
  // dla hashRecipient (pepper dziennika, ADR-054 D2) — gałąź jest formalnie
  // nieosiągalna, istnieje wyłącznie po to, by nie brać sekretu „na wiarę".
  if (secret === undefined) {
    return errorResponse(500, "Sekret hooka zniknął po weryfikacji — stan niereprezentowalny.");
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
  // Policzony RAZ przed próbą — ta sama wartość idzie do wiersza 'sent' i 'failed'.
  const recipientHash = hashRecipient(email.to, secret);
  try {
    await transport.send(email);
  } catch (err) {
    // BRAK RESEND_API_KEY ALBO ODMOWA DOSTAWCY = BŁĄD, NIGDY 200 (ADR-033).
    // Gdyby tu poszła dwusetka, Supabase uznałby wiadomość za dostarczoną,
    // użytkownik nie dostałby nic i nikt by się o tym nie dowiedział.
    const rawMessage = err instanceof Error ? err.message : "nieznany błąd";
    // Wiersz 'failed' powstaje PRZED zwróceniem błędu (ADR-054). Powód do
    // dziennika jest SANITYZOWANY (bez adresu i token_hash — komunikaty
    // transportu potrafią nieść adres odbiorcy). Odpowiedź do GoTrue niesie
    // surowy komunikat — trafia do logów Auth dostawcy, nie do naszej bazy.
    await recordAccountEmail(deps.logSink, {
      action,
      status: "failed",
      recipientHash,
      reason: redactReason(rawMessage, [
        email.to,
        email.to.toLowerCase(),
        parsed.data.email_data.token_hash,
      ]),
    });
    return errorResponse(500, `Wysyłka nie powiodła się: ${rawMessage}`);
  }

  // Wiersz 'sent' — bez powodu błędu (CHECK pary status↔reason w 0025).
  await recordAccountEmail(deps.logSink, {
    action,
    status: "sent",
    recipientHash,
    reason: null,
  });

  // Dokumentacja: puste ciało + 200 = sukces.
  return Response.json({}, { status: 200 });
}
