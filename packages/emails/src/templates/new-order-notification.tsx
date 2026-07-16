import { Section, Text } from "react-email";

import { EmailLayout } from "../components/email-layout";
import { EMAIL_COLORS, EMAIL_STYLES } from "../styles";

/**
 * Tymczasowy kontrakt fazy 1. Kwota i daty przychodzą jako gotowe,
 * sformatowane teksty; pakiet e-maili nie wykonuje formatowania domenowego.
 */
export interface NewOrderNotificationProps {
  customerName: string;
  orderNumber: string;
  orderUrl: string;
  rentalEndDate: string;
  rentalStartDate: string;
  totalAmount: string;
}

export function NewOrderNotification({
  customerName,
  orderNumber,
  orderUrl,
  rentalEndDate,
  rentalStartDate,
  totalAmount,
}: NewOrderNotificationProps) {
  const details = [
    ["Numer", orderNumber],
    ["Klient", customerName],
    ["Kwota", totalAmount],
    ["Okres wynajmu", `${rentalStartDate}–${rentalEndDate}`],
  ] as const;

  return (
    <EmailLayout
      cta={{ href: orderUrl, label: "Zobacz zamówienie" }}
      heading="Nowe zamówienie"
      previewText={`Nowe zamówienie ${orderNumber} w Avably.`}
    >
      <Text style={EMAIL_STYLES.text}>
        Wpadło nowe zamówienie. Najważniejsze dane znajdziesz poniżej.
      </Text>
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
