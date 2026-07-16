import type { Locale } from "@avably/core";
import { Section, Text } from "react-email";

import { EmailLayout } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_COLORS, EMAIL_STYLES } from "../styles";

/**
 * Tymczasowy kontrakt fazy 1. Kwota i daty przychodzą jako gotowe,
 * sformatowane teksty; pakiet e-maili nie wykonuje formatowania domenowego.
 * Wołający formatuje je w locale odbiorcy i walucie planu (patrz
 * `formatMoney` z @avably/core) — dlatego `totalAmount` jest stringiem, a nie
 * liczbą: pakiet nie zgaduje waluty.
 */
export interface NewOrderNotificationProps {
  customerName: string;
  /** Język odbiorcy. Wymagany — e-mail nie ma skąd go wywnioskować. */
  locale: Locale;
  orderNumber: string;
  orderUrl: string;
  rentalEndDate: string;
  rentalStartDate: string;
  totalAmount: string;
}

export function NewOrderNotification({
  customerName,
  locale,
  orderNumber,
  orderUrl,
  rentalEndDate,
  rentalStartDate,
  totalAmount,
}: NewOrderNotificationProps) {
  const t = emailMessages(locale).newOrderNotification;

  const details = [
    [t.fields.number, orderNumber],
    [t.fields.customer, customerName],
    [t.fields.amount, totalAmount],
    [t.fields.rentalPeriod, `${rentalStartDate}–${rentalEndDate}`],
  ] as const;

  return (
    <EmailLayout
      cta={{ href: orderUrl, label: t.cta }}
      heading={t.heading}
      locale={locale}
      previewText={t.preview(orderNumber)}
    >
      <Text style={EMAIL_STYLES.text}>{t.intro}</Text>
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
    </EmailLayout>
  );
}
