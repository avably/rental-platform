/**
 * Walidacja WŁASNEJ domeny najemcy (Zadanie 2.6, ADR-046).
 *
 * Funkcja CZYSTA i osobna od akcji, żeby dało się ją pokryć testem bez sieci
 * i bez bazy — bramka niżej jest zbyt istotna, by żyła wewnątrz server action.
 *
 * Autorytatywną bramką KSZTAŁTU jest CHECK z 0019 (hostname RFC, 253 znaki);
 * schemat jest jego lustrem i daje czytelny komunikat, zanim żądanie w ogóle
 * wyjdzie do dostawcy.
 */
import { ROOT_DOMAIN } from "@avably/core";
import { z } from "zod";

/** Lustro CHECK-u `domains.domain` z 0019_site_model.sql. */
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * BRAMKA BEZPIECZEŃSTWA: własną domeną nie może być NASZ host.
 *
 * Bez niej najemca wpisałby `www.avably.io` (albo `<cudzy-slug>.avably.io`)
 * jako swoją domenę — a ponieważ `avably.io` należy do NAS i siedzi w NASZYM
 * projekcie u dostawcy, rejestracja zakończyłaby się natychmiastowym
 * `verified: true`. Werdykt dostawcy, na którym opieramy całe zaufanie do
 * własnych domen, potwierdza WŁASNOŚĆ HOSTA — a ta jest tu nasza, nie najemcy.
 * Skutkiem byłoby przejęcie kanonu marketingowego albo cudzego sklepu przez
 * formularz w panelu. Subdomeny platformy powstają WYŁĄCZNIE w
 * app.create_tenant (0022), nigdy z wejścia użytkownika.
 */
export function isPlatformHost(host: string): boolean {
  return host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`);
}

export const customDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    // Kropka końcowa jest legalna w DNS, ale kolumna jej nie dopuszcza —
    // obcinamy zamiast odrzucać wpis, który dla użytkownika jest poprawny.
    .transform((value) => value.replace(/\.$/, ""))
    .pipe(
      z
        .string()
        .min(4, "Podaj poprawną domenę.")
        .max(253, "Domena jest za długa (limit 253 znaki).")
        .regex(HOSTNAME_PATTERN, "Podaj sam host, bez http:// i bez ścieżki (np. sklep.twojafirma.pl).")
        .refine(
          (value) => !isPlatformHost(value),
          `Ta domena należy do platformy. Podaj własną domenę (host w ${ROOT_DOMAIN} dostajesz automatycznie).`,
        ),
    ),
});

export function customDomainInputFromFormData(formData: FormData): { domain: unknown } {
  return { domain: formData.get("domain") };
}

/** Ile znaków powodu pokazujemy najemcy (reszta to i tak szum dostawcy). */
const ERROR_DISPLAY_LIMIT = 180;

/**
 * `last_error` → jedna czytelna linia (Zadanie 2.6b).
 *
 * Kolumna trzyma DOSŁOWNY komunikat dostawcy ucięty do 500 znaków — a to bywa
 * wielolinijkowy fragment strony serwisowej albo znaczniki HTML. Wrzucenie
 * tego wprost na ekran zamienia komunikat w dump, którego najemca nie czyta,
 * więc nie klika też ponowienia. Zwijamy białe znaki, wycinamy znaczniki i
 * przycinamy do jednej linii; PEŁNY powód zostaje w bazie dla operatora.
 *
 * Funkcja czysta i osobna od widoku, bo to jedyny sposób, żeby pokryć ją
 * testem bez renderowania panelu.
 */
export function readableDomainError(raw: string | null): string | null {
  if (!raw) return null;
  const flat = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length === 0) return null;
  return flat.length > ERROR_DISPLAY_LIMIT ? `${flat.slice(0, ERROR_DISPLAY_LIMIT)}…` : flat;
}
