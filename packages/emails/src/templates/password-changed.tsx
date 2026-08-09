/**
 * Powiadomienie o ZMIANIE hasła (R14/M-01, ADR-122) — informacja po fakcie,
 * nie prośba o działanie. Świadomie BEZ tokenu i BEZ linku sesyjnego:
 * jedyny odnośnik prowadzi na formularz PROŚBY o reset (`/reset`), bo gdy
 * zmiany nie wykonał właściciel konta, nowy reset (unieważniający sesje
 * i znany napastnikowi sekret) jest jego drogą odzyskania kontroli.
 * Nadawcą jest PLATFORMA (jak w password-reset) — to korespondencja Avably
 * z użytkownikiem, żaden tenant tu nie występuje.
 */
import type { Locale } from "@avably/core";
import { Text } from "react-email";

import { EmailLayout } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_STYLES } from "../styles";

export interface PasswordChangedProps {
  /** Język odbiorcy. Wymagany — e-mail nie ma skąd go wywnioskować. */
  locale: Locale;
  /** Adres formularza prośby o reset hasła (bez żadnego tokenu). */
  resetRequestUrl: string;
  recipientName?: string;
}

export function PasswordChanged({ locale, resetRequestUrl, recipientName }: PasswordChangedProps) {
  const m = emailMessages(locale);
  const t = m.passwordChanged;

  return (
    <EmailLayout
      cta={{ href: resetRequestUrl, label: t.cta }}
      heading={t.heading}
      locale={locale}
      previewText={t.preview}
    >
      <Text style={EMAIL_STYLES.text}>{m.greeting(recipientName)}</Text>
      <Text style={EMAIL_STYLES.text}>{t.changed}</Text>
      <Text style={EMAIL_STYLES.text}>{t.notYou}</Text>
    </EmailLayout>
  );
}
