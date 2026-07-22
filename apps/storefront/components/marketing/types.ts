import type enMessages from "@/messages/en.json";

/**
 * Kontrakt copy stron marketingowych: kształt bierzemy z EN, a parytet z PL
 * pilnuje `messages-parity.test.ts`. Dzięki temu brakujący klucz jest błędem
 * typów w komponencie, a nie pustym miejscem na stronie.
 */
export type MarketingCopy = typeof enMessages.landing;
