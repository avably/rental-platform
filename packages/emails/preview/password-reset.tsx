import { PasswordReset, type PasswordResetProps } from "../src/index";

function PasswordResetPreview(props: PasswordResetProps) {
  return <PasswordReset {...props} />;
}

PasswordResetPreview.PreviewProps = {
  recipientName: "Piotr",
  locale: "pl",
  resetUrl: "https://app.example.test/reset?token=reset-preview",
} satisfies PasswordResetProps;

export default PasswordResetPreview;
