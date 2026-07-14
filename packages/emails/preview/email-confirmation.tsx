import {
  EmailConfirmation,
  type EmailConfirmationProps,
} from "../src/index";

function EmailConfirmationPreview(props: EmailConfirmationProps) {
  return <EmailConfirmation {...props} />;
}

EmailConfirmationPreview.PreviewProps = {
  confirmationUrl:
    "https://app.example.test/auth/confirm?token=confirmation-preview",
  recipientName: "Anna",
} satisfies EmailConfirmationProps;

export default EmailConfirmationPreview;
