import { Text } from "react-email";

import { EmailLayout } from "../components/email-layout";
import { EMAIL_STYLES } from "../styles";

export interface PasswordResetProps {
  resetUrl: string;
  recipientName?: string;
}

export function PasswordReset({ resetUrl, recipientName }: PasswordResetProps) {
  const greeting = recipientName ? `Cześć, ${recipientName}!` : "Cześć!";

  return (
    <EmailLayout
      cta={{ href: resetUrl, label: "Ustaw nowe hasło" }}
      heading="Ustaw nowe hasło"
      previewText="Ustaw nowe hasło do konta w <NAZWA>."
    >
      <Text style={EMAIL_STYLES.text}>{greeting}</Text>
      <Text style={EMAIL_STYLES.text}>
        Otrzymaliśmy prośbę o ustawienie nowego hasła do Twojego konta.
      </Text>
      <Text style={EMAIL_STYLES.text}>
        Jeśli to nie Ty, zignoruj tę wiadomość. Twoje hasło się nie zmieni.
      </Text>
    </EmailLayout>
  );
}
