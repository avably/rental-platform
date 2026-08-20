/**
 * Mail dunningowy billingu SaaS (J2 faza 2a, ADR-136) — złożenie i wysyłka
 * wiadomości „płatność za abonament nie powiodła się" do WŁAŚCICIELI
 * organizacji.
 *
 * TRZY RÓŻNICE wobec maili cyklu najmu (ADR-036), wszystkie zamierzone:
 *
 *   1. NADAWCA = PLATFORMA („Avably"), nie marka najemcy: to nasza wiadomość
 *      o naszej fakturze — podszywanie jej pod markę najemcy byłoby
 *      odwróceniem ADR-036 D2.
 *   2. BEZ wpisu w email_logs: rejestr 0021 jest widokiem NAJEMCY (czyta go
 *      panel przy zamówieniach), a dunning naszej faktury nie jest jego
 *      korespondencją z klientami. Idempotencję wysyłki gwarantuje claim
 *      `webhook_events` (ponowiona dostawa zdarzenia nie dochodzi do tego
 *      kodu), więc rejestr nie jest tu mechanizmem, tylko byłby ekspozycją.
 *   3. ODBIORCY z żywego odczytu bazy service-rolem (members role=owner →
 *      auth.users przez API admina) — claim JWT nie występuje, bo to ścieżka
 *      webhooka, nie sesji.
 *
 * NIGDY NIE RZUCA — zwraca powód niewysłania albo undefined (wzorzec
 * sendInvitationEmail): stan tenanta jest już zapisany, poczta go nie cofa.
 */
import {
  DEFAULT_TENANT_LOCALE,
  PANEL_URL,
  isLocale,
  platformFromAddress,
  type EmailAvailability,
  type EmailTransport,
  type Locale,
} from "@avably/core";
import { emailMessages, renderSaasPaymentFailed } from "@avably/emails";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Nazwa nadawcy maili platformowych — brand, nie tenant (patrz nagłówek). */
const PLATFORM_SENDER_NAME = "Avably";

export interface SaasPaymentFailedEmailDeps {
  /** Klient SERVICE-ROLE (ścieżka webhooka) — czyta tenants/members/auth.users. */
  db: SupabaseClient;
  availability: EmailAvailability;
  transport: EmailTransport;
  /** Nadpisanie adresu platformy (test); domyślnie env/stała @avably/core. */
  fromEmail?: string;
  /**
   * Nadpisanie bazy URL panelu (test/loopback); domyślnie `PANEL_URL`
   * (`app.avably.io`). Domyślną NIE jest `siteUrl()`: link prowadzi do PANELU,
   * nie na LP, a ta ścieżka biegnie z webhooka/joba, gdzie `headers()` może nie
   * być dostępne — stała jest zawsze poprawna w prod (ADR-221).
   */
  panelBaseUrl?: string;
}

function saasLocale(raw: string | null | undefined): Locale {
  return isLocale(raw ?? "") ? (raw as Locale) : DEFAULT_TENANT_LOCALE;
}

/**
 * Wysyła jeden mail per właściciel organizacji. Zwraca powód, gdy NIC nie
 * wyszło albo część nie wyszła — cisza znaczy „komplet dostarczony
 * transportowi".
 */
export async function sendSaasPaymentFailedEmail(
  deps: SaasPaymentFailedEmailDeps,
  input: { tenantId: string },
): Promise<string | undefined> {
  if (!deps.availability.available) return deps.availability.reason ?? "transport niedostępny";

  const tenantQuery = await deps.db
    .from("tenants")
    .select("name, locale")
    .eq("id", input.tenantId)
    .maybeSingle();
  if (tenantQuery.error) {
    return `odczyt organizacji nie powiódł się: ${tenantQuery.error.message}`;
  }
  const tenant = tenantQuery.data as { name: string; locale: string | null } | null;
  if (!tenant) return `organizacja ${input.tenantId} nie istnieje`;

  const ownersQuery = await deps.db
    .from("members")
    .select("user_id")
    .eq("tenant_id", input.tenantId)
    .eq("role", "owner");
  if (ownersQuery.error) {
    return `odczyt właścicieli nie powiódł się: ${ownersQuery.error.message}`;
  }
  const ownerIds = ((ownersQuery.data ?? []) as { user_id: string }[]).map((row) => row.user_id);
  if (ownerIds.length === 0) return "organizacja nie ma właściciela do powiadomienia";

  const emails: string[] = [];
  for (const userId of ownerIds) {
    const { data, error } = await deps.db.auth.admin.getUserById(userId);
    if (error) continue; // pojedynczy brak nie gasi pozostałych odbiorców
    const email = data.user?.email;
    if (email) emails.push(email);
  }
  if (emails.length === 0) return "żaden właściciel nie ma adresu e-mail";

  const locale = saasLocale(tenant.locale);
  const billingUrl = `${deps.panelBaseUrl ?? PANEL_URL}/organizacja`;
  const { html, text } = await renderSaasPaymentFailed({
    locale,
    organizationName: tenant.name,
    billingUrl,
  });
  const subject = emailMessages(locale).saasPaymentFailed.heading;
  const from = platformFromAddress(
    PLATFORM_SENDER_NAME,
    deps.fromEmail ? { fromEmail: deps.fromEmail } : {},
  );

  const failures: string[] = [];
  for (const to of emails) {
    try {
      await deps.transport.send({ from, to, subject, html, text });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length === emails.length) return `wysyłka nie powiodła się: ${failures[0]}`;
  if (failures.length > 0) return `część wysyłek nie powiodła się: ${failures[0]}`;
  return undefined;
}
