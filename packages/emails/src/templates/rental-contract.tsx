import type { Locale } from "@avably/core";
import { Section, Text } from "react-email";

import { RentalEmailLayout } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_COLORS, EMAIL_STYLES } from "../styles";

export interface RentalContractEmailProps {
  locale: Locale;
  tenantName: string;
  customerName: string;
  orderNumber: string;
}

/** Treść wariantu 8a; dokładne bajty PDF dokłada transport na granicy I/O. */
export function RentalContractEmail({
  locale,
  tenantName,
  customerName,
  orderNumber,
}: RentalContractEmailProps) {
  const messages = emailMessages(locale);
  const t = messages.rentalContract;

  return (
    <RentalEmailLayout
      footerText={messages.rentalLifecycle.footerAutomated}
      heading={t.heading}
      locale={locale}
      previewText={t.preview(orderNumber)}
      tenantName={tenantName}
    >
      <Text style={EMAIL_STYLES.text}>{messages.rentalLifecycle.greeting(customerName)}</Text>
      <Text style={EMAIL_STYLES.text}>{t.body}</Text>
      <Section
        style={{
          backgroundColor: EMAIL_COLORS.muted,
          borderRadius: "8px",
          padding: "8px 16px",
        }}
      >
        <Text style={{ ...EMAIL_STYLES.text, margin: "0", padding: "10px 0" }}>
          <strong>{t.orderNumber}:</strong> {orderNumber}
        </Text>
      </Section>
      <Text style={EMAIL_STYLES.text}>{t.attachmentHint}</Text>
    </RentalEmailLayout>
  );
}
