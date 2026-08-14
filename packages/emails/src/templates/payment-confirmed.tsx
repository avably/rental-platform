/**
 * Potwierdzenie ZAKSIĘGOWANIA płatności dla klienta końcowego (ADR-139).
 *
 * Wysyłane po utrwalonym przejściu `payment_status` w `paid` — mail obiecany
 * przez stronę statusu checkoutu w stanie „sprawdzamy" (rutyna od F1/ADR-137:
 * BLIK i P24 domykają się webhookiem poza przeglądarką klienta).
 *
 * Kontrakt 8a bez zmian: kwota przychodzi SFORMATOWANA (formatMoney w locale
 * odbiorcy i walucie zamówienia robi WOŁAJĄCY — panel), bo pakiet nie zgaduje
 * ani waluty, ani locale. Treść mówi wyłącznie o fakcie zaksięgowania —
 * zero obietnic ponad stan (o wydaniu sprzętu mówią maile cyklu najmu).
 * Nagłówek i stopka pokazują wyłącznie tenantName (ADR-036 D2): klient
 * dostaje wiadomość od wypożyczalni, nie od platformy.
 */
import type { Locale } from "@avably/core";
import { Section, Text } from "react-email";

import { RentalEmailLayout, type EmailTenantLogo } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_COLORS, EMAIL_STYLES } from "../styles";

export interface PaymentConfirmedEmailProps {
  locale: Locale;
  tenantName: string;
  orderNumber: string;
  customerName: string;
  /** Kwota zaksięgowana, SFORMATOWANA przez wołającego (kontrakt 8a). */
  amountPaidFormatted: string;
  /** Znak najemcy, KTÓREGO DOTYCZY wiadomość (ADR-175); brak = nazwa tekstem. */
  logo?: EmailTenantLogo;
}

export function PaymentConfirmedEmail({
  amountPaidFormatted,
  customerName,
  locale,
  logo,
  orderNumber,
  tenantName,
}: PaymentConfirmedEmailProps) {
  const t = emailMessages(locale);
  const message = t.paymentConfirmed;
  const details = [
    [message.fields.orderNumber, orderNumber],
    [message.fields.amountPaid, amountPaidFormatted],
  ] as const;

  return (
    <RentalEmailLayout
      footerText={t.rentalLifecycle.footerAutomated}
      heading={message.heading}
      locale={locale}
      logo={logo}
      previewText={message.preview(orderNumber)}
      tenantName={tenantName}
    >
      <Text style={EMAIL_STYLES.text}>{t.rentalLifecycle.greeting(customerName)}</Text>
      <Text style={EMAIL_STYLES.text}>{message.body}</Text>
      <Section
        style={{
          backgroundColor: EMAIL_COLORS.muted,
          borderRadius: "8px",
          padding: "8px 16px",
        }}
      >
        {details.map(([label, value]) => (
          <Text
            key={label}
            style={{
              ...EMAIL_STYLES.text,
              borderBottom: `1px solid ${EMAIL_COLORS.border}`,
              margin: "0",
              padding: "10px 0",
            }}
          >
            <strong>{label}:</strong> {value}
          </Text>
        ))}
      </Section>
    </RentalEmailLayout>
  );
}
