import type { Locale } from "@avably/core";
import { Section, Text } from "react-email";

import { RentalEmailLayout } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_COLORS, EMAIL_STYLES } from "../styles";

/**
 * Przypomnienie o zwrocie sprzętu w punkcie odbioru osobistego.
 *
 * Wszystkie wartości przychodzą SFORMATOWANE (kontrakt 8a); adres punktu
 * skleja wołający (kartoteka trzyma go w osobnych kolumnach). `phone`
 * i `openingHours` są opcjonalne: punkt odbioru nie ma dziś tych danych
 * w kartotece — wiersz pojawia się TYLKO, gdy wołający je zna, zamiast
 * pustej rubryki albo fabrykowanej wartości.
 */
export interface PickupReturnReminderEmailProps {
  locale: Locale;
  tenantName: string;
  customerName: string;
  orderNumber: string;
  endDate: string;
  locationName: string;
  locationAddress: string;
  phone?: string;
  openingHours?: string;
}

export function PickupReturnReminderEmail({
  customerName,
  endDate,
  locale,
  locationAddress,
  locationName,
  openingHours,
  orderNumber,
  phone,
  tenantName,
}: PickupReturnReminderEmailProps) {
  const messages = emailMessages(locale);
  const t = messages.pickupReturnReminder;
  const details = [
    [t.fields.orderNumber, orderNumber],
    [t.fields.location, locationName],
    [t.fields.address, locationAddress],
    ...(phone ? ([[t.fields.phone, phone]] as const) : []),
    ...(openingHours ? ([[t.fields.openingHours, openingHours]] as const) : []),
  ] as const;

  return (
    <RentalEmailLayout
      footerText={messages.rentalLifecycle.footerAutomated}
      heading={t.heading}
      locale={locale}
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
    </RentalEmailLayout>
  );
}
