/**
 * Typy portu wysyłki e-maili (ADR-033).
 */

/**
 * Nadawca e-maili tenanta.
 *
 * ADRESU TU NIE MA I TO JEST DECYZJA: pole From składa się ze stałej
 * platformy (RESEND_FROM_EMAIL) i nazwy tenanta — adres per najemca
 * wymagałby weryfikacji DNS jego domeny. Tenant personalizuje nazwę
 * wyświetlaną i adres odpowiedzi.
 */
export interface EmailSender {
  /** Nazwa wyświetlana w polu From. */
  name: string;
  /** Adres, na który realnie odpowiada klient. Opcjonalny. */
  replyTo?: string;
}

/**
 * Załącznik wiadomości. `content` przyjmuje surowe bajty (np. PDF etykiety
 * z API kurierskiego jako Uint8Array) albo gotowe base64 — port koduje
 * bajty do base64 dopiero na granicy z dostawcą.
 */
export interface EmailAttachment {
  filename: string;
  content: Uint8Array | string;
}

/**
 * Wiadomość gotowa do wysyłki.
 *
 * Wszystkie wartości są już SFORMATOWANE — kwoty, daty i temat składa
 * wołający (panel), bo tylko on zna locale i walutę tenanta. Ten sam
 * kontrakt co szablony w @avably/emails.
 */
export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailTransport {
  send(email: OutgoingEmail): Promise<void>;
}

/**
 * Czy wysyłka jest w ogóle dostępna i — jeśli nie — dlaczego.
 *
 * `reason` jest OBOWIĄZKOWY przy available: false w praktyce: brak wysyłki
 * bez powodu to dla operatora wyłączony przełącznik bez wyjaśnienia.
 */
export interface EmailAvailability {
  available: boolean;
  reason?: string;
}
