import {
  OrganizationInvitation,
  type OrganizationInvitationProps,
} from "../src/index";

function OrganizationInvitationPreview(props: OrganizationInvitationProps) {
  return <OrganizationInvitation {...props} />;
}

OrganizationInvitationPreview.PreviewProps = {
  locale: "pl",
  acceptanceUrl:
    "https://app.example.test/invitations/accept?token=invitation-preview",
  organizationName: "Wypożyczalnia Północ",
  recipientName: "Jan",
  role: "staff",
} satisfies OrganizationInvitationProps;

export default OrganizationInvitationPreview;
