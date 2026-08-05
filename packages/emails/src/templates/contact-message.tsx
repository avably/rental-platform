import type { Locale } from "@avably/core";
import { Text } from "react-email";

import { RentalEmailLayout } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_COLORS, EMAIL_STYLES } from "../styles";

/**
 * WIADOMOŚĆ Z FORMULARZA KONTAKTOWEGO SKLEPU (E4, ADR-095).
 *
 * Odbiorcą jest NAJEMCA, a nadawcą — odwiedzający jego stronę, więc ramka jest
 * ta sama, co w korespondencji z klientem (`RentalEmailLayout`): marka
 * wypożyczalni, zero marki platformy i zero przycisku, bo nie ma dokąd nim
 * przejść. Odpowiedź idzie zwykłym „Odpowiedz" — adres nadawcy wchodzi
 * w `Reply-To` po stronie wysyłki.
 *
 * TREŚĆ WIADOMOŚCI JEST TEKSTEM, NIE HTML-em. Wchodzi przez `Text`, więc
 * react-email ucieka znaki specjalne; wstrzyknięcie znaczników przez pole
 * formularza jest z definicji niemożliwe, a nie „odfiltrowane".
 *
 * `whiteSpace: "pre-wrap"`: wiadomość napisana w akapitach ma dojść
 * w akapitach. Zwinięcie jej do jednego bloku jest zmianą treści nadawcy.
 */
export interface ContactMessageEmailProps {
  /** Język NAJEMCY (odbiorcy) — e-mail nie ma skąd go wywnioskować. */
  locale: Locale;
  /** Nazwa wypożyczalni w nagłówku i stopce ramki. */
  tenantName: string;
  senderName: string;
  senderEmail: string;
  senderPhone?: string;
  message: string;
}

export function ContactMessageEmail({
  locale,
  tenantName,
  senderName,
  senderEmail,
  senderPhone,
  message,
}: ContactMessageEmailProps) {
  const t = emailMessages(locale).contactMessage;

  return (
    <RentalEmailLayout
      footerText={t.footer}
      heading={t.heading}
      locale={locale}
      previewText={t.preview(senderName)}
      tenantName={tenantName}
    >
      <Text style={EMAIL_STYLES.text}>{t.intro}</Text>
      <Text
        style={{
          ...EMAIL_STYLES.text,
          backgroundColor: EMAIL_COLORS.muted,
          borderRadius: "8px",
          padding: "12px 16px",
        }}
      >
        {t.fields.name}: <strong>{senderName}</strong>
        <br />
        {t.fields.email}: <strong>{senderEmail}</strong>
        {senderPhone ? (
          <>
            <br />
            {t.fields.phone}: <strong>{senderPhone}</strong>
          </>
        ) : null}
      </Text>
      <Text style={{ ...EMAIL_STYLES.text, whiteSpace: "pre-wrap" }}>{message}</Text>
    </RentalEmailLayout>
  );
}
