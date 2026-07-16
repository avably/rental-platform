import type { Locale } from "@avably/core";
import { Text } from "react-email";

import { EmailLayout } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_STYLES } from "../styles";

export interface PasswordResetProps {
  /** Język odbiorcy. Wymagany — e-mail nie ma skąd go wywnioskować. */
  locale: Locale;
  resetUrl: string;
  recipientName?: string;
}

export function PasswordReset({ locale, resetUrl, recipientName }: PasswordResetProps) {
  const m = emailMessages(locale);
  const t = m.passwordReset;

  return (
    <EmailLayout
      cta={{ href: resetUrl, label: t.cta }}
      heading={t.heading}
      locale={locale}
      previewText={t.preview}
    >
      <Text style={EMAIL_STYLES.text}>{m.greeting(recipientName)}</Text>
      <Text style={EMAIL_STYLES.text}>{t.requested}</Text>
      <Text style={EMAIL_STYLES.text}>{t.ignore}</Text>
    </EmailLayout>
  );
}
