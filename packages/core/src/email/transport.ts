/**
 * Port wysyłki e-maili (Resend HTTP API) — ADR-033.
 *
 * SEMANTYKA KONFIGURACJI — ŚWIADOMIE INNA NIŻ TURNSTILE (ADR-032):
 * Turnstile bez sekretu robi dev-skip i PRZEPUSZCZA żądanie, bo brak CAPTCHY
 * w dev/CI jest nieszkodliwy. Tutaj odpowiednikiem byłby CICHY SUKCES: panel
 * mówi „wysłano", klient nie dostaje nic, nikt się o tym nie dowiaduje —
 * a e-mail cyklu najmu jest jedynym sygnałem, jaki klient dostaje. Dlatego:
 *
 *  - brak RESEND_API_KEY → wysyłka JAWNIE niedostępna: emailAvailability
 *    gasi przełącznik w panelu i podaje powód, a próba wysyłki mimo to
 *    kończy się wyjątkiem — nigdy udawanym sukcesem,
 *  - klucz ustawiony → odmowa dostawcy albo awaria sieci to BŁĄD zwrócony
 *    wołającemu, nie połknięty wyjątek.
 *
 * Wspólne z Turnstile zostaje to, co istotne: konfiguracja rozstrzyga się
 * JAWNIE (a nie przez zgadywanie z NODE_ENV), a transport (`fetchFn`) jest
 * wstrzykiwany, żeby testy nie biły w sieć.
 */
import { DEFAULT_FROM_EMAIL } from "../brand";
import type {
  EmailAttachment,
  EmailAvailability,
  EmailSendResult,
  EmailTransport,
  OutgoingEmail,
} from "./types";

export const RESEND_SEND_URL = "https://api.resend.com/emails";

export class EmailTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailTransportError";
  }
}

export interface EmailTransportOptions {
  /** Klucz API; domyślnie process.env.RESEND_API_KEY. */
  apiKey?: string | undefined;
  /** Transport do testów; domyślnie globalny fetch. */
  fetchFn?: typeof fetch;
}

/**
 * `in` zamiast `??`: jawne `apiKey: undefined` to decyzja wołającego (test,
 * wymuszony brak konfiguracji) i nie może spaść na env procesu — wzorzec
 * z verifyTurnstile.
 */
function resolveApiKey(options: EmailTransportOptions): string | undefined {
  const apiKey = "apiKey" in options ? options.apiKey : process.env.RESEND_API_KEY;
  // Pusty string w env to brak konfiguracji, nie klucz.
  return apiKey ? apiKey : undefined;
}

/**
 * Powód niedostępności czytany przez NAJEMCĘ na ekranach panelu (U1, audyt
 * UX W3): brak klucza transportu to sprawa PLATFORMY, więc komunikat jest
 * neutralny — bez nazwy zmiennej (mapa infrastruktury dla napastnika, szum
 * dla operatora wypożyczalni) i bez sugerowania najemcy działań, których
 * nie może wykonać. Która zmienna gasi transport, mówi komentarz wyżej
 * i `resolveApiKey` — miejsce dla operatora platformy, nie dla ekranu.
 */
const NOT_CONFIGURED =
  "Wysyłka e-maili jest chwilowo niedostępna po stronie platformy — pracujemy nad przywróceniem.";

/** Załącznik w kształcie API Resend: content zawsze jako base64. */
function attachmentToPayload(attachment: EmailAttachment): {
  filename: string;
  content: string;
} {
  return {
    filename: attachment.filename,
    content:
      typeof attachment.content === "string"
        ? attachment.content
        : Buffer.from(attachment.content).toString("base64"),
  };
}

export function emailAvailability(options: EmailTransportOptions = {}): EmailAvailability {
  if (!resolveApiKey(options)) return { available: false, reason: NOT_CONFIGURED };
  return { available: true };
}

/**
 * Adres From: nazwa TENANTA + adres PLATFORMY (ADR-033). Adres per tenant
 * wymagałby weryfikacji DNS domeny każdego najemcy z osobna.
 */
export function platformFromAddress(
  tenantName: string,
  options: { fromEmail?: string } = {},
): string {
  const configured = options.fromEmail ?? process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM_EMAIL;
  // Stała platformy może przyjść jako "Marka <adres>" albo goły adres —
  // nazwę tenanta wstawiamy zawsze, więc wyłuskujemy sam adres.
  const address = (configured.match(/<([^>]+)>/)?.[1] ?? configured).trim();
  // Cudzysłów albo backslash w nazwie rozbiłby nagłówek From — wtedy
  // nazwa idzie w cudzysłowie, ze znakami specjalnymi escapowanymi.
  const name = /["\\]/.test(tenantName)
    ? `"${tenantName.replace(/(["\\])/g, "\\$1")}"`
    : tenantName;
  return `${name} <${address}>`;
}

export function resendTransport(options: EmailTransportOptions = {}): EmailTransport {
  const apiKey = resolveApiKey(options);
  const fetchFn = options.fetchFn ?? fetch;

  return {
    async send(email: OutgoingEmail): Promise<EmailSendResult> {
      if (!apiKey) throw new EmailTransportError(NOT_CONFIGURED);

      const response = await fetchFn(RESEND_SEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(email.replyTo ? { reply_to: email.replyTo } : {}),
          // Brak załączników = payload identyczny jak przed ich wprowadzeniem
          // (pusta tablica też nie wysyła pola — wzorzec reply_to wyżej).
          ...(email.attachments && email.attachments.length > 0
            ? { attachments: email.attachments.map(attachmentToPayload) }
            : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new EmailTransportError(
          `Dostawca poczty odrzucił wysyłkę (HTTP ${response.status}). ${body}`.trim(),
        );
      }

      // Identyfikator wiadomości wraca do wołającego, żeby trafił do
      // historii wysyłek (ADR-045). ODCZYT JEST NAJLEPSZYM STARANIEM:
      // wysyłka JUŻ SIĘ UDAŁA (HTTP 2xx), więc niesparsowalne albo
      // nieoczekiwane ciało odpowiedzi nie może jej przebrać w błąd —
      // dałoby to operatorowi „nie wysłano" przy wiadomości, która
      // wyszła, czyli dokładnie to kłamstwo, którego zabrania ADR-033.
      const payload: unknown = await response.json().catch(() => null);
      const id =
        typeof payload === "object" && payload !== null && "id" in payload
          ? (payload as { id?: unknown }).id
          : undefined;
      return { id: typeof id === "string" && id.length > 0 ? id : null };
    },
  };
}
