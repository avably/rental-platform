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

/**
 * Pola akceptacji regulaminu platformy z formularza organizacji (0070,
 * ADR-141). Oba OPCJONALNE na poziomie kształtu — czy są WYMAGANE, decyduje
 * akcja po rozwiązaniu bieżącej wersji (przed treścią od prawnika formularz
 * ich nie renderuje). Checkbox HTML wysyła "on" albo nie wysyła nic.
 */
export const platformTermsFieldsSchema = z.object({
  termsAccepted: z
    .union([z.literal("on"), z.null()])
    .transform((value) => value === "on"),
  termsVersionId: z.union([z.string().uuid(), z.null()]),
});

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(["owner", "staff"]),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(16, "Nieprawidłowy token zaproszenia."),
});

// --- L4: ścieżki wygaszania (ADR-105) ---

/**
 * Odwołanie/ponowienie zaproszenia — identyfikator wiersza.
 *
 * `tenant_id` NIE JEST i nie będzie polem formularza: tenant bierze się
 * wyłącznie z claimu JWT (`ctx.tenantId`), więc podstawienie cudzego id
 * w żądaniu nie ma gdzie zadziałać.
 */
export const invitationIdSchema = z.object({
  invitationId: z.string().uuid("Nieprawidłowy identyfikator zaproszenia."),
});

/** Usunięcie członka zespołu — identyfikator konta usuwanej osoby. */
export const removeMemberSchema = z.object({
  userId: z.string().uuid("Nieprawidłowy identyfikator członka zespołu."),
});

/** Ponowienie e-maila potwierdzającego adres (trasa dla NIEzalogowanych). */
export const resendConfirmationSchema = z.object({
  email: emailSchema,
});

// --- Panel superadmina (Zadanie 7) ---

export const tenantIdSchema = z.string().uuid("Nieprawidłowy identyfikator organizacji.");

export const lockTenantSchema = z.object({
  tenantId: tenantIdSchema,
  reason: z.string().trim().max(500, "Powód jest za długi (max 500 znaków).").optional(),
});

export const unlockTenantSchema = z.object({
  tenantId: tenantIdSchema,
});

// plan_id to tekstowy klucz z katalogu public.plans — istnienie planu
// weryfikuje klucz obcy subscriptions.plan_id, tu tylko kształt.
export const setPlanSchema = z.object({
  tenantId: tenantIdSchema,
  planId: z.string().trim().min(1, "Wybierz plan.").max(40),
});

export const tenantViewSchema = z.object({
  tenantId: tenantIdSchema,
});

/** Filtry przeglądarki audit_log (/admin/audit) — wszystkie opcjonalne. */
export const auditFilterSchema = z.object({
  tenantId: z.string().uuid().optional(),
  action: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
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

// Step-up istniejącego czynnika (/bezpieczenstwo/wyzwanie): factorId bierze
// akcja serwerowa z listy czynników zalogowanego usera, klient podaje sam kod.
export const totpChallengeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Kod musi mieć dokładnie 6 cyfr."),
});
