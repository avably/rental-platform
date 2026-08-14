import type { Locale } from "@avably/core";
import { Section, Text } from "react-email";

import { RentalEmailLayout, type EmailTenantLogo } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_COLORS, EMAIL_STYLES } from "../styles";

/**
 * E-mail z etykietą zwrotną (przesyłka kurierska). Sama etykieta PDF jest
 * ZAŁĄCZNIKIEM wiadomości (transport @avably/core), nie treścią — szablon
 * mówi tylko, co jest w załączniku i czego dotyczy.
 *
 * Wszystkie wartości przychodzą SFORMATOWANE (kontrakt 8a). `carrierName`
 * jest opcjonalny: rejestr przesyłek nie utrwala nazwy przewoźnika, więc
 * wołający podaje ją tylko wtedy, gdy naprawdę ją zna.
 */
export interface ReturnLabelEmailProps {
  locale: Locale;
  tenantName: string;
  customerName: string;
  orderNumber: string;
  endDate: string;
  shipmentNumber: string;
  carrierName?: string;
  /** Znak najemcy, KTÓREGO DOTYCZY wiadomość (ADR-175); brak = nazwa tekstem. */
  logo?: EmailTenantLogo;
}

export function ReturnLabelEmail({
  carrierName,
  customerName,
  endDate,
  locale,
  logo,
  orderNumber,
  shipmentNumber,
  tenantName,
}: ReturnLabelEmailProps) {
  const messages = emailMessages(locale);
  const t = messages.returnLabel;
  const details = [
    [t.fields.orderNumber, orderNumber],
    [t.fields.shipmentNumber, shipmentNumber],
    ...(carrierName ? ([[t.fields.carrier, carrierName]] as const) : []),
  ] as const;

  return (
    <RentalEmailLayout
      footerText={messages.rentalLifecycle.footerAutomated}
      heading={t.heading}
      locale={locale}
      logo={logo}
      previewText={t.preview(orderNumber)}
      tenantName={tenantName}
    >
      <Text style={EMAIL_STYLES.text}>{messages.rentalLifecycle.greeting(customerName)}</Text>
      <Text style={EMAIL_STYLES.text}>{t.body(endDate)}</Text>
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
      <Text style={EMAIL_STYLES.text}>{t.attachmentHint}</Text>
    </RentalEmailLayout>
  );
}
