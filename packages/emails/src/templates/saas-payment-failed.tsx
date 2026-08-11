import type { Locale } from "@avably/core";
import { Text } from "react-email";

import { EmailLayout } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_STYLES } from "../styles";

/**
 * Mail dunningowy do NAJEMCY po `invoice.payment_failed` (J2 faza 2a,
 * ADR-136) — JEDEN szablon tej fazy. Ton rzeczowy, zero odliczania dni:
 * zegar ponowień należy do dostawcy płatności (zasada 1 okna dunningowego),
 * „ton rosnący" i maile przedostatni/ostatni dochodzą w fazie 2b.
 *
 * Wysyłany z konta PLATFORMY do właściciela organizacji — to nasza wiadomość
 * o naszej fakturze, nie mail w imieniu marki najemcy (inaczej niż cykl
 * najmu, ADR-036 D2). Idempotencję zapewnia claim `webhook_events`:
 * ponowiona dostawa zdarzenia w ogóle nie dochodzi do wysyłki.
 */
export interface SaasPaymentFailedProps {
  /** Język właściciela — z tenants.locale (mail nie ma skąd go wywnioskować). */
  locale: Locale;
  organizationName: string;
  /** Adres sekcji „Plan i rozliczenia" w panelu — CTA prowadzi do zapłaty. */
  billingUrl: string;
}

export function SaasPaymentFailed({ locale, organizationName, billingUrl }: SaasPaymentFailedProps) {
  const m = emailMessages(locale);
  const t = m.saasPaymentFailed;

  return (
    <EmailLayout
      cta={{ href: billingUrl, label: t.cta }}
      heading={t.heading}
      locale={locale}
      previewText={t.preview(organizationName)}
    >
      <Text style={EMAIL_STYLES.text}>{t.intro(organizationName)}</Text>
      <Text style={EMAIL_STYLES.text}>{t.retry}</Text>
      <Text style={EMAIL_STYLES.text}>{t.action}</Text>
    </EmailLayout>
  );
}
