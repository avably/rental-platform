import type { Locale } from "@avably/core";
import { Text } from "react-email";

import { EmailLayout } from "../components/email-layout";
import { emailMessages } from "../messages";
import { EMAIL_COLORS, EMAIL_STYLES } from "../styles";

export type InvitationRole = "owner" | "staff";

export interface OrganizationInvitationProps {
  acceptanceUrl: string;
  /** Język odbiorcy. Wymagany — e-mail nie ma skąd go wywnioskować. */
  locale: Locale;
  organizationName: string;
  recipientName?: string;
  role: InvitationRole;
}

export function OrganizationInvitation({
  acceptanceUrl,
  locale,
  organizationName,
  recipientName,
  role,
}: OrganizationInvitationProps) {
  const m = emailMessages(locale);
  const t = m.organizationInvitation;

  return (
    <EmailLayout
      cta={{ href: acceptanceUrl, label: t.cta }}
      heading={t.heading}
      locale={locale}
      previewText={t.preview(organizationName)}
    >
      <Text style={EMAIL_STYLES.text}>{m.greeting(recipientName)}</Text>
      <Text style={EMAIL_STYLES.text}>
        <strong>{organizationName}</strong> {t.invitedBy}
      </Text>
      <Text
        style={{
          ...EMAIL_STYLES.text,
          backgroundColor: EMAIL_COLORS.muted,
          borderRadius: "8px",
          padding: "12px 16px",
        }}
      >
        {t.roleLabel}: <strong>{t.roles[role]}</strong>
      </Text>
    </EmailLayout>
  );
}
