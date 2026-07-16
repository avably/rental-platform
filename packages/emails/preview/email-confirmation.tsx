import {
  EmailConfirmation,
  type EmailConfirmationProps,
} from "../src/index";

function EmailConfirmationPreview(props: EmailConfirmationProps) {
  return <EmailConfirmation {...props} />;
}

EmailConfirmationPreview.PreviewProps = {
  locale: "pl",
  confirmationUrl:
    "https://app.example.test/auth/confirm?token=confirmation-preview",
  recipientName: "Anna",
} satisfies EmailConfirmationProps;

export default EmailConfirmationPreview;
