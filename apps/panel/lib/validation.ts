/**
 * Schematy Zod dla wejść auth panelu (Zadanie 6). Każda akcja serwerowa
 * waliduje `FormData`/JSON tym schematem PRZED wywołaniem Supabase.
 */
import { z } from "zod";

/**
 * Sanityzacja parametru `next` (docelowa ścieżka po zalogowaniu, np. z linku
 * zaproszenia dla niezalogowanego). Chroni przed open-redirect: przyjmuje
 * WYŁĄCZNIE ścieżki wewnętrzne zaczynające się od pojedynczego "/". Odrzuca
 * absolutne URL-e (`https://…`), protocol-relative (`//host`) i ścieżki z
 * backslashem (część przeglądarek normalizuje `\` do `/`, dając ucieczkę na
 * inny host). Zwraca bezpieczną ścieżkę albo `null`.
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  return raw;
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Podaj adres e-mail.")
  .email("Podaj poprawny adres e-mail.");

export const passwordSchema = z.string().min(8, "Hasło musi mieć co najmniej 8 znaków.");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  turnstileToken: z.string().optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Podaj hasło."),
  turnstileToken: z.string().optional(),
});

export const resetRequestSchema = z.object({
  email: emailSchema,
  turnstileToken: z.string().optional(),
});

export const resetConfirmSchema = z.object({
  password: passwordSchema,
});

// Musi odpowiadać ograniczeniu tenants.slug w 0001_core.sql
// (`^[a-z0-9][a-z0-9-]{2,38}$`) — walidacja tu daje czytelny komunikat
// przed uderzeniem w constraint bazy.
export const createTenantSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,38}$/, "Slug: 3–39 znaków, małe litery/cyfry/myślnik, bez spacji."),
  name: z.string().trim().min(2, "Nazwa organizacji jest za krótka.").max(200),
});

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(["owner", "staff"]),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(16, "Nieprawidłowy token zaproszenia."),
});

export const totpEnrollSchema = z.object({
  friendlyName: z.string().trim().min(1).max(80).optional(),
});

// challengeId NIE pochodzi od klienta — akcja serwerowa woła
// supabase.auth.mfa.challenge() tuż przed verify() (patrz
// app/bezpieczenstwo/actions.ts), klient dostarcza tylko factorId + kod.
export const totpVerifySchema = z.object({
  factorId: z.string().uuid("Nieprawidłowy identyfikator czynnika MFA."),
  code: z.string().regex(/^\d{6}$/, "Kod musi mieć dokładnie 6 cyfr."),
});
