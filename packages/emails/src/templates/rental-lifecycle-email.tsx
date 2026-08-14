import type { Locale } from "@avably/core";
import { Section, Text } from "react-email";

import { RentalEmailLayout, type EmailTenantLogo } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_COLORS, EMAIL_STYLES } from "../styles";

export interface RentalLifecycleEmailProps {
  locale: Locale;
  tenantName: string;
  orderNumber: string;
  customerName: string;
  startDate: string;
  endDate: string;
  totalRentalFormatted: string;
  pickupLocationName?: string;
  /** Znak najemcy, KTÓREGO DOTYCZY wiadomość (ADR-175); brak = nazwa tekstem. */
  logo?: EmailTenantLogo;
}

export type RentalLifecycleTemplate =
  | "confirmed"
  | "readyForPickup"
  | "pickedUp"
  | "returned"
  | "cancelled";

interface RentalLifecycleEmailTemplateProps extends RentalLifecycleEmailProps {
  template: RentalLifecycleTemplate;
}

export function RentalLifecycleEmailTemplate({
  customerName,
  endDate,
  locale,
  logo,
  orderNumber,
  pickupLocationName,
  startDate,
  template,
  tenantName,
  totalRentalFormatted,
}: RentalLifecycleEmailTemplateProps) {
  const t = emailMessages(locale).rentalLifecycle;
  const message = t[template];
  const details = [
    [t.fields.orderNumber, orderNumber],
    [t.fields.rentalPeriod, `${startDate}–${endDate}`],
    [t.fields.totalRental, totalRentalFormatted],
    ...(pickupLocationName
      ? ([[t.fields.pickupLocation, pickupLocationName]] as const)
      : []),
  ] as const;

  return (
    <RentalEmailLayout
      footerText={t.footerAutomated}
      heading={message.heading}
      locale={locale}
      logo={logo}
      previewText={message.preview(orderNumber)}
      tenantName={tenantName}
    >
      <Text style={EMAIL_STYLES.text}>{t.greeting(customerName)}</Text>
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
