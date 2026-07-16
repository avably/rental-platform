import { Text } from "react-email";

import { EmailLayout } from "../components/email-layout";
import { EMAIL_STYLES } from "../styles";

export interface EmailConfirmationProps {
  confirmationUrl: string;
  recipientName?: string;
}

export function EmailConfirmation({
  confirmationUrl,
  recipientName,
}: EmailConfirmationProps) {
  const greeting = recipientName ? `Cześć, ${recipientName}!` : "Cześć!";

  return (
    <EmailLayout
      cta={{ href: confirmationUrl, label: "Potwierdź adres e-mail" }}
      heading="Potwierdź adres e-mail"
      previewText="Potwierdź adres e-mail w Avably."
    >
      <Text style={EMAIL_STYLES.text}>{greeting}</Text>
      <Text style={EMAIL_STYLES.text}>
        Potwierdź swój adres e-mail, aby dokończyć tworzenie konta.
      </Text>
    </EmailLayout>
  );
}
