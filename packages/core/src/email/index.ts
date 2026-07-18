export { EMAIL_SENDER_KEY, EmailConfigError, emailSenderFromSettings } from "./tenant-config";
export {
  RESEND_SEND_URL,
  EmailTransportError,
  emailAvailability,
  platformFromAddress,
  resendTransport,
  type EmailTransportOptions,
} from "./transport";
export {
  EMAIL_LOG_KINDS,
  EMAIL_LOG_STATUSES,
  isEmailLogKind,
  sendAndLog,
  type EmailLogEntry,
  type EmailLogKind,
  type EmailLogRecorder,
  type EmailLogStatus,
  type SendAndLogInput,
  type SendAndLogResult,
} from "./log";
export type {
  EmailAttachment,
  EmailAvailability,
  EmailSender,
  EmailSendResult,
  EmailTransport,
  OutgoingEmail,
} from "./types";
