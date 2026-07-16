import type { Locale } from "@avably/core";
import { Text } from "react-email";

import { EmailLayout } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_STYLES } from "../styles";

export interface EmailConfirmationProps {
  confirmationUrl: string;
  /** Język odbiorcy. Wymagany — e-mail nie ma skąd go wywnioskować. */
  locale: Locale;
  recipientName?: string;
}

export function EmailConfirmation({
  confirmationUrl,
  locale,
  recipientName,
}: EmailConfirmationProps) {
  const m = emailMessages(locale);
  const t = m.emailConfirmation;

  return (
    <EmailLayout
      cta={{ href: confirmationUrl, label: t.cta }}
      heading={t.heading}
      locale={locale}
      previewText={t.preview}
    >
      <Text style={EMAIL_STYLES.text}>{m.greeting(recipientName)}</Text>
      <Text style={EMAIL_STYLES.text}>{t.body}</Text>
    </EmailLayout>
  );
}
