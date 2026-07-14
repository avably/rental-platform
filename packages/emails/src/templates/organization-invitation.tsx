import { Text } from "react-email";

import { EmailLayout } from "../components/email-layout";
import { EMAIL_COLORS, EMAIL_STYLES } from "../styles";

export type InvitationRole = "owner" | "staff";

export interface OrganizationInvitationProps {
  acceptanceUrl: string;
  organizationName: string;
  recipientName?: string;
  role: InvitationRole;
}

const ROLE_LABELS: Record<InvitationRole, string> = {
  owner: "właściciel",
  staff: "pracownik",
};

export function OrganizationInvitation({
  acceptanceUrl,
  organizationName,
  recipientName,
  role,
}: OrganizationInvitationProps) {
  const greeting = recipientName ? `Cześć, ${recipientName}!` : "Cześć!";

  return (
    <EmailLayout
      cta={{ href: acceptanceUrl, label: "Dołącz do organizacji" }}
      heading="Zaproszenie do organizacji"
      previewText={`Dołącz do organizacji ${organizationName} w <NAZWA>.`}
    >
      <Text style={EMAIL_STYLES.text}>{greeting}</Text>
      <Text style={EMAIL_STYLES.text}>
        Organizacja <strong>{organizationName}</strong> zaprasza Cię do swojego
        konta.
      </Text>
      <Text
        style={{
          ...EMAIL_STYLES.text,
          backgroundColor: EMAIL_COLORS.muted,
          borderRadius: "8px",
          padding: "12px 16px",
        }}
      >
        Twoja rola: <strong>{ROLE_LABELS[role]}</strong>
      </Text>
    </EmailLayout>
  );
}
